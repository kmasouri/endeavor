// Only repositories, services, and integrations see this encrypted session state.
export interface ConnectionOAuthSession {
  resource: string;
  callbackUrl: string;
  actorId: string;
  status: 'pending' | 'connected' | 'disconnected' | 'reconnect_required';
  stateHash?: string;
  browserHash?: string;
  pendingExpiresAt?: number;
  expiresAt?: number;
  data: Record<string, unknown>;
}
