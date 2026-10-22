import { ConnectionClient, ConnectionRequest, ConnectionResponse } from './connection.client';

export class ConnectionHttpClient implements ConnectionClient {
  constructor(
    private readonly options: { timeoutMs: number; maxResponseChars: number } = {
      timeoutMs: 30_000,
      maxResponseChars: 20_000
    }
  ) {}

  async request(request: ConnectionRequest): Promise<ConnectionResponse> {
    const url = joinUrl(request.baseUrl, request.path);
    const response = await fetch(url, {
      method: request.method,
      headers: {
        ...(request.body !== null && { 'content-type': 'application/json' }),
        ...request.headers
      },
      body: request.body,
      // Don't follow redirects, so a call can't leave the connection's allowed paths.
      redirect: 'manual',
      signal: AbortSignal.timeout(this.options.timeoutMs)
    });

    const text = await response.text();
    const truncated = text.length > this.options.maxResponseChars;
    return {
      status: response.status,
      body: truncated ? text.slice(0, this.options.maxResponseChars) : text,
      truncated
    };
  }
}

// Joins a base URL and a path without letting the path change the host.
export function joinUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const joined = new URL(base.pathname.replace(/\/+$/, '') + path, base.origin);
  if (joined.origin !== base.origin) {
    throw new Error('The path must stay on the connection host');
  }
  return joined.toString();
}
