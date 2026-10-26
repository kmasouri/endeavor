import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens
} from '@modelcontextprotocol/client';
import { ConnectionOAuthSession } from '../../shared/connection-oauth';

export interface ConnectionOAuthClient {
  begin(session: ConnectionOAuthSession, state: string): Promise<string>;
  finish(session: ConnectionOAuthSession, code: string, issuer?: string): Promise<void>;
  headers(session: ConnectionOAuthSession): Promise<Record<string, string>>;
}

// The SDK handles discovery, issuer validation, DCR, PKCE, and resource indicators.
// Persistence and access decisions belong to services, never this client.
export class ConnectionOAuthHttpClient implements ConnectionOAuthClient {
  private provider(
    session: ConnectionOAuthSession,
    redirect: (url: URL) => void,
    state?: string
  ): OAuthClientProvider {
    return {
      redirectUrl: session.callbackUrl,
      clientMetadata: {
        client_name: 'Endeavor',
        redirect_uris: [session.callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      },
      state: () => state ?? '',
      clientInformation: () => session.data.client as StoredOAuthClientInformation | undefined,
      saveClientInformation: (client) => {
        session.data.client = client;
      },
      tokens: () => session.data.tokens as StoredOAuthTokens | undefined,
      saveTokens: (tokens) => {
        if (tokens.token_type.toLowerCase() !== 'bearer') throw new Error('Unsupported token type');
        const old = session.data.tokens as StoredOAuthTokens | undefined;
        session.data.tokens = {
          ...tokens,
          refresh_token: tokens.refresh_token ?? old?.refresh_token
        };
        session.expiresAt =
          tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000;
      },
      redirectToAuthorization: (url) => {
        requireSecureUrl(url);
        redirect(url);
      },
      saveCodeVerifier: (verifier) => {
        session.data.verifier = verifier;
      },
      codeVerifier: () => String(session.data.verifier ?? ''),
      saveDiscoveryState: (discovery) => {
        if (!discovery.resourceMetadata?.resource)
          throw new Error('Protected resource metadata is required');
        session.data.discovery = discovery;
      },
      discoveryState: () => session.data.discovery as OAuthDiscoveryState | undefined,
      invalidateCredentials: (scope) => {
        if (scope === 'all' || scope === 'tokens') {
          delete session.data.tokens;
          delete session.expiresAt;
        }
        if (scope === 'all' || scope === 'client') delete session.data.client;
        if (scope === 'all' || scope === 'verifier') delete session.data.verifier;
        if (scope === 'all' || scope === 'discovery') delete session.data.discovery;
      }
    };
  }

  private async run(
    session: ConnectionOAuthSession,
    options: { state?: string; code?: string; issuer?: string; redirect: (url: URL) => void }
  ) {
    const deadline = AbortSignal.timeout(30_000);
    return auth(this.provider(session, options.redirect, options.state), {
      serverUrl: session.resource,
      authorizationCode: options.code,
      iss: options.issuer,
      fetchFn: async (url, init) => {
        requireSecureUrl(new URL(String(url)));
        const response = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])])
        });
        // Bound all metadata and token response bodies; never print their content.
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 2_000_000) throw new Error('OAuth response too large');
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
          }
        }
        let body: BodyInit | null = size ? Buffer.concat(chunks) : null;
        if (!response.ok) {
          // The SDK may warn when invalidating credentials. Strip provider text before
          // it reaches the SDK, since error descriptions can echo submitted secrets.
          let error = 'server_error';
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              [
                'invalid_grant',
                'invalid_client',
                'unauthorized_client',
                'invalid_request',
                'invalid_scope',
                'access_denied',
                'temporarily_unavailable'
              ].includes(parsed.error)
            )
              error = parsed.error;
          } catch {
            /* Non-JSON errors have no safe provider details. */
          }
          body = JSON.stringify({ error });
        }
        return new Response(body, { status: response.status, headers: response.headers });
      }
    });
  }

  async begin(session: ConnectionOAuthSession, state: string): Promise<string> {
    let url = '';
    const result = await this.run(session, {
      state,
      redirect: (value) => {
        url = value.href;
      }
    });
    if (result !== 'REDIRECT' || !url || !session.data.discovery || !session.data.verifier)
      throw new Error('OAuth setup failed');
    return url;
  }

  async finish(session: ConnectionOAuthSession, code: string, issuer?: string): Promise<void> {
    const result = await this.run(session, {
      code,
      issuer,
      redirect: () => {
        throw new Error('Sign in again');
      }
    });
    if (result !== 'AUTHORIZED') throw new Error('Sign in again');
    delete session.data.verifier;
  }

  async headers(session: ConnectionOAuthSession): Promise<Record<string, string>> {
    if (session.status !== 'connected') throw new Error('Sign in required');
    if (session.expiresAt !== undefined && session.expiresAt <= Date.now() + 60_000) {
      const tokens = session.data.tokens as StoredOAuthTokens | undefined;
      if (!tokens?.refresh_token) throw new Error('Sign in required');
      const result = await this.run(session, {
        redirect: () => {
          throw new Error('Sign in required');
        }
      });
      if (result !== 'AUTHORIZED') throw new Error('Sign in required');
    }
    const tokens = session.data.tokens as StoredOAuthTokens | undefined;
    if (!tokens?.access_token) throw new Error('Sign in required');
    return { Authorization: `Bearer ${tokens.access_token}` };
  }
}

function requireSecureUrl(url: URL): void {
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  ) {
    throw new Error('OAuth requires HTTPS');
  }
}
