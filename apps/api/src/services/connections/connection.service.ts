import { createHash, randomBytes } from 'node:crypto';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';
import {
  ConnectionOAuthRepository,
  ConnectionRepository,
  CatalogNameConflictError,
  HumanRepository
} from '../../data';
import {
  ConnectionOAuthClient,
  McpAuthenticationError,
  McpClient,
  McpTool
} from '../../integrations';
import { ConnectionLogger } from '../../observability';
import { Connection, HttpMethod } from '../../shared/types';
import { ADMIN_ONLY, requireHuman } from '../access/access.rules';
import { AppError } from '../../shared/errors';

export interface ConnectionChanges {
  authMethod?: 'none' | 'header' | 'oauth';
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

export class ConnectionService {
  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly humanRepository: HumanRepository,
    private readonly credentialsReady: boolean,
    private readonly connectionLogger: ConnectionLogger,
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
        ? connection.authMethod === 'oauth'
          ? 'disconnected'
          : 'header'
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
      await this.connectionRepository.updateConnection(connection.id, { authMethod: 'oauth' });
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
    this.connectionLogger.onConnectionAuthentication(connectionId, 'pending');
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
    this.connectionLogger.onConnectionAuthentication(
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
    this.connectionLogger.onConnectionAuthentication(connectionId, 'disconnected');
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
          if (!session)
            return { session, result: connection.authMethod === 'oauth' ? (false as const) : null };
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
    if (connection.authMethod === 'oauth') throw new AppError('connectionSignInRequired');
    const credential = await this.connectionRepository.getConnectionCredential(connection.id);
    if (connection.authMethod === 'header' && !credential) {
      throw new AppError(
        'validationError',
        'Add an API key or token in this connection’s configuration before continuing.'
      );
    }
    return credential ? { [connection.authHeader]: credential } : {};
  }

  private validateAuthentication(kind: string, method?: string, credential?: string | null) {
    if (method === 'oauth' && kind !== 'mcp')
      throw new AppError('validationError', 'OAuth sign-in requires an MCP connection.');
    if ((method === 'none' || method === 'oauth') && credential)
      throw new AppError(
        'validationError',
        'Only API key / token authentication accepts a credential.'
      );
  }

  private async withAuthentication(connection: Connection): Promise<Connection> {
    const authMethod = connection.authMethod ?? (connection.hasCredential ? 'header' : 'none');
    let authenticated =
      authMethod === 'none' || (authMethod === 'header' && Boolean(connection.hasCredential));
    if (authMethod === 'oauth') {
      const session = await this.oauthRepository?.get(connection.id);
      const tokens = session?.data.tokens as
        { access_token?: string; refresh_token?: string } | undefined;
      authenticated = Boolean(
        session?.status === 'connected' &&
        session.resource === connection.baseUrl &&
        tokens?.access_token &&
        (session.expiresAt === undefined || session.expiresAt > Date.now() || tokens.refresh_token)
      );
    }
    return { ...connection, authMethod, authenticated };
  }

  async createConnection(
    actorId: string,
    input: {
      kind?: 'http' | 'mcp';
      authMethod?: 'none' | 'header' | 'oauth';
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
    this.validateAuthentication(input.kind ?? 'http', input.authMethod, input.credential);
    this.requireCredentialsKey(input.credential);
    const connection = await this.connectionRepository
      .createConnection({
        authMethod: input.authMethod ?? (input.credential ? 'header' : 'none'),
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
    this.connectionLogger.onConnectionSaved(connection.id);
    return this.withAuthentication(connection);
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
      this.connectionRepository.listConnections(input),
      this.connectionRepository.countConnections()
    ]);
    return {
      connections: await Promise.all(
        connections.map((connection) => this.withAuthentication(connection))
      ),
      total
    };
  }

  async getConnection(connectionId: string): Promise<Connection> {
    return this.withAuthentication(await this.requireConnection(connectionId));
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
    this.validateAuthentication(current.kind ?? 'http', changes.authMethod, changes.credential);
    if (changes.credential && changes.authMethod === undefined)
      changes = { ...changes, authMethod: 'header' };
    if (changes.authMethod === 'none' || changes.authMethod === 'oauth')
      changes = { ...changes, credential: null };
    this.requireCredentialsKey(changes.credential);
    const save = () =>
      this.connectionRepository.updateConnection(connectionId, changes).catch(toNameTaken);
    const authenticationChanged =
      changes.authMethod !== undefined ||
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
    this.connectionLogger.onConnectionSaved(connectionId);
    return this.withAuthentication(updated ?? (await this.requireConnection(connectionId)));
  }

  async setConnectionDisabled(
    actorId: string,
    connectionId: string,
    disabled: boolean
  ): Promise<Connection> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireConnection(connectionId);
    const updated = await this.connectionRepository.setConnectionDisabled(connectionId, disabled);
    return this.withAuthentication(updated ?? (await this.requireConnection(connectionId)));
  }

  private requireCredentialsKey(credential: string | null | undefined): void {
    if (typeof credential === 'string' && !this.credentialsReady) {
      throw new AppError('credentialsKeyMissing');
    }
  }

  private async requireConnection(connectionId: string): Promise<Connection> {
    const connection = await this.connectionRepository.getConnection(connectionId);
    if (!connection) {
      throw new AppError('connectionNotFound', `Connection ${connectionId} was not found`);
    }
    return connection;
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
