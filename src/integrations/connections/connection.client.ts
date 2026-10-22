import { HttpMethod } from '../../shared/types';

export interface ConnectionRequest {
  baseUrl: string;
  method: HttpMethod;
  // Path relative to baseUrl, starting with "/". May include a query string.
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface ConnectionResponse {
  status: number;
  body: string;
  truncated: boolean;
}

// Calls an outside HTTP API for an agent. It only sends the request: the runner decides whether
// the agent may make it.
export interface ConnectionClient {
  request(request: ConnectionRequest): Promise<ConnectionResponse>;
}
