import { Connection, HttpMethod } from '../../shared/types';

export interface ConnectionInput {
  authMethod?: 'none' | 'header' | 'oauth';
  kind?: 'http' | 'mcp';
  allowedTools?: string[];
  approvalTools?: string[];
  name: string;
  description: string;
  baseUrl: string;
  authHeader: string;
  // Plain text in, encrypted at rest. Never read back through this interface except by
  // getConnectionCredential, used for tool calls and connection discovery.
  credential: string | null;
  allowedMethods: HttpMethod[];
  allowedPathPrefixes: string[];
  approvalMethods: HttpMethod[];
  discoverable?: boolean;
  createdByHumanId: string | null;
}

export interface ConnectionRepository {
  createConnection(input: ConnectionInput): Promise<Connection>;
  getConnection(connectionId: string): Promise<Connection | null>;
  getConnections(connectionIds: string[]): Promise<Connection[]>;
  listConnections(input: { limit: number; offset: number }): Promise<Connection[]>;
  countConnections(): Promise<number>;
  // credential: a string replaces it, null removes it, undefined leaves it as is.
  updateConnection(
    connectionId: string,
    changes: Partial<Omit<ConnectionInput, 'createdByHumanId' | 'kind'>>
  ): Promise<Connection | null>;
  setConnectionDisabled(connectionId: string, disabled: boolean): Promise<Connection | null>;
  getConnectionCredential(connectionId: string): Promise<string | null>;
}
