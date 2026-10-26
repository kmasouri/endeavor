import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { ConnectionOAuthHttpClient } from './connection-oauth.client';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';

// A local authorization server verifies the real SDK flow, without a Notion account.
describe('MCP OAuth client', () => {
  let server: Server;
  let origin: string;
  let session: ConnectionOAuthSession;
  let exchanges: URLSearchParams[];
  let rejectRefresh: boolean;
  let metadataResource: string | undefined;
  let metadataRedirect: boolean;
  let authorizationEndpoint: string | undefined;
  const client = new ConnectionOAuthHttpClient();
  beforeEach(async () => {
    exchanges = [];
    rejectRefresh = false;
    metadataResource = undefined;
    metadataRedirect = false;
    authorizationEndpoint = undefined;
    server = createServer(async (req, res) => {
      const path = new URL(req.url!, origin).pathname;
      res.setHeader('Content-Type', 'application/json');
      if (path.includes('oauth-protected-resource')) {
        if (metadataRedirect) {
          res.writeHead(302, { location: `${origin}/other` });
          res.end();
          return;
        }
        res.end(
          JSON.stringify({
            resource: metadataResource ?? origin,
            authorization_servers: [origin],
            scopes_supported: ['docs:read']
          })
        );
      } else if (
        path.includes('oauth-authorization-server') ||
        path.includes('openid-configuration')
      ) {
        res.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: authorizationEndpoint ?? `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            code_challenge_methods_supported: ['S256'],
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            authorization_response_iss_parameter_supported: true
          })
        );
      } else if (path === '/register') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        res.end(JSON.stringify({ ...JSON.parse(raw), client_id: 'test-client' }));
      } else if (path === '/token') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const params = new URLSearchParams(raw);
        exchanges.push(params);
        if (rejectRefresh && params.get('grant_type') === 'refresh_token') {
          res.writeHead(400);
          res.end(
            JSON.stringify({ error: 'invalid_grant', error_description: 'secret-refresh-token' })
          );
        } else
          res.end(
            JSON.stringify({
              access_token:
                params.get('grant_type') === 'refresh_token' ? 'refreshed-access' : 'first-access',
              refresh_token: 'rotated-refresh',
              token_type: 'Bearer',
              expires_in: 3600
            })
          );
      } else {
        res.writeHead(404);
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    session = {
      resource: `${origin}/mcp`,
      callbackUrl: 'http://localhost:3100/connections/c1/oauth/callback',
      actorId: 'h1',
      status: 'pending',
      data: {}
    };
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('registers, binds consent to state, PKCE and resource, exchanges a code, and refreshes', async () => {
    const consent = new URL(await client.begin(session, 'random-browser-state'));
    expect(consent.searchParams.get('state')).toBe('random-browser-state');
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    expect(consent.searchParams.get('resource')).toBe(origin);
    expect(consent.searchParams.get('scope')).toBe('docs:read');
    const verifier = String(session.data.verifier);
    expect(consent.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url')
    );
    await client.finish(session, 'one-time-code', origin);
    expect(exchanges[0].get('code_verifier')).toBe(verifier);
    expect(exchanges[0].get('resource')).toBe(origin);
    expect(exchanges[0].get('redirect_uri')).toBe(session.callbackUrl);
    expect(session.data.verifier).toBeUndefined();
    session.status = 'connected';
    expect(await client.headers(session)).toEqual({ Authorization: 'Bearer first-access' });
    session.expiresAt = Date.now() - 1;
    expect(await client.headers(session)).toEqual({ Authorization: 'Bearer refreshed-access' });
    expect(exchanges[1].get('grant_type')).toBe('refresh_token');
    expect(exchanges[1].get('resource')).toBe(origin);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it.each(['http://attacker.example', undefined])(
    'rejects callback issuer %s before code exchange',
    async (issuer) => {
      await client.begin(session, 'state');
      await expect(client.finish(session, 'secret-code', issuer)).rejects.toThrow();
      expect(exchanges).toHaveLength(0);
    }
  );

  it('rejects another resource and refuses metadata redirects', async () => {
    metadataResource = 'https://another.example';
    await expect(client.begin(session, 'state')).rejects.toThrow();
    metadataResource = undefined;
    metadataRedirect = true;
    await expect(client.begin(session, 'state')).rejects.toThrow();
  });

  it('refuses insecure remote authorization endpoints before opening the browser', async () => {
    authorizationEndpoint = 'http://remote.example/authorize';
    await expect(client.begin(session, 'state')).rejects.toThrow('OAuth requires HTTPS');
  });

  it('does not open browser consent during unattended expiry or invalid refresh', async () => {
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await client.begin(session, 'state');
    await client.finish(session, 'code', origin);
    session.status = 'connected';
    session.expiresAt = Date.now() - 1;
    rejectRefresh = true;
    await expect(client.headers(session)).rejects.toThrow();
    session.data.tokens = { access_token: 'expired', token_type: 'Bearer' };
    session.expiresAt = Date.now() - 1;
    await expect(client.headers(session)).rejects.toThrow('Sign in required');
    expect(JSON.stringify(warnings.mock.calls)).not.toContain('secret-refresh-token');
    warnings.mockRestore();
    session.status = 'disconnected';
    await expect(client.headers(session)).rejects.toThrow('Sign in required');
  });
});
