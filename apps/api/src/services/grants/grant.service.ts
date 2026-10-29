import {
  AgentConfigConflictError,
  AgentRepository,
  ConnectionRepository,
  GrantRepository,
  HumanRepository,
  SkillRepository
} from '../../data';
import { GrantLogger } from '../../observability';
import { AgentGrant, Connection, GrantTargetType, Skill } from '../../shared/types';
import { ADMIN_ONLY, requireHuman } from '../access/access.rules';
import { AppError } from '../../shared/errors';

// Ongoing access updates agent configuration atomically. Existing task pins stay explicit.
export class GrantService {
  constructor(
    private readonly grantRepository: GrantRepository,
    private readonly skillRepository: SkillRepository,
    private readonly connectionRepository: ConnectionRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly grantLogger: GrantLogger
  ) {}

  async listGrants(agentId: string, includeRevoked: boolean): Promise<AgentGrant[]> {
    await this.requireAgent(agentId);
    return this.grantRepository.listGrants(agentId, { activeOnly: !includeRevoked });
  }

  async grant(
    actorId: string,
    agentId: string,
    target: { type: GrantTargetType; id: string }
  ): Promise<AgentGrant> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const agent = await this.agentRepository.getById(agentId);
    if (!agent || agent.deletedAt)
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    const current = agent.currentVersionId
      ? await this.agentRepository.getVersion(agent.currentVersionId)
      : null;
    if (!current)
      throw new AppError('validationError', 'Configure this agent before granting ongoing access');
    let skillVersionIds = current.skillVersionIds;
    let connectionIds = current.connectionIds;
    if (target.type === 'skill') {
      const skill = await this.requireSkill(target.id);
      if (skill.disabledAt || !skill.currentVersionId)
        throw new AppError('catalogEntryUnavailable');
      const chosen = await this.skillRepository.getSkillVersions(skillVersionIds);
      if (
        !chosen.some(
          (version) => skillVersionIds.includes(version.id) && version.skillId === skill.id
        )
      ) {
        skillVersionIds = [...skillVersionIds, skill.currentVersionId];
      }
    } else {
      const connection = await this.requireConnection(target.id);
      if (connection.disabledAt) throw new AppError('catalogEntryUnavailable');
      if (!connectionIds.includes(connection.id)) connectionIds = [...connectionIds, connection.id];
    }
    // Ongoing access is part of configuration. Existing tasks keep their explicit version pin.
    const changed =
      skillVersionIds !== current.skillVersionIds || connectionIds !== current.connectionIds;
    if (changed) {
      await this.agentRepository
        .addVersion(
          agentId,
          {
            instructions: current.instructions,
            provider: current.provider,
            model: current.model,
            limits: current.limits,
            skillVersionIds,
            connectionIds,
            createdByHumanId: admin.id
          },
          {
            actorId: admin.id,
            expectedVersionId: current.id,
            grant: [{ type: target.type, id: target.id }],
            revoke: []
          }
        )
        .catch((error: unknown) => {
          if (error instanceof AgentConfigConflictError)
            throw new AppError('validationError', error.message);
          throw error;
        });
    }

    const grant = await this.grantRepository.grant({
      agentId,
      targetType: target.type,
      targetId: target.id,
      grantedByHumanId: admin.id,
      restoreRevoked: !changed
    });
    this.grantLogger.onGranted(agentId, target.type, target.id);
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
    const revoked = await this.grantRepository.revoke({
      agentId,
      targetType: target.type,
      targetId: target.id,
      revokedByHumanId: admin.id
    });
    if (revoked) {
      this.grantLogger.onRevoked(agentId, target.type, target.id);
    }
  }

  private async requireSkill(skillId: string): Promise<Skill> {
    const skill = await this.skillRepository.getSkill(skillId);
    if (!skill) {
      throw new AppError('skillNotFound', `Skill ${skillId} was not found`);
    }
    return skill;
  }

  private async requireConnection(connectionId: string): Promise<Connection> {
    const connection = await this.connectionRepository.getConnection(connectionId);
    if (!connection) {
      throw new AppError('connectionNotFound', `Connection ${connectionId} was not found`);
    }
    return connection;
  }

  private async requireAgent(agentId: string): Promise<void> {
    const agent = await this.agentRepository.getById(agentId);
    if (!agent || agent.deletedAt) {
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    }
  }
}
