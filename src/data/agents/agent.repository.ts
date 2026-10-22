import { Agent, AgentVersion, ModelProvider } from '../../shared/types';

export interface CreateAgentInput {
  name: string;
  purpose: string;
}

export interface CreateAgentVersionInput {
  instructions: string;
  provider: ModelProvider;
  model: string;
  skillIds: string[];
  connectionIds: string[];
  createdByHumanId: string | null;
}

// Thrown when a create or rename would give two agents the same name.
export class AgentNameConflictError extends Error {
  constructor(name: string) {
    super(`An agent named ${name} already exists`);
    this.name = 'AgentNameConflictError';
  }
}

export interface AgentRepository {
  // Saves the agent and its version 1 in one statement, so neither exists without the other.
  create(
    input: CreateAgentInput,
    firstVersion: CreateAgentVersionInput
  ): Promise<{ agent: Agent; version: AgentVersion }>;
  getById(agentId: string): Promise<Agent | null>;
  getByName(name: string): Promise<Agent | null>;
  list(input: { limit: number; offset: number; includeDisabled: boolean }): Promise<Agent[]>;
  count(input: { includeDisabled: boolean }): Promise<number>;
  // The directory: enabled agents with a configuration, minus excludeIds, by name.
  listDirectory(input: { excludeIds: string[]; limit: number; offset: number }): Promise<Agent[]>;
  countDirectory(input: { excludeIds: string[] }): Promise<number>;
  update(agentId: string, changes: { name?: string; purpose?: string }): Promise<Agent | null>;
  setDisabled(agentId: string, disabled: boolean): Promise<Agent | null>;

  // Saves the next version number for the agent and makes it current.
  addVersion(agentId: string, input: CreateAgentVersionInput): Promise<AgentVersion>;
  getVersion(versionId: string): Promise<AgentVersion | null>;
  getVersions(versionIds: string[]): Promise<AgentVersion[]>;
  listVersions(agentId: string): Promise<AgentVersion[]>;
}
