import { createHash } from 'node:crypto';
import { ConnectionOAuthRepository } from '../../data';
import {
  mockAgentRepository,
  mockCatalogRepository,
  mockHumanRepository
} from '../../data/repositories.test-helper';
import { ConnectionOAuthClient, McpAuthenticationError, McpClient } from '../../integrations';
import { CatalogLogger } from '../../observability';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';
import { CatalogService } from './catalog.service';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function setup() {
  let session: ConnectionOAuthSession | null = null;
  const repository: ConnectionOAuthRepository = {
    get: jest.fn(async () => structuredClone(session)),
    async withLock(_id, work) {
      const next = await work(structuredClone(session));
      session = next.session;
      return next.result;
    }
  };
  const catalogs = mockCatalogRepository();
  const agents = mockAgentRepository();
  const humans = mockHumanRepository();
  const connection = {
    id: 'c1',
    kind: 'mcp',
    baseUrl: 'https://docs.example/mcp',
    authHeader: 'Authorization',
    disabledAt: null
  };
  catalogs.getConnection.mockImplementation(async () => connection as never);
  catalogs.updateConnection.mockResolvedValue(connection as never);
  humans.getById.mockResolvedValue({ id: 'h1', role: 'admin' } as never);
  const logger = {
    onConnectionAuthentication: jest.fn(),
    onConnectionSaved: jest.fn()
  } as unknown as CatalogLogger;
  const oauth: jest.Mocked<ConnectionOAuthClient> = {
    begin: jest.fn(async (value, nonce) => {
      value.data.verifier = 'private-verifier';
      return `https://docs.example/authorize?state=${nonce}`;
    }),
    finish: jest
      .fn<
        ReturnType<ConnectionOAuthClient['finish']>,
        Parameters<ConnectionOAuthClient['finish']>
      >()
      .mockImplementation(async (value) => {
        value.data.tokens = { access_token: 'secret' };
        value.expiresAt = Date.now() + 3600000;
      }),
    headers: jest
      .fn<
        ReturnType<ConnectionOAuthClient['headers']>,
        Parameters<ConnectionOAuthClient['headers']>
      >()
      .mockResolvedValue({ Authorization: 'Bearer secret' })
  };
  const mcp: jest.Mocked<McpClient> = {
    listTools: jest
      .fn<ReturnType<McpClient['listTools']>, Parameters<McpClient['listTools']>>()
      .mockResolvedValue([]),
    callTool: jest.fn()
  };
  const service = new CatalogService(
    catalogs,
    agents,
    humans,
    true,
    logger,
    mcp,
    repository,
    oauth,
    'http://localhost:3100'
  );
  return {
    service,
    catalogs,
    agents,
    humans,
    oauth,
    mcp,
    connection,
    get session() {
      return session;
    },
    set session(value: ConnectionOAuthSession | null) {
      session = value;
    }
  };
}
async function pending(ctx: ReturnType<typeof setup>) {
  const result = await ctx.service.startOAuth('h1', 'c1');
  const state = new URL(result.authorizationUrl).searchParams.get('state')!;
  return { ...result, state };
}

