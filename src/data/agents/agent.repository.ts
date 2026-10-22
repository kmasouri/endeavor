import { Agent, AgentVersion } from '../../shared/types';

export interface AgentRepository {
  getById(agentId: string): Promise<Agent | null>;
  getVersion(versionId: string): Promise<AgentVersion | null>;
}
