import { FastifyInstance } from 'fastify';
import { Agent, AgentVersion } from '../../shared/types';
import { AgentRepository } from './agent.repository';

interface AgentRow {
  id: string;
  name: string;
  purpose: string;
  current_version_id: string | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AgentVersionRow {
  id: string;
  agent_id: string;
  version: number;
  instructions: string;
  provider: string;
  model: string;
  skill_ids: string[];
  connection_ids: string[];
  created_by_human_id: string | null;
  created_at: Date;
}

export class AgentPostgresRepository implements AgentRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async getById(agentId: string): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM bold_cedar_007.agents
       WHERE id = $1`,
      [agentId]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async getVersion(versionId: string): Promise<AgentVersion | null> {
    const result = await this.db.query<AgentVersionRow>(
      `SELECT *
       FROM bold_cedar_007.agent_versions
       WHERE id = $1`,
      [versionId]
    );

    return result.rows[0] ? toAgentVersion(result.rows[0]) : null;
  }
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    currentVersionId: row.current_version_id,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAgentVersion(row: AgentVersionRow): AgentVersion {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: row.version,
    instructions: row.instructions,
    provider: row.provider,
    model: row.model,
    skillIds: row.skill_ids,
    connectionIds: row.connection_ids,
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at
  };
}
