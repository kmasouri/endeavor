import {
  AgentRepository,
  CatalogNameConflictError,
  CatalogRepository,
  HumanRepository
} from '../../data';
import { CatalogLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman } from '../../shared/access';
import { AppError } from '../../shared/errors';
import {
  AgentGrant,
  Connection,
  GrantTargetType,
  HttpMethod,
  Skill,
  SkillVersion
} from '../../shared/types';

export interface SkillDetails extends Skill {
  currentVersion: SkillVersion | null;
}

export interface ConnectionChanges {
  name?: string;
  description?: string;
  baseUrl?: string;
  authHeader?: string;
  // A string replaces the credential, null removes it, and leaving it out keeps it.
  credential?: string | null;
  allowedMethods?: HttpMethod[];
  allowedPathPrefixes?: string[];
  approvalMethods?: HttpMethod[];
}

// The shared catalogs: reusable skills and connections that admins define once. Being in a
// catalog gives no agent access. Access comes from per-agent grants, which can be revoked at
// any time and are checked on every tool call.
export class CatalogService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly credentialsReady: boolean,
    private readonly catalogLogger: CatalogLogger
  ) {}

  // Skills

  async createSkill(
    actorId: string,
    input: { name: string; description: string; instructions: string }
  ): Promise<SkillDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const { skill, version } = await this.catalogRepository
      .createSkill(
        { name: input.name, description: input.description },
        {
          instructions: input.instructions,
          createdByHumanId: admin.id
        }
      )
      .catch(toNameTaken);
    this.catalogLogger.onSkillSaved(skill.id, version.version);
    return { ...skill, currentVersion: version };
  }

  async listSkills(input: {
    limit: number;
    offset: number;
  }): Promise<{ skills: SkillDetails[]; total: number }> {
    const [skills, total] = await Promise.all([
      this.catalogRepository.listSkills(input),
      this.catalogRepository.countSkills()
    ]);
    const versions = new Map(
      (
        await this.catalogRepository.getSkillVersions(
          skills.flatMap((skill) => skill.currentVersionId ?? [])
        )
      ).map((version) => [version.id, version])
    );
    return {
      skills: skills.map((skill) => ({
        ...skill,
        currentVersion: versions.get(skill.currentVersionId ?? '') ?? null
      })),
      total
    };
  }

  async getSkill(skillId: string): Promise<SkillDetails> {
    const skill = await this.requireSkill(skillId);
    const [currentVersion] = await this.catalogRepository.getSkillVersions(
      skill.currentVersionId ? [skill.currentVersionId] : []
    );
    return { ...skill, currentVersion: currentVersion ?? null };
  }

  async listSkillVersions(skillId: string): Promise<SkillVersion[]> {
    await this.requireSkill(skillId);
    return this.catalogRepository.listSkillVersions(skillId);
  }

  // A new version is used by agent configurations saved after it. Configurations already saved
  // keep the version they pinned.
  async addSkillVersion(
    actorId: string,
    skillId: string,
    changes: { instructions?: string }
  ): Promise<SkillDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const skill = await this.getSkill(skillId);
    const instructions = changes.instructions ?? skill.currentVersion?.instructions;
    if (instructions === undefined) {
      throw new AppError(
        'validationError',
        'This skill has no version yet, so instructions are needed'
      );
    }

    const version = await this.catalogRepository.addSkillVersion(skill.id, {
      instructions,
      createdByHumanId: admin.id
    });
    this.catalogLogger.onSkillSaved(skill.id, version.version);
    return { ...skill, currentVersionId: version.id, currentVersion: version };
  }

  async setSkillDisabled(
    actorId: string,
    skillId: string,
    disabled: boolean
  ): Promise<SkillDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireSkill(skillId);
    await this.catalogRepository.setSkillDisabled(skillId, disabled);
    return this.getSkill(skillId);
  }

  // Connections

  async createConnection(
    actorId: string,
    input: {
      name: string;
      description: string;
      baseUrl: string;
      authHeader?: string;
      credential?: string;
      allowedMethods: HttpMethod[];
      allowedPathPrefixes: string[];
      approvalMethods?: HttpMethod[];
    }
  ): Promise<Connection> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    this.requireCredentialsKey(input.credential);
    const connection = await this.catalogRepository
      .createConnection({
        name: input.name,
        description: input.description,
        baseUrl: input.baseUrl,
        authHeader: input.authHeader ?? 'Authorization',
        credential: input.credential ?? null,
        allowedMethods: input.allowedMethods,
        allowedPathPrefixes: input.allowedPathPrefixes,
        // Reading is free; anything that changes something waits for a person, unless set.
        approvalMethods:
          input.approvalMethods ?? input.allowedMethods.filter((method) => method !== 'GET'),
        createdByHumanId: admin.id
      })
      .catch(toNameTaken);
    this.catalogLogger.onConnectionSaved(connection.id);
    return connection;
  }

  async listConnections(input: {
    limit: number;
    offset: number;
  }): Promise<{ connections: Connection[]; total: number }> {
    const [connections, total] = await Promise.all([
      this.catalogRepository.listConnections(input),
      this.catalogRepository.countConnections()
    ]);
    return { connections, total };
  }

  async getConnection(connectionId: string): Promise<Connection> {
    return this.requireConnection(connectionId);
  }

  // Changes take effect on the next tool call, for every agent that uses the connection.
  async updateConnection(
    actorId: string,
    connectionId: string,
    changes: ConnectionChanges
  ): Promise<Connection> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireConnection(connectionId);
    this.requireCredentialsKey(changes.credential);
    const updated = await this.catalogRepository
      .updateConnection(connectionId, changes)
      .catch(toNameTaken);
    this.catalogLogger.onConnectionSaved(connectionId);
    return updated ?? this.requireConnection(connectionId);
  }

  async setConnectionDisabled(
    actorId: string,
    connectionId: string,
    disabled: boolean
  ): Promise<Connection> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireConnection(connectionId);
    const updated = await this.catalogRepository.setConnectionDisabled(connectionId, disabled);
    return updated ?? this.requireConnection(connectionId);
  }

  // Grants

  async listGrants(agentId: string, includeRevoked: boolean): Promise<AgentGrant[]> {
    await this.requireAgent(agentId);
    return this.catalogRepository.listGrants(agentId, { activeOnly: !includeRevoked });
  }

  async grant(
    actorId: string,
    agentId: string,
    target: { type: GrantTargetType; id: string }
  ): Promise<AgentGrant> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireAgent(agentId);
    if (target.type === 'skill') {
      await this.requireSkill(target.id);
    } else {
      await this.requireConnection(target.id);
    }

    const grant = await this.catalogRepository.grant({
      agentId,
      targetType: target.type,
      targetId: target.id,
      grantedByHumanId: admin.id
    });
    this.catalogLogger.onGranted(agentId, target.type, target.id);
    return grant;
  }

  // Applies from the agent's next tool call, even in tasks on older configuration versions.
  async revoke(
    actorId: string,
    agentId: string,
    target: { type: GrantTargetType; id: string }
  ): Promise<void> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireAgent(agentId);
    const revoked = await this.catalogRepository.revoke({
      agentId,
      targetType: target.type,
      targetId: target.id,
      revokedByHumanId: admin.id
    });
    if (revoked) {
      this.catalogLogger.onRevoked(agentId, target.type, target.id);
    }
  }

  // Helpers

  private requireCredentialsKey(credential: string | null | undefined): void {
    if (typeof credential === 'string' && !this.credentialsReady) {
      throw new AppError('credentialsKeyMissing');
    }
  }

  private async requireSkill(skillId: string): Promise<Skill> {
    const skill = await this.catalogRepository.getSkill(skillId);
    if (!skill) {
      throw new AppError('skillNotFound', `Skill ${skillId} was not found`);
    }
    return skill;
  }

  private async requireConnection(connectionId: string): Promise<Connection> {
    const connection = await this.catalogRepository.getConnection(connectionId);
    if (!connection) {
      throw new AppError('connectionNotFound', `Connection ${connectionId} was not found`);
    }
    return connection;
  }

  private async requireAgent(agentId: string): Promise<void> {
    if (!(await this.agentRepository.getById(agentId))) {
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    }
  }
}

function toNameTaken(error: unknown): never {
  if (error instanceof CatalogNameConflictError) {
    throw new AppError('catalogNameTaken', error.message);
  }
  throw error;
}
