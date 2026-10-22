import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Agent, AgentVersion, ModelProvider } from '../../shared/types';
import { AgentRepository, CreateAgentInput, CreateAgentVersionInput } from './agent.repository';

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
  provider: ModelProvider;
  model: string;
  skill_ids: string[];
  connection_ids: string[];
  created_by_human_id: string | null;
  created_at: Date;
}

const UNIQUE_VIOLATION = '23505';

export class AgentPostgresRepository implements AgentRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: CreateAgentInput): Promise<Agent> {
    const result = await this.db.query<AgentRow>(
      `INSERT INTO bold_cedar_007.agents (id, name, purpose)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [randomUUID(), input.name, input.purpose]
    );

    return toAgent(result.rows[0]);
  }

  async getByName(name: string): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM bold_cedar_007.agents
       WHERE lower(name) = lower($1)`,
      [name]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async list(input: { limit: number; offset: number; includeDisabled: boolean }): Promise<Agent[]> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM bold_cedar_007.agents
       WHERE $1::boolean OR disabled_at IS NULL
       ORDER BY lower(name)
       LIMIT $2 OFFSET $3`,
      [input.includeDisabled, input.limit, input.offset]
    );

    return result.rows.map(toAgent);
  }

  async count(input: { includeDisabled: boolean }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.agents
       WHERE $1::boolean OR disabled_at IS NULL`,
      [input.includeDisabled]
    );

    return result.rows[0].total;
  }

  async update(
    agentId: string,
    changes: { name?: string; purpose?: string }
  ): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `UPDATE bold_cedar_007.agents
       SET name = coalesce($2, name), purpose = coalesce($3, purpose), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [agentId, changes.name ?? null, changes.purpose ?? null]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async setDisabled(agentId: string, disabled: boolean): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `UPDATE bold_cedar_007.agents
       SET disabled_at = CASE WHEN $2 THEN coalesce(disabled_at, now()) ELSE NULL END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [agentId, disabled]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  // Two saves at once can pick the same version number. The unique (agent_id, version) index
  // rejects the second, which then tries the next number.
  async addVersion(agentId: string, input: CreateAgentVersionInput): Promise<AgentVersion> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.db.query<AgentVersionRow>(
          `WITH next AS (
             SELECT coalesce(max(version), 0) + 1 AS version
             FROM bold_cedar_007.agent_versions
             WHERE agent_id = $2
           ), saved AS (
             INSERT INTO bold_cedar_007.agent_versions (
               id, agent_id, version, instructions, provider, model, skill_ids, connection_ids,
               created_by_human_id
             )
             SELECT $1, $2, next.version, $3, $4, $5, $6, $7, $8
             FROM next
             RETURNING *
           ), current AS (
             UPDATE bold_cedar_007.agents
             SET current_version_id = (SELECT id FROM saved), updated_at = now()
             WHERE id = $2
           )
           SELECT * FROM saved`,
          [
            randomUUID(),
            agentId,
            input.instructions,
            input.provider,
            input.model,
            input.skillIds,
            input.connectionIds,
            input.createdByHumanId
          ]
        );
        return toAgentVersion(result.rows[0]);
      } catch (error) {
        if (attempt >= 3 || (error as { code?: string }).code !== UNIQUE_VIOLATION) {
          throw error;
        }
      }
    }
  }

  async listVersions(agentId: string): Promise<AgentVersion[]> {
    const result = await this.db.query<AgentVersionRow>(
      `SELECT *
       FROM bold_cedar_007.agent_versions
       WHERE agent_id = $1
       ORDER BY version DESC`,
      [agentId]
    );

    return result.rows.map(toAgentVersion);
  }

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
