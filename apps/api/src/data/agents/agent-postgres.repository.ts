import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Agent, AgentLimits, AgentVersion, ModelProvider } from '../../shared/types';
import {
  AgentNameConflictError,
  AgentConfigConflictError,
  AgentAccessChanges,
  AgentRepository,
  CreateAgentInput,
  CreateAgentVersionInput
} from './agent.repository';

interface AgentRow {
  id: string;
  name: string;
  purpose: string;
  current_version_id: string | null;
  disabled_at: Date | null;
  // numeric comes back from Postgres as a string.
  monthly_budget_usd: string | null;
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
  skill_version_ids: string[];
  skill_ids?: string[];
  connection_ids: string[];
  legacy_connection_ids?: string[];
  limits: AgentLimits;
  created_by_human_id: string | null;
  created_at: Date;
}

// Retired skill metadata is read only to warn people about legacy configurations.
// It is never copied into connection_ids or used to authorize a tool call.
const VERSION_COLUMNS = `av.*, ARRAY(
  SELECT sv.skill_id FROM endeavor.skill_versions sv
  WHERE sv.id = ANY(av.skill_version_ids)
  ORDER BY array_position(av.skill_version_ids, sv.id)
) AS skill_ids, ARRAY(
  SELECT DISTINCT connection_id
  FROM endeavor.skill_versions sv,
       unnest(sv.connection_ids) AS connection_id
  WHERE sv.id = ANY(av.skill_version_ids)
    AND NOT (connection_id = ANY(av.connection_ids))
  ORDER BY connection_id
) AS legacy_connection_ids`;

const UNIQUE_VIOLATION = '23505';

export class AgentPostgresRepository implements AgentRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(
    input: CreateAgentInput,
    firstVersion: CreateAgentVersionInput,
    access?: AgentAccessChanges
  ): Promise<{ agent: Agent; version: AgentVersion }> {
    const agentId = randomUUID();
    const versionId = randomUUID();
    const result = await this.db
      .query<{ agent: AgentRow; version: AgentVersionRow }>(
        `WITH agent AS (
           INSERT INTO endeavor.agents (id, name, purpose, current_version_id)
           VALUES ($1, $2, $3, $4)
           RETURNING *
         ), version AS (
           INSERT INTO endeavor.agent_versions (
             id, agent_id, version, instructions, provider, model, skill_version_ids, connection_ids,
             created_by_human_id, limits
           )
           SELECT $4, agent.id, 1, $5, $6, $7, $8, $9, $10, $11
           FROM agent
           RETURNING *
         )
         ${accessCtes('$1', '$12', 'version')}
         SELECT row_to_json(agent.*) AS agent, row_to_json(v.*) AS version
         FROM agent, LATERAL (SELECT ${VERSION_COLUMNS} FROM version av) v`,
        [
          agentId,
          input.name,
          input.purpose,
          versionId,
          firstVersion.instructions,
          firstVersion.provider,
          firstVersion.model,
          firstVersion.skillVersionIds,
          firstVersion.connectionIds,
          firstVersion.createdByHumanId,
          firstVersion.limits,
          JSON.stringify(access ?? { grant: [], revoke: [] })
        ]
      )
      .catch((error) => rethrowNameConflict(error, input.name));

    const row = result.rows[0];
    return { agent: toAgent(fromJson(row.agent)), version: toAgentVersion(fromJson(row.version)) };
  }

  async getByName(name: string): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM endeavor.agents
       WHERE lower(name) = lower($1)`,
      [name]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async list(input: { limit: number; offset: number; includeDisabled: boolean }): Promise<Agent[]> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM endeavor.agents
       WHERE $1::boolean OR disabled_at IS NULL
       ORDER BY lower(name)
       LIMIT $2 OFFSET $3`,
      [input.includeDisabled, input.limit, input.offset]
    );

    return result.rows.map(toAgent);
  }

  async listDirectory(input: {
    excludeIds: string[];
    limit: number;
    offset: number;
  }): Promise<Agent[]> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM endeavor.agents
       WHERE disabled_at IS NULL
         AND current_version_id IS NOT NULL
         AND NOT (id = ANY($1::uuid[]))
       ORDER BY lower(name)
       LIMIT $2 OFFSET $3`,
      [input.excludeIds, input.limit, input.offset]
    );

    return result.rows.map(toAgent);
  }

  async countDirectory(input: { excludeIds: string[] }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.agents
       WHERE disabled_at IS NULL
         AND current_version_id IS NOT NULL
         AND NOT (id = ANY($1::uuid[]))`,
      [input.excludeIds]
    );

    return result.rows[0].total;
  }

  async count(input: { includeDisabled: boolean }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.agents
       WHERE $1::boolean OR disabled_at IS NULL`,
      [input.includeDisabled]
    );

    return result.rows[0].total;
  }

  async update(
    agentId: string,
    changes: { name?: string; purpose?: string; monthlyBudgetUsd?: number | null }
  ): Promise<Agent | null> {
    // $4 says whether the budget is being changed, since null (no cap) is a real value.
    const result = await this.db
      .query<AgentRow>(
        `UPDATE endeavor.agents
       SET name = coalesce($2, name),
           purpose = coalesce($3, purpose),
           monthly_budget_usd = CASE WHEN $4 THEN $5 ELSE monthly_budget_usd END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
        [
          agentId,
          changes.name ?? null,
          changes.purpose ?? null,
          changes.monthlyBudgetUsd !== undefined,
          changes.monthlyBudgetUsd ?? null
        ]
      )
      .catch((error) => rethrowNameConflict(error, changes.name ?? ''));

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async setDisabled(agentId: string, disabled: boolean): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `UPDATE endeavor.agents
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
  async addVersion(
    agentId: string,
    input: CreateAgentVersionInput,
    access?: AgentAccessChanges
  ): Promise<AgentVersion> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.db.query<AgentVersionRow>(
          `WITH locked AS (
             SELECT id FROM endeavor.agents
             WHERE id = $2 AND (NOT ($10::jsonb ? 'expectedVersionId')
               OR current_version_id = ($10::jsonb->>'expectedVersionId')::uuid)
             FOR UPDATE
           ), next AS (
             SELECT coalesce(max(version), 0) + 1 AS version
             FROM endeavor.agent_versions
             WHERE agent_id = $2
           ), saved AS (
             INSERT INTO endeavor.agent_versions (
               id, agent_id, version, instructions, provider, model, skill_version_ids, connection_ids,
               created_by_human_id, limits
             )
             SELECT $1, $2, next.version, $3, $4, $5, $6, $7, $8, $9
             FROM next WHERE EXISTS (SELECT 1 FROM locked)
             RETURNING *
           ), current AS (
             UPDATE endeavor.agents
             SET current_version_id = (SELECT id FROM saved), updated_at = now()
             WHERE id = $2 AND EXISTS (SELECT 1 FROM saved)
           )
           ${accessCtes('$2', '$10', 'saved')}
           SELECT ${VERSION_COLUMNS} FROM saved av`,
          [
            randomUUID(),
            agentId,
            input.instructions,
            input.provider,
            input.model,
            input.skillVersionIds,
            input.connectionIds,
            input.createdByHumanId,
            input.limits,
            JSON.stringify(access ?? { grant: [], revoke: [] })
          ]
        );
        if (!result.rows[0]) throw new AgentConfigConflictError();
        return toAgentVersion(result.rows[0]);
      } catch (error) {
        if (attempt >= 3 || (error as { code?: string }).code !== UNIQUE_VIOLATION) {
          throw error;
        }
      }
    }
  }

  async getVersions(versionIds: string[]): Promise<AgentVersion[]> {
    if (versionIds.length === 0) {
      return [];
    }
    const result = await this.db.query<AgentVersionRow>(
      `SELECT ${VERSION_COLUMNS}
       FROM endeavor.agent_versions av
       WHERE av.id = ANY($1::uuid[])`,
      [versionIds]
    );

    return result.rows.map(toAgentVersion);
  }

  async listVersions(agentId: string): Promise<AgentVersion[]> {
    const result = await this.db.query<AgentVersionRow>(
      `SELECT ${VERSION_COLUMNS}
       FROM endeavor.agent_versions av
       WHERE av.agent_id = $1
       ORDER BY av.version DESC`,
      [agentId]
    );

    return result.rows.map(toAgentVersion);
  }

  async getById(agentId: string): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM endeavor.agents
       WHERE id = $1`,
      [agentId]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async getVersion(versionId: string): Promise<AgentVersion | null> {
    const result = await this.db.query<AgentVersionRow>(
      `SELECT ${VERSION_COLUMNS}
       FROM endeavor.agent_versions av
       WHERE av.id = $1`,
      [versionId]
    );

    return result.rows[0] ? toAgentVersion(result.rows[0]) : null;
  }
}

