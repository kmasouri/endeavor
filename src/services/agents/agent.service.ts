import {
  AgentNameConflictError,
  AgentRepository,
  CatalogRepository,
  HumanRepository
} from '../../data';
import { AgentLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman } from '../../shared/access';
import { AppError } from '../../shared/errors';
import {
  Agent,
  AgentLimits,
  AgentVersion,
  DirectoryEntry,
  MODEL_PROVIDERS,
  ModelProvider
} from '../../shared/types';

export interface AgentDetails extends Agent {
  currentVersion: AgentVersion | null;
  // False when the agent's provider has no API key set, so its tasks can't run yet.
  providerReady: boolean;
}

export interface AgentConfigInput {
  instructions: string;
  provider: ModelProvider;
  model: string;
  // Skills and connections from the catalogs. Each skill is pinned at its current version.
  // Choosing one also grants the agent access to it, which an admin can revoke later.
  skillIds?: string[];
  connectionIds?: string[];
  // Limits for each task. Saved with the version, like everything else here.
  limits?: AgentLimits;
}

export interface ProviderStatus {
  provider: ModelProvider;
  ready: boolean;
  setup: string;
}

const PROVIDER_SETUP: Record<ModelProvider, string> = {
  anthropic: 'Set ANTHROPIC_API_KEY. Models run on Anthropic servers, not this computer.',
  openai: 'Set OPENAI_API_KEY. Models run on OpenAI servers, not this computer.',
  scripted: 'Always ready. Answers from a script, for tests and demos. No model is called.'
};

