import { ConnectionOAuthSession } from '../../shared/connection-oauth';

export interface ConnectionOAuthRepository {
  get(connectionId: string): Promise<ConnectionOAuthSession | null>;
  // Serialize transitions across workers, including rotating refresh tokens and disconnects.
  withLock<T>(
    connectionId: string,
    work: (session: ConnectionOAuthSession | null) => Promise<{
      session: ConnectionOAuthSession | null;
      result: T;
    }>
  ): Promise<T>;
}