function rethrowNameConflict(error: unknown, name: string): never {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === UNIQUE_VIOLATION && constraint === 'idx_agents_name_unique') {
    throw new AgentNameConflictError(name);
  }
  throw error;
}

// row_to_json gives timestamps as strings. Turn them back into dates.
function fromJson<Row extends { created_at: Date }>(row: Row): Row {
  const dated = { ...row } as Record<string, unknown>;
  for (const key of ['created_at', 'updated_at', 'disabled_at']) {
    if (typeof dated[key] === 'string') {
      dated[key] = new Date(dated[key] as string);
    }
  }
  return dated as Row;
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    currentVersionId: row.current_version_id,
    disabledAt: row.disabled_at,
    monthlyBudgetUsd: row.monthly_budget_usd === null ? null : Number(row.monthly_budget_usd),
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
    skillVersionIds: row.skill_version_ids,
    skillIds: row.skill_ids ?? [],
    connectionIds: row.connection_ids,
    legacyConnectionIds: row.legacy_connection_ids ?? [],
    limits: row.limits ?? {},
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at
  };
}

// The service supplies the access changes. Save them in the same statement as the version,
// so a failed save cannot leave an item removed from configuration but still usable.
function accessCtes(agent: string, parameter: string, saved: string): string {
  return `, granted AS (
    INSERT INTO endeavor.agent_grants (agent_id, target_type, target_id, granted_by_human_id)
    SELECT ${agent}::uuid, entry->>'type', (entry->>'id')::uuid,
           (${parameter}::jsonb->>'actorId')::uuid
    FROM jsonb_array_elements(${parameter}::jsonb->'grant') entry
    WHERE EXISTS (SELECT 1 FROM ${saved})
    ON CONFLICT (agent_id, target_type, target_id) DO UPDATE
    SET revoked_at = NULL, revoked_by_human_id = NULL,
        granted_at = now(), granted_by_human_id = EXCLUDED.granted_by_human_id
  ), revoked AS (
    UPDATE endeavor.agent_grants g
    SET revoked_at = now(), revoked_by_human_id = (${parameter}::jsonb->>'actorId')::uuid
    FROM jsonb_array_elements(${parameter}::jsonb->'revoke') entry
    WHERE g.agent_id = ${agent}::uuid AND g.target_type = entry->>'type'
      AND g.target_id = (entry->>'id')::uuid AND g.revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM ${saved})
  )`;
}
