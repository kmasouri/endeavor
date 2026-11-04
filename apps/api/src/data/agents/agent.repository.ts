import {
  AgentProfileFields,
  AgentProfile,
  AgentAppearance,
  Agent,
  AgentLimits,
  AgentVersion,
  ModelProvider
} from '../../shared/types';

export interface CreateAgentInput extends AgentProfileFields {
  name: string;
  purpose: string;
}

export interface CreateAgentVersionInput {
  instructions: string;
  provider: ModelProvider;
  model: string;
  skillVersionIds: string[];
  connectionIds: string[];
  limits: AgentLimits;
  createdByHumanId: string | null;
}

// Thrown when a create or rename would give two agents the same name.
export class AgentNameConflictError extends Error {
  constructor(name: string) {
    super(`An agent named ${name} already exists`);
    this.name = 'AgentNameConflictError';
  }
}

export class AgentConfigConflictError extends Error {
  constructor() {
    super('The configuration changed while you were editing. Reload and try again.');
  }
}

export interface AgentAccessChanges {
  expectedVersionId?: string;
  grant: { type: 'skill' | 'connection'; id: string }[];
  revoke: { type: 'skill' | 'connection'; id: string }[];
  actorId: string;
}

export interface AgentDeletionImpact {
  tasks: { id: string; title: string; state: string }[];
  schedules: { id: string; title: string; status: string }[];
}

export interface AgentRepository {
  getDeletionImpact(agentId: string): Promise<AgentDeletionImpact>;
  delete(agentId: string, actorId: string): Promise<boolean>;
  // Holds a shared database lock until the call finishes. Deletion waits for these calls.
  acquireExecution(agentId: string): Promise<(() => Promise<void>) | null>;
  // Saves the agent and its version 1 in one statement, so neither exists without the other.
  create(
    input: CreateAgentInput,
    firstVersion: CreateAgentVersionInput,
    access?: AgentAccessChanges
  ): Promise<{ agent: Agent; version: AgentVersion }>;
  getProfiles(agentIds: string[], conversationId: string | null): Promise<AgentProfile[]>;
  getById(agentId: string): Promise<Agent | null>;
  getByName(name: string): Promise<Agent | null>;
  list(input: { limit: number; offset: number; includeDisabled: boolean }): Promise<Agent[]>;
  count(input: { includeDisabled: boolean }): Promise<number>;
  // The directory: enabled agents with a configuration, minus excludeIds, by name.
  listDirectory(input: { excludeIds: string[]; limit: number; offset: number }): Promise<Agent[]>;
  // Search public profiles across the full visible directory, before limiting results.
  searchDirectory(input: {
    excludeIds: string[];
    terms: string[];
    limit: number;
  }): Promise<AgentProfile[]>;
  countDirectory(input: { excludeIds: string[] }): Promise<number>;
  // monthlyBudgetUsd: a number sets the cap, null removes it, undefined leaves it.
  update(
    agentId: string,
    changes: AgentAppearance &
      AgentProfileFields & { name?: string; purpose?: string; monthlyBudgetUsd?: number | null }
  ): Promise<Agent | null>;
  setDisabled(agentId: string, disabled: boolean): Promise<Agent | null>;

  // Saves the next version number for the agent and makes it current.
  addVersion(
    agentId: string,
    input: CreateAgentVersionInput,
    access?: AgentAccessChanges
  ): Promise<AgentVersion>;
  getVersion(versionId: string): Promise<AgentVersion | null>;
  getVersions(versionIds: string[]): Promise<AgentVersion[]>;
  listVersions(agentId: string): Promise<AgentVersion[]>;
}
