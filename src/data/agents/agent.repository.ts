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

export interface AgentRepository {
  create(input: CreateAgentInput): Promise<Agent>;
  getById(agentId: string): Promise<Agent | null>;
  getByName(name: string): Promise<Agent | null>;
  list(input: { limit: number; offset: number; includeDisabled: boolean }): Promise<Agent[]>;
  count(input: { includeDisabled: boolean }): Promise<number>;
  update(agentId: string, changes: { name?: string; purpose?: string }): Promise<Agent | null>;
  setDisabled(agentId: string, disabled: boolean): Promise<Agent | null>;

  // Saves the next version number for the agent and makes it current.
  addVersion(agentId: string, input: CreateAgentVersionInput): Promise<AgentVersion>;
  getVersion(versionId: string): Promise<AgentVersion | null>;
  listVersions(agentId: string): Promise<AgentVersion[]>;
}
