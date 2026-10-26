import { createHash, randomBytes } from 'node:crypto';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';
import {
  ConnectionOAuthRepository,
  AgentRepository,
  AgentConfigConflictError,
  CatalogNameConflictError,
  CatalogRepository,
  HumanRepository
} from '../../data';
import {
  ConnectionOAuthClient,
  McpAuthenticationError,
  McpClient,
  McpTool
} from '../../integrations';
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
  allowedTools?: string[];
  approvalTools?: string[];
  name?: string;
  description?: string;
  baseUrl?: string;
  authHeader?: string;
  // A string replaces the credential, null removes it, and leaving it out keeps it.
  credential?: string | null;
  allowedMethods?: HttpMethod[];
  allowedPathPrefixes?: string[];
  approvalMethods?: HttpMethod[];
  discoverable?: boolean;
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
    private readonly catalogLogger: CatalogLogger,
    private readonly mcpClient?: McpClient,
    private readonly oauthRepository?: ConnectionOAuthRepository,
    private readonly oauthClient?: ConnectionOAuthClient,
    private readonly publicUrl?: string
  ) {}

  async oauthStatus(actorId: string, connectionId: string) {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const connection = await this.requireConnection(connectionId);
    const session = await this.oauthRepository?.get(connectionId);
    return {
      status: !session
        ? 'header'
        : session.resource !== connection.baseUrl ||
            (session.status === 'pending' && (session.pendingExpiresAt ?? 0) < Date.now())
          ? 'reconnect_required'
          : session.status,
      expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null
    };
  }

  async startOAuth(actorId: string, connectionId: string) {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    this.requireCredentialsKey('oauth');
    const connection = await this.requireConnection(connectionId);
    if (connection.kind !== 'mcp' || connection.disabledAt)
      throw new AppError('validationError', 'Choose an enabled MCP connection.');
    if (!this.oauthRepository || !this.oauthClient || !this.publicUrl) {
      throw new AppError(
        'validationError',
        'Set APP_PUBLIC_URL to the address used to open Endeavor before signing in.'
      );
    }
    const nonce = randomBytes(32).toString('base64url');
    const browserKey = randomBytes(32).toString('base64url');
    const callbackUrl = new URL(`/connections/${connection.id}/oauth/callback`, this.publicUrl)
      .href;
    const result = await this.oauthRepository.withLock(connection.id, async () => {
      const session: ConnectionOAuthSession = {
        resource: connection.baseUrl,
        callbackUrl,
        actorId,
        status: 'pending',
        stateHash: digest(nonce),
        browserHash: digest(browserKey),
        pendingExpiresAt: Date.now() + 600_000,
        data: {}
      };
      try {
        const authorizationUrl = await this.oauthClient!.begin(session, nonce);
        return { session, result: { authorizationUrl, browserKey, callbackUrl } };
      } catch {
        throw new AppError(
          'connectionOAuthFailed',
          'Sign-in setup failed. Check that this MCP server supports OAuth client registration.'
        );
      }
    });
    this.catalogLogger.onConnectionAuthentication(connectionId, 'pending');
    return result;
  }

  async finishOAuth(
    connectionId: string,
    input: { state: string; code?: string; error?: string; iss?: string },
    browserKey: string
  ) {
    if (!this.oauthRepository || !this.oauthClient || !this.publicUrl)
      throw new AppError('connectionOAuthFailed');
    const connected = await this.oauthRepository.withLock(connectionId, async (session) => {
      const connection = await this.requireConnection(connectionId);
      if (
        !session ||
        session.status !== 'pending' ||
        session.stateHash !== digest(input.state) ||
        session.browserHash !== digest(browserKey) ||
        !browserKey ||
        !session.pendingExpiresAt ||
        session.pendingExpiresAt < Date.now() ||
        session.resource !== connection.baseUrl ||
        session.callbackUrl !==
          new URL(`/connections/${connectionId}/oauth/callback`, this.publicUrl).href ||
        connection.disabledAt ||
        connection.kind !== 'mcp'
      ) {
        throw new AppError('connectionOAuthCallbackInvalid');
      }
      requireHuman(await this.humanRepository.getById(session.actorId), ADMIN_ONLY);
      // Consume even rejected/failed callbacks. The lock also prevents duplicate code exchange.
      delete session.stateHash;
      delete session.browserHash;
      delete session.pendingExpiresAt;
      try {
        if (input.error || !input.code) throw new Error('Consent was not completed');
        await this.oauthClient!.finish(session, input.code, input.iss);
        session.status = 'connected';
        return { session, result: true };
      } catch {
        session.status = 'reconnect_required';
        session.data = {};
        delete session.expiresAt;
        return { session, result: false };
      }
    });
    this.catalogLogger.onConnectionAuthentication(
      connectionId,
      connected ? 'connected' : 'reconnect_required'
    );
    return new URL(
      `/app/#/connections/${connectionId}?oauth=${connected ? 'connected' : 'failed'}`,
      this.publicUrl
    ).href;
  }

  async disconnectOAuth(actorId: string, connectionId: string) {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireConnection(connectionId);
    if (this.oauthRepository)
      await this.oauthRepository.withLock(connectionId, async (session) => ({
        session: session
          ? {
              ...session,
              status: 'disconnected',
              data: {},
              expiresAt: undefined,
              stateHash: undefined,
              browserHash: undefined,
              pendingExpiresAt: undefined
            }
          : null,
        result: undefined
      }));
    this.catalogLogger.onConnectionAuthentication(connectionId, 'disconnected');
    return { status: 'disconnected' };
  }

  private async requireReconnect(connectionId: string, failedAuthorization?: string) {
    if (this.oauthRepository)
      await this.oauthRepository.withLock(connectionId, async (session) => ({
        session:
          session &&
          failedAuthorization ===
            `Bearer ${(session.data.tokens as { access_token?: string } | undefined)?.access_token}`
            ? { ...session, status: 'reconnect_required', data: {}, expiresAt: undefined }
            : session,
        result: undefined
      }));
  }

  private async connectionHeaders(connection: Connection): Promise<Record<string, string>> {
    if (this.oauthRepository && this.oauthClient) {
      const result = await this.oauthRepository.withLock<Record<string, string> | null | false>(
        connection.id,
        async (session) => {
          if (!session) return { session, result: null };
          if (session.status !== 'connected') return { session, result: false as const };
          try {
            if (session.resource !== connection.baseUrl) throw new Error('Resource changed');
            const headers = await this.oauthClient!.headers(session);
            return { session, result: headers };
          } catch {
            session.status = 'reconnect_required';
            session.data = {};
            delete session.expiresAt;
            return { session, result: false as const };
          }
        }
      );
      if (result === false) throw new AppError('connectionSignInRequired');
      if (result) return result;
    }
    const credential = await this.catalogRepository.getConnectionCredential(connection.id);
    return credential ? { [connection.authHeader]: credential } : {};
  }

  // Skills

  async createSkill(
    actorId: string,
    input: { name: string; description: string; instructions: string; discoverable?: boolean }
  ): Promise<SkillDetails> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const { skill, version } = await this.catalogRepository
      .createSkill(
        { name: input.name, description: input.description, discoverable: input.discoverable },
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

  // Discovery lets agents find the skill and ask for access. It grants nothing.
  async updateSkill(
    actorId: string,
    skillId: string,
    changes: { discoverable: boolean }
  ): Promise<SkillDetails> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireSkill(skillId);
    await this.catalogRepository.setSkillDiscoverable(skillId, changes.discoverable);
    this.catalogLogger.onSkillDiscoveryChanged(skillId, changes.discoverable);
    return this.getSkill(skillId);
  }

  // Connections

  async createConnection(
    actorId: string,
    input: {
      kind?: 'http' | 'mcp';
      allowedTools?: string[];
      approvalTools?: string[];
      name: string;
      description: string;
      baseUrl: string;
      authHeader?: string;
      credential?: string;
      allowedMethods?: HttpMethod[];
      allowedPathPrefixes?: string[];
      approvalMethods?: HttpMethod[];
      discoverable?: boolean;
    }
  ): Promise<Connection> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    this.requireCredentialsKey(input.credential);
    const connection = await this.catalogRepository
      .createConnection({
        kind: input.kind ?? 'http',
        allowedTools: input.allowedTools ?? [],
        approvalTools: input.approvalTools ?? input.allowedTools ?? [],
        name: input.name,
        description: input.description,
        baseUrl: input.baseUrl,
        authHeader: input.authHeader ?? 'Authorization',
        credential: input.credential ?? null,
        allowedMethods: input.allowedMethods ?? [],
        allowedPathPrefixes: input.allowedPathPrefixes ?? [],
        // Reading is free; anything that changes something waits for a person, unless set.
        approvalMethods:
          input.approvalMethods ??
          (input.allowedMethods ?? []).filter((method) => method !== 'GET'),
        discoverable: input.discoverable ?? false,
        createdByHumanId: admin.id
      })
      .catch(toNameTaken);
    this.catalogLogger.onConnectionSaved(connection.id);
    return connection;
  }

  async discoverConnectionTools(actorId: string, connectionId: string): Promise<McpTool[]> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const connection = await this.requireConnection(connectionId);
    if (connection.kind !== 'mcp' || connection.disabledAt || !this.mcpClient) {
      throw new AppError('validationError', 'Choose an enabled MCP connection.');
    }
    let authorization: string | undefined;
    try {
      const headers = await this.connectionHeaders(connection);
      authorization = headers.Authorization;
      return await this.mcpClient.listTools({ url: connection.baseUrl, headers });
    } catch (error) {
      if (error instanceof McpAuthenticationError)
        await this.requireReconnect(connection.id, authorization);
      if (error instanceof AppError) throw error;
      throw new AppError(
        'validationError',
        'MCP discovery failed. Check the endpoint, credential, and supported schemas.'
      );
    }
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
    const current = await this.requireConnection(connectionId);
    if (
      current.kind === 'mcp' &&
      (changes.allowedMethods || changes.allowedPathPrefixes || changes.approvalMethods)
    ) {
      throw new AppError('validationError', 'MCP permissions use tool names.');
    }
    if (current.kind !== 'mcp' && (changes.allowedTools || changes.approvalTools)) {
      throw new AppError('validationError', 'HTTP permissions use methods and paths.');
    }
    // Newly allowed tools require approval until a person explicitly changes that policy.
    if (changes.allowedTools && !changes.approvalTools) {
      changes = {
        ...changes,
        approvalTools: [
          ...new Set([
            ...(current.approvalTools ?? []),
            ...changes.allowedTools.filter((name) => !(current.allowedTools ?? []).includes(name))
          ])
        ]
      };
    }
    this.requireCredentialsKey(changes.credential);
    const save = () =>
      this.catalogRepository.updateConnection(connectionId, changes).catch(toNameTaken);
    const authenticationChanged =
      changes.baseUrl !== undefined ||
      changes.authHeader !== undefined ||
      changes.credential !== undefined;
    const updated =
      this.oauthRepository && authenticationChanged
        ? await this.oauthRepository.withLock(connectionId, async (session) => {
            if (session && session.status !== 'disconnected') {
              throw new AppError(
                'validationError',
                'Disconnect OAuth before changing the endpoint or header credential.'
              );
            }
            return { session: null, result: await save() };
          })
        : await save();
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
      const chosen = await this.catalogRepository.getSkillVersions(skillVersionIds);
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

    const grant = await this.catalogRepository.grant({
      agentId,
      targetType: target.type,
      targetId: target.id,
      grantedByHumanId: admin.id,
      restoreRevoked: !changed
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
    const agent = await this.agentRepository.getById(agentId);
    if (!agent || agent.deletedAt) {
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

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