describe('catalog OAuth lifecycle', () => {
  it('binds consent to actor, browser, connection and callback; exposes only status', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    expect(ctx.session?.actorId).toBe('h1');
    expect(ctx.session?.stateHash).toBe(hash(flow.state));
    expect(ctx.session?.browserHash).toBe(hash(flow.browserKey));
    expect(flow.callbackUrl).toBe('http://localhost:3100/connections/c1/oauth/callback');
    expect(
      await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey)
    ).toContain('oauth=connected');
    expect(ctx.session?.status).toBe('connected');
    expect(ctx.session?.stateHash).toBeUndefined();
    const status = await ctx.service.oauthStatus('h1', 'c1');
    expect(status.status).toBe('connected');
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(ctx.catalogs.grant).not.toHaveBeenCalled();
    expect(ctx.agents.addVersion).not.toHaveBeenCalled();
    await expect(
      ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey)
    ).rejects.toMatchObject({ name: 'connectionOAuthCallbackInvalid' });
    expect(ctx.oauth.finish).toHaveBeenCalledTimes(1);
  });

  it.each(['state', 'browser', 'expired', 'resource', 'disabled'])(
    'rejects %s mismatch before token exchange',
    async (problem) => {
      const ctx = setup();
      const flow = await pending(ctx);
      if (problem === 'expired') ctx.session!.pendingExpiresAt = Date.now() - 1;
      if (problem === 'resource') ctx.connection.baseUrl = 'https://other.example/mcp';
      if (problem === 'disabled') Object.assign(ctx.connection, { disabledAt: new Date() });
      await expect(
        ctx.service.finishOAuth(
          'c1',
          { state: problem === 'state' ? 'wrong' : flow.state, code: 'code' },
          problem === 'browser' ? 'wrong' : flow.browserKey
        )
      ).rejects.toMatchObject({ name: 'connectionOAuthCallbackInvalid' });
      expect(ctx.oauth.finish).not.toHaveBeenCalled();
    }
  );

  it('consumes denied consent without exposing provider details', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    expect(
      await ctx.service.finishOAuth(
        'c1',
        { state: flow.state, error: 'private-provider-message' },
        flow.browserKey
      )
    ).toContain('oauth=failed');
    expect(ctx.session?.data).toEqual({});
    expect(ctx.oauth.finish).not.toHaveBeenCalled();
    expect(ctx.session?.stateHash).toBeUndefined();
  });

  it('disconnect clears tokens and pending callbacks and prevents header fallback', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey);
    await ctx.service.disconnectOAuth('h1', 'c1');
    expect(ctx.session?.status).toBe('disconnected');
    expect(ctx.session?.data).toEqual({});
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toMatchObject({
      name: 'connectionSignInRequired'
    });
    expect(ctx.catalogs.getConnectionCredential).not.toHaveBeenCalled();
    expect(ctx.mcp.listTools).not.toHaveBeenCalled();
  });

  it('failed refresh persists reconnect-required and does not leak or use credentials', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey);
    ctx.oauth.headers.mockRejectedValue(new Error('secret-refresh-token'));
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toMatchObject({
      name: 'connectionSignInRequired'
    });
    expect(ctx.session?.data).toEqual({});
    expect(ctx.session?.status).toBe('reconnect_required');
    expect(ctx.mcp.listTools).not.toHaveBeenCalled();
  });

  it('a revoked server token clears authentication and requires reconnect', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey);
    ctx.mcp.listTools.mockRejectedValue(new McpAuthenticationError());
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toThrow();
    expect(ctx.session?.status).toBe('reconnect_required');
    expect(ctx.session?.data).toEqual({});
  });

  it('an old in-flight 401 cannot erase a newer sign-in', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey);
    ctx.mcp.listTools.mockImplementation(async () => {
      ctx.session!.data.tokens = { access_token: 'newly-signed-in-token' };
      throw new McpAuthenticationError();
    });
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toThrow();
    expect(ctx.session?.status).toBe('connected');
    expect(ctx.session?.data.tokens).toEqual({ access_token: 'newly-signed-in-token' });
  });

  it('discovery during consent preserves the pending callback', async () => {
    const ctx = setup();
    const flow = await pending(ctx);
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toMatchObject({
      name: 'connectionSignInRequired'
    });
    expect(ctx.session?.status).toBe('pending');
    expect(ctx.session?.stateHash).toBe(hash(flow.state));
  });

  it('requires disconnect before an endpoint or header-credential change', async () => {
    const ctx = setup();
    await pending(ctx);
    ctx.catalogs.updateConnection.mockClear();
    await expect(
      ctx.service.updateConnection('h1', 'c1', { baseUrl: 'https://other.example/mcp' })
    ).rejects.toThrow('Disconnect OAuth');
    expect(ctx.catalogs.updateConnection).not.toHaveBeenCalled();
    await ctx.service.disconnectOAuth('h1', 'c1');
    await ctx.service.updateConnection('h1', 'c1', { credential: 'Bearer replacement' });
    expect(ctx.session).toBeNull();
    expect(ctx.catalogs.updateConnection).toHaveBeenCalledWith('c1', {
      credential: 'Bearer replacement',
      authMethod: 'header'
    });
  });

  it('reports OAuth authentication separately from whether a connection is enabled', async () => {
    const ctx = setup();
    Object.assign(ctx.connection, { authMethod: 'oauth' });
    expect(await ctx.service.getConnection('c1')).toMatchObject({
      authMethod: 'oauth',
      authenticated: false,
      disabledAt: null
    });
    const flow = await pending(ctx);
    await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey);
    expect(await ctx.service.getConnection('c1')).toMatchObject({ authenticated: true });
    ctx.session!.expiresAt = Date.now() - 1;
    expect(await ctx.service.getConnection('c1')).toMatchObject({ authenticated: false });
    ctx.session!.data.tokens = { access_token: 'secret', refresh_token: 'refresh' };
    expect(await ctx.service.getConnection('c1')).toMatchObject({ authenticated: true });
    await ctx.service.disconnectOAuth('h1', 'c1');
    expect(await ctx.service.getConnection('c1')).toMatchObject({ authenticated: false });
  });

  it('does not contact a header-auth server when its required token is missing', async () => {
    const ctx = setup();
    Object.assign(ctx.connection, { authMethod: 'header' });
    ctx.catalogs.getConnectionCredential.mockResolvedValue(null);
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toThrow(
      'Add an API key or token'
    );
    expect(ctx.mcp.listTools).not.toHaveBeenCalled();
    expect(await ctx.service.getConnection('c1')).toMatchObject({ authenticated: false });
  });

  it('never falls back to headers for an OAuth connection with no session', async () => {
    const ctx = setup();
    Object.assign(ctx.connection, { authMethod: 'oauth' });
    ctx.catalogs.getConnectionCredential.mockResolvedValue('Bearer old-token');
    await expect(ctx.service.discoverConnectionTools('h1', 'c1')).rejects.toMatchObject({
      name: 'connectionSignInRequired'
    });
    expect(ctx.mcp.listTools).not.toHaveBeenCalled();
    expect(ctx.catalogs.getConnectionCredential).not.toHaveBeenCalled();
  });

  it('keeps OAuth selected after setup fails before consent', async () => {
    const ctx = setup();
    ctx.oauth.begin.mockRejectedValue(new Error('unavailable'));
    await expect(ctx.service.startOAuth('h1', 'c1')).rejects.toMatchObject({
      name: 'connectionOAuthFailed'
    });
    expect(ctx.catalogs.updateConnection).toHaveBeenCalledWith('c1', { authMethod: 'oauth' });
  });

  it('rejects OAuth on HTTP connections and hidden credentials for non-header methods', async () => {
    const ctx = setup();
    for (const authMethod of ['none', 'oauth'] as const) {
      await expect(
        ctx.service.createConnection('h1', {
          name: 'Docs',
          description: 'Docs',
          baseUrl: 'https://docs.example',
          kind: 'mcp',
          authMethod,
          credential: 'secret'
        })
      ).rejects.toMatchObject({ name: 'validationError' });
    }
    await expect(
      ctx.service.createConnection('h1', {
        name: 'Docs',
        description: 'Docs',
        baseUrl: 'https://docs.example',
        kind: 'http',
        authMethod: 'oauth'
      })
    ).rejects.toMatchObject({ name: 'validationError' });
    expect(ctx.catalogs.createConnection).not.toHaveBeenCalled();
  });

  it('includes authentication status in catalog lists without exposing tokens', async () => {
    const ctx = setup();
    Object.assign(ctx.connection, { authMethod: 'oauth' });
    ctx.catalogs.listConnections.mockResolvedValue([ctx.connection as never]);
    ctx.catalogs.countConnections.mockResolvedValue(1);
    const flow = await pending(ctx);
    await ctx.service.finishOAuth('c1', { state: flow.state, code: 'code' }, flow.browserKey);
    const result = await ctx.service.listConnections({ limit: 100, offset: 0 });
    expect(result.connections[0]).toMatchObject({ authMethod: 'oauth', authenticated: true });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('preserves existing header authentication when OAuth has not been selected', async () => {
    const ctx = setup();
    ctx.catalogs.getConnectionCredential.mockResolvedValue('Bearer existing');
    await ctx.service.discoverConnectionTools('h1', 'c1');
    expect(ctx.mcp.listTools).toHaveBeenCalledWith({
      url: ctx.connection.baseUrl,
      headers: { Authorization: 'Bearer existing' }
    });
  });
});