// Agents are configured participants, not built-in roles: a QA agent and a research agent are
// the same thing with different settings. Settings that shape the work (instructions, provider,
// model) are saved as versions that never change; each task records the version it started
// with. Only admins change agents.
export class AgentService {
  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly readyProviders: readonly ModelProvider[],
    private readonly agentLogger: AgentLogger
  ) {}

  async createAgent(
    actorId: string,
    input: { name: string; purpose: string } & AgentConfigInput
  ): Promise<AgentDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireFreeName(input.name);
    const skillVersionIds = await this.pinSkills(input.skillIds ?? []);
    const connectionIds = await this.checkConnections(input.connectionIds ?? []);

    const { agent, version } = await this.agentRepository
      .create(
        { name: input.name, purpose: input.purpose },
        {
          instructions: input.instructions,
          provider: input.provider,
          model: input.model,
          skillVersionIds,
          connectionIds,
          limits: input.limits ?? {},
          createdByHumanId: admin.id
        }
      )
      .catch(toNameTaken);
    await this.grantNewlyChosen(agent.id, admin.id, null, version);
    this.agentLogger.onAgentCreated(agent.id);
    this.agentLogger.onAgentConfigured(agent.id, version.version, version.provider);
    return this.toDetails(agent, version);
  }

  async listAgents(input: {
    limit: number;
    offset: number;
    includeDisabled: boolean;
  }): Promise<{ agents: AgentDetails[]; total: number }> {
    const [agents, total] = await Promise.all([
      this.agentRepository.list(input),
      this.agentRepository.count({ includeDisabled: input.includeDisabled })
    ]);
    // One query for all current versions, instead of one per agent.
    const versionIds = agents.flatMap((agent) => agent.currentVersionId ?? []);
    const versions = new Map(
      (await this.agentRepository.getVersions(versionIds)).map((version) => [version.id, version])
    );
    const details = agents.map((agent) =>
      this.toDetails(agent, versions.get(agent.currentVersionId ?? '') ?? null)
    );
    return { agents: details, total };
  }

  async getAgent(agentId: string): Promise<AgentDetails> {
    return this.loadDetails(await this.requireAgent(agentId));
  }

  async listVersions(agentId: string): Promise<AgentVersion[]> {
    await this.requireAgent(agentId);
    return this.agentRepository.listVersions(agentId);
  }

  // Name and purpose describe the agent and are not versioned.
  async updateProfile(
    actorId: string,
    agentId: string,
    changes: { name?: string; purpose?: string }
  ): Promise<AgentDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const agent = await this.requireAgent(agentId);
    if (changes.name && changes.name.toLowerCase() !== agent.name.toLowerCase()) {
      await this.requireFreeName(changes.name);
    }

    const updated = await this.agentRepository.update(agent.id, changes).catch(toNameTaken);
    return this.loadDetails(updated ?? agent);
  }

  // Saves a new version from the current one plus the changes. Running and waiting tasks keep
  // the version they started with; only new tasks use this one.
  async updateConfig(
    actorId: string,
    agentId: string,
    changes: Partial<AgentConfigInput>
  ): Promise<AgentDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const agent = await this.requireAgent(agentId);
    const current = agent.currentVersionId
      ? await this.agentRepository.getVersion(agent.currentVersionId)
      : null;
    const instructions = changes.instructions ?? current?.instructions;
    const provider = changes.provider ?? current?.provider;
    const model = changes.model ?? current?.model;
    if (instructions === undefined || provider === undefined || model === undefined) {
      throw new AppError(
        'validationError',
        'This agent has no configuration yet, so instructions, provider, and model are all needed'
      );
    }

    const skillVersionIds = changes.skillIds
      ? await this.pinSkills(changes.skillIds)
      : (current?.skillVersionIds ?? []);
    const connectionIds = changes.connectionIds
      ? await this.checkConnections(changes.connectionIds)
      : (current?.connectionIds ?? []);
    const limits = changes.limits ?? current?.limits ?? {};

    // Saving the same settings again doesn't add a copy to the history.
    if (
      current &&
      current.instructions === instructions &&
      current.provider === provider &&
      current.model === model &&
      sameIds(current.skillVersionIds, skillVersionIds) &&
      sameIds(current.connectionIds, connectionIds) &&
      sameLimits(current.limits, limits)
    ) {
      return this.toDetails(agent, current);
    }

    const version = await this.agentRepository.addVersion(agent.id, {
      instructions,
      provider,
      model,
      skillVersionIds,
      connectionIds,
      limits,
      createdByHumanId: admin.id
    });
    await this.grantNewlyChosen(agent.id, admin.id, current, version);
    this.agentLogger.onAgentConfigured(agent.id, version.version, version.provider);
    return this.toDetails({ ...agent, currentVersionId: version.id }, version);
  }

  // A disabled agent takes no new tasks. Work it already has is not stopped; pause or cancel
  // those tasks to stop them.
  async setDisabled(actorId: string, agentId: string, disabled: boolean): Promise<AgentDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const agent = await this.requireAgent(agentId);
    if ((agent.disabledAt !== null) === disabled) {
      return this.loadDetails(agent);
    }

    const updated = await this.agentRepository.setDisabled(agent.id, disabled);
    if (disabled) {
      this.agentLogger.onAgentDisabled(agent.id);
    } else {
      this.agentLogger.onAgentEnabled(agent.id);
    }
    return this.loadDetails(updated ?? agent);
  }

  // The workspace directory: enabled agents a person can discover and ask to add. For now every
  // person can discover every enabled agent (see "Who can do what?" in Questions for Kayvan).
  async listDirectory(
    actorId: string,
    input: { limit: number; offset: number }
  ): Promise<{ entries: DirectoryEntry[]; total: number }> {
    requireHuman(await this.humanRepository.getById(actorId));
    const [agents, total] = await Promise.all([
      this.agentRepository.listDirectory({ excludeIds: [], ...input }),
      this.agentRepository.countDirectory({ excludeIds: [] })
    ]);
    const versions = new Map(
      (
        await this.agentRepository.getVersions(
          agents.map((agent) => agent.currentVersionId as string)
        )
      ).map((version) => [version.id, version])
    );
    const entries = agents.flatMap((agent): DirectoryEntry[] => {
      const version = versions.get(agent.currentVersionId as string);
      return version ? [toDirectoryEntry(agent, version)] : [];
    });
    return { entries, total };
  }

  listProviders(): ProviderStatus[] {
    return MODEL_PROVIDERS.map((provider) => ({
      provider,
      ready: this.readyProviders.includes(provider),
      setup: PROVIDER_SETUP[provider]
    }));
  }

  // Turns skill IDs into their current version IDs, in one query. Each skill must be enabled.
  private async pinSkills(skillIds: string[]): Promise<string[]> {
    const unique = [...new Set(skillIds)];
    const skills = await this.catalogRepository.getSkills(unique);
    return unique.map((skillId) => {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) {
        throw new AppError('skillNotFound', `Skill ${skillId} was not found`);
      }
      if (skill.disabledAt || !skill.currentVersionId) {
        throw new AppError('catalogEntryUnavailable', `Skill ${skill.name} can't be chosen now`);
      }
      return skill.currentVersionId;
    });
  }

  private async checkConnections(connectionIds: string[]): Promise<string[]> {
    const unique = [...new Set(connectionIds)];
    const found = await this.catalogRepository.getConnections(unique);
    for (const id of unique) {
      const connection = found.find((c) => c.id === id);
      if (!connection) {
        throw new AppError('connectionNotFound', `Connection ${id} was not found`);
      }
      if (connection.disabledAt) {
        throw new AppError('catalogEntryUnavailable', `Connection ${connection.name} is disabled`);
      }
    }
    return unique;
  }

  // Choosing a skill or connection grants it, along with the connections a chosen skill
  // uses. Only newly chosen entries are granted, and only once the version is saved. Saving
  // again with the same choices never brings back a grant an admin revoked; use the grants API.
  private async grantNewlyChosen(
    agentId: string,
    adminId: string,
    previous: AgentVersion | null,
    next: AgentVersion
  ): Promise<void> {
    const [before, after] = await Promise.all([
      this.chosenTargets(previous),
      this.chosenTargets(next)
    ]);
    for (const key of after) {
      if (!before.has(key)) {
        const [targetType, targetId] = key.split(':') as ['skill' | 'connection', string];
        await this.catalogRepository.grant({
          agentId,
          grantedByHumanId: adminId,
          targetType,
          targetId
        });
      }
    }
  }

  private async chosenTargets(version: AgentVersion | null): Promise<Set<string>> {
    if (!version) {
      return new Set();
    }
    const skillVersions = await this.catalogRepository.getSkillVersions(version.skillVersionIds);
    return new Set([
      ...skillVersions.map((skillVersion) => `skill:${skillVersion.skillId}`),
      ...[...version.connectionIds, ...skillVersions.flatMap((sv) => sv.connectionIds)].map(
        (id) => `connection:${id}`
      )
    ]);
  }

  private async loadDetails(agent: Agent): Promise<AgentDetails> {
    const version = agent.currentVersionId
      ? await this.agentRepository.getVersion(agent.currentVersionId)
      : null;
    return this.toDetails(agent, version);
  }

  private toDetails(agent: Agent, version: AgentVersion | null): AgentDetails {
    return {
      ...agent,
      currentVersion: version,
      providerReady: version !== null && this.readyProviders.includes(version.provider)
    };
  }

  private async requireAgent(agentId: string): Promise<Agent> {
    const agent = await this.agentRepository.getById(agentId);
    if (!agent) {
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    }
    return agent;
  }

  // Checked first for a clear error. The unique index still catches two saves at once.
  private async requireFreeName(name: string): Promise<void> {
    if (await this.agentRepository.getByName(name)) {
      throw new AppError('agentNameTaken', `An agent named ${name} already exists`);
    }
  }
}

function toNameTaken(error: unknown): never {
  if (error instanceof AgentNameConflictError) {
    throw new AppError('agentNameTaken', error.message);
  }
  throw error;
}

function toDirectoryEntry(agent: Agent, version: AgentVersion): DirectoryEntry {
  return {
    id: agent.id,
    name: agent.name,
    purpose: agent.purpose,
    capabilities: {
      provider: version.provider,
      model: version.model,
      skillCount: version.skillVersionIds.length,
      connectionCount: version.connectionIds.length
    }
  };
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

// jsonb doesn't keep key order, so compare the values, not the JSON text.
function sameLimits(a: AgentLimits, b: AgentLimits): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof AgentLimits>;
  return [...keys].every((key) => a[key] === b[key]);
}
