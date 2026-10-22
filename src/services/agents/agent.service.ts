import { AgentRepository, HumanRepository } from '../../data';
import { AgentLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman } from '../../shared/access';
import { AppError } from '../../shared/errors';
import { Agent, AgentVersion, MODEL_PROVIDERS, ModelProvider } from '../../shared/types';

export interface AgentDetails extends Agent {
  currentVersion: AgentVersion | null;
  // False when the agent's provider has no API key set, so its tasks can't run yet.
  providerReady: boolean;
}

export interface AgentConfigInput {
  instructions: string;
  provider: ModelProvider;
  model: string;
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
    private readonly readyProviders: readonly ModelProvider[],
    private readonly agentLogger: AgentLogger
  ) {}

  async createAgent(
    actorId: string,
    input: { name: string; purpose: string } & AgentConfigInput
  ): Promise<AgentDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireFreeName(input.name);

    const agent = await this.agentRepository.create({ name: input.name, purpose: input.purpose });
    const version = await this.agentRepository.addVersion(agent.id, {
      instructions: input.instructions,
      provider: input.provider,
      model: input.model,
      skillIds: [],
      connectionIds: [],
      createdByHumanId: admin.id
    });
    this.agentLogger.onAgentCreated(agent.id);
    this.agentLogger.onAgentConfigured(agent.id, version.version, version.provider);
    return this.toDetails({ ...agent, currentVersionId: version.id }, version);
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
    const details = await Promise.all(agents.map((agent) => this.loadDetails(agent)));
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

    const updated = await this.agentRepository.update(agent.id, changes);
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

    const version = await this.agentRepository.addVersion(agent.id, {
      instructions,
      provider,
      model,
      skillIds: current?.skillIds ?? [],
      connectionIds: current?.connectionIds ?? [],
      createdByHumanId: admin.id
    });
    this.agentLogger.onAgentConfigured(agent.id, version.version, version.provider);
    return this.toDetails({ ...agent, currentVersionId: version.id }, version);
  }

  // A disabled agent takes no new tasks. Work it already has is not stopped; pause or cancel
  // those tasks to stop them.
  async setDisabled(actorId: string, agentId: string, disabled: boolean): Promise<AgentDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const agent = await this.requireAgent(agentId);

    const updated = await this.agentRepository.setDisabled(agent.id, disabled);
    this.agentLogger.onAgentDisabledChanged(agent.id, disabled);
    return this.loadDetails(updated ?? agent);
  }

  listProviders(): ProviderStatus[] {
    return MODEL_PROVIDERS.map((provider) => ({
      provider,
      ready: this.readyProviders.includes(provider),
      setup: PROVIDER_SETUP[provider]
    }));
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

  private async requireFreeName(name: string): Promise<void> {
    if (await this.agentRepository.getByName(name)) {
      throw new AppError('agentNameTaken', `An agent named ${name} already exists`);
    }
  }
}
