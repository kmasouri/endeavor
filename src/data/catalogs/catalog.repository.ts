import {
  AgentGrant,
  Connection,
  GrantTargetType,
  HttpMethod,
  Skill,
  SkillVersion
} from '../../shared/types';

// Thrown when a create or rename would give two skills, or two connections, the same name.
export class CatalogNameConflictError extends Error {
  constructor(name: string) {
    super(`The name ${name} is already used`);
    this.name = 'CatalogNameConflictError';
  }
}

export interface CreateSkillVersionInput {
  instructions: string;
  connectionIds: string[];
  createdByHumanId: string | null;
}

export interface ConnectionInput {
  name: string;
  description: string;
  baseUrl: string;
  authHeader: string;
  // Plain text in, encrypted at rest. Never read back through this interface except by
  // getConnectionCredential, which only the runner uses.
  credential: string | null;
  allowedMethods: HttpMethod[];
  allowedPathPrefixes: string[];
  createdByHumanId: string | null;
}

export interface CatalogRepository {
  // Saves the skill and its version 1 in one statement.
  createSkill(
    input: { name: string; description: string },
    firstVersion: CreateSkillVersionInput
  ): Promise<{ skill: Skill; version: SkillVersion }>;
  getSkill(skillId: string): Promise<Skill | null>;
  listSkills(input: { limit: number; offset: number }): Promise<Skill[]>;
  countSkills(): Promise<number>;
  // Saves the next version and makes it current.
  addSkillVersion(skillId: string, input: CreateSkillVersionInput): Promise<SkillVersion>;
  getSkillVersions(versionIds: string[]): Promise<SkillVersion[]>;
  listSkillVersions(skillId: string): Promise<SkillVersion[]>;
  setSkillDisabled(skillId: string, disabled: boolean): Promise<Skill | null>;

  createConnection(input: ConnectionInput): Promise<Connection>;
  getConnection(connectionId: string): Promise<Connection | null>;
  getConnections(connectionIds: string[]): Promise<Connection[]>;
  listConnections(input: { limit: number; offset: number }): Promise<Connection[]>;
  countConnections(): Promise<number>;
  // credential: a string replaces it, null removes it, undefined leaves it as is.
  updateConnection(
    connectionId: string,
    changes: Partial<Omit<ConnectionInput, 'createdByHumanId'>>
  ): Promise<Connection | null>;
  setConnectionDisabled(connectionId: string, disabled: boolean): Promise<Connection | null>;
  getConnectionCredential(connectionId: string): Promise<string | null>;

  // Grants (again) access. A revoked grant becomes active again.
  grant(input: {
    agentId: string;
    targetType: GrantTargetType;
    targetId: string;
    grantedByHumanId: string;
  }): Promise<AgentGrant>;
  // Returns false when there was no active grant.
  revoke(input: {
    agentId: string;
    targetType: GrantTargetType;
    targetId: string;
    revokedByHumanId: string;
  }): Promise<boolean>;
  listGrants(agentId: string, options: { activeOnly: boolean }): Promise<AgentGrant[]>;
}
