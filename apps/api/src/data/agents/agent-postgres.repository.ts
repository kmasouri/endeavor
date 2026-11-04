import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  AgentProfileFields,
  AgentProfile,
  AgentAppearance,
  Agent,
  AgentLimits,
  AgentVersion,
  ModelProvider
} from '../../shared/types';
import {
  AgentNameConflictError,
  AgentConfigConflictError,
  AgentAccessChanges,
  AgentRepository,
  AgentDeletionImpact,
  CreateAgentInput,
  CreateAgentVersionInput
} from './agent.repository';

interface AgentRow {
  id: string;
  name: string;
  purpose: string;
  produces: string | null;
  needs: string | null;
  avatar_color: Agent['avatarColor'];
  avatar_icon: Agent['avatarIcon'];
  current_version_id: string | null;
  disabled_at: Date | null;
  deleted_at: Date | null;
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

  async getDeletionImpact(agentId: string): Promise<AgentDeletionImpact> {
    const [tasks, schedules] = await Promise.all([
      this.db.query<{ id: string; title: string; state: string }>(
        `SELECT id, title, state FROM endeavor.tasks
         WHERE owner_agent_id = $1 AND state IN ('working', 'waiting', 'blocked')
         ORDER BY created_at, id`,
        [agentId]
      ),
      this.db.query<{ id: string; title: string; status: string }>(
        `SELECT id, title, status FROM endeavor.responsibilities
         WHERE agent_id = $1 AND status <> 'cancelled' ORDER BY created_at, id`,
        [agentId]
      )
    ]);
    return { tasks: tasks.rows, schedules: schedules.rows };
  }

  async acquireExecution(agentId: string): Promise<(() => Promise<void>) | null> {
    const client = await this.db.connect();
    try {
      const lock = await client.query<{ held: boolean }>(
        `SELECT pg_try_advisory_lock_shared(hashtextextended($1, 63)) AS held`,
        [agentId]
      );
      const held = lock.rows[0].held;
      const agent = held
        ? await client.query(
            `SELECT id FROM endeavor.agents WHERE id = $1 AND deleted_at IS NULL`,
            [agentId]
          )
        : null;
      if (!agent?.rows.length) {
        if (held)
          await client.query(`SELECT pg_advisory_unlock_shared(hashtextextended($1, 63))`, [
            agentId
          ]);
        client.release();
        return null;
      }
      return async () => {
        try {
          await client.query(`SELECT pg_advisory_unlock_shared(hashtextextended($1, 63))`, [
            agentId
          ]);
          client.release();
        } catch (error) {
          client.release(true);
          throw error;
        }
      };
    } catch (error) {
      // Destroy the connection so a failed query cannot leave a session lock behind.
      client.release(true);
      throw error;
    }
  }

  async delete(agentId: string, actorId: string): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Wait for already-started model and tool calls before deletion takes effect.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 63))`, [agentId]);
      const deleted = await client.query(
        `UPDATE endeavor.agents SET deleted_at = now(), disabled_at = coalesce(disabled_at, now()),
           name = 'Deleted agent ' || id::text, purpose = '', produces = NULL, needs = NULL, current_version_id = NULL,
           monthly_budget_usd = NULL, avatar_color = NULL, avatar_icon = NULL, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [agentId]
      );
      if (!deleted.rows.length) {
        await client.query('COMMIT');
        return false;
      }
      const tasks = await client.query<{ id: string; previous_state: string }>(
        `UPDATE endeavor.tasks t SET state = 'cancelled', state_reason = 'Agent permanently deleted',
           paused_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
           finished_at = now(), updated_at = now()
         FROM (SELECT id, state FROM endeavor.tasks
           WHERE owner_agent_id = $1 AND state IN ('working', 'waiting', 'blocked') FOR UPDATE) original
         WHERE t.id = original.id RETURNING t.id, original.state AS previous_state`,
        [agentId]
      );
      const ids = tasks.rows.map((task) => task.id);
      await client.query(
        `INSERT INTO endeavor.task_events (task_id, type, actor_type, actor_id, data)
         SELECT cancelled.id, 'task.state.changed', 'human', $2::uuid,
           jsonb_build_object('from', cancelled.state, 'to', 'cancelled',
             'reason', 'Agent permanently deleted')
         FROM unnest($1::uuid[], $3::text[]) AS cancelled(id, state)`,
        [ids, actorId, tasks.rows.map((task) => task.previous_state)]
      );
      await client.query(
        `UPDATE endeavor.task_waits SET resolved_at = now(), resolution = '{"cancelled":true}'::jsonb
         WHERE task_id = ANY($1::uuid[]) AND resolved_at IS NULL`,
        [ids]
      );
      await client.query(
        `UPDATE endeavor.responsibilities SET status = 'cancelled', catch_up_slot = NULL,
           catch_up_missed = NULL, updated_at = now() WHERE agent_id = $1`,
        [agentId]
      );
      await client.query(
        `UPDATE endeavor.agent_grants SET revoked_at = coalesce(revoked_at, now()),
           revoked_by_human_id = coalesce(revoked_by_human_id, $2)
         WHERE agent_id = $1`,
        [agentId, actorId]
      );
      await client.query(
        `UPDATE endeavor.approvals SET status = 'rejected', decided_by_human_id = $2,
           decided_at = now(), reason = 'Agent permanently deleted'
         WHERE agent_id = $1 AND status = 'pending'`,
        [agentId, actorId]
      );
      await client.query(
        `UPDATE endeavor.approvals SET executed_at = now(),
           result = '{"status":null,"body":"","truncated":false,"error":"Agent permanently deleted"}'::jsonb
         WHERE agent_id = $1 AND status = 'approved' AND executed_at IS NULL`,
        [agentId]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

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
           INSERT INTO endeavor.agents (id, name, purpose, current_version_id, produces, needs)
           VALUES ($1, $2, $3, $4, $13, $14)
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
         ${buildAccessCtes('$1', '$12', 'version')}
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
          JSON.stringify(access ?? { grant: [], revoke: [] }),
          input.produces?.trim() || null,
          input.needs?.trim() || null
        ]
      )
      .catch((error) => rethrowNameConflict(error, input.name));

    const row = result.rows[0];
    return {
      agent: toAgent(parseJsonDates(row.agent)),
      version: toAgentVersion(parseJsonDates(row.version))
    };
  }

  async getProfiles(agentIds: string[], conversationId: string | null): Promise<AgentProfile[]> {
    if (agentIds.length === 0) return [];
    const result = await this.db.query<AgentProfile>(
      `SELECT a.id, a.name, a.purpose, a.produces, a.needs,
         ARRAY(SELECT DISTINCT s.name FROM endeavor.agent_versions av
           JOIN endeavor.skill_versions sv ON sv.id = ANY(av.skill_version_ids)
           JOIN endeavor.skills s ON s.id = sv.skill_id
           WHERE av.id = a.current_version_id ORDER BY s.name) AS "skillNames",
         CASE WHEN $2::uuid IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM endeavor.tasks t
             WHERE t.owner_agent_id = a.id AND t.conversation_id = $2
               AND t.state IN ('working', 'waiting', 'blocked')) THEN 'busy'
           ELSE 'idle' END AS status
       FROM endeavor.agents a WHERE a.id = ANY($1::uuid[]) AND a.deleted_at IS NULL`,
      [agentIds, conversationId]
    );
    return result.rows;
  }

  async getByName(name: string): Promise<Agent | null> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM endeavor.agents
       WHERE lower(name) = lower($1) AND deleted_at IS NULL`,
      [name]
    );

    return result.rows[0] ? toAgent(result.rows[0]) : null;
  }

  async list(input: { limit: number; offset: number; includeDisabled: boolean }): Promise<Agent[]> {
    const result = await this.db.query<AgentRow>(
      `SELECT *
       FROM endeavor.agents
       WHERE deleted_at IS NULL AND ($1::boolean OR disabled_at IS NULL)
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
       WHERE deleted_at IS NULL AND disabled_at IS NULL
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
       WHERE deleted_at IS NULL AND disabled_at IS NULL
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
       WHERE deleted_at IS NULL AND ($1::boolean OR disabled_at IS NULL)`,
      [input.includeDisabled]
    );

    return result.rows[0].total;
  }

  async update(
    agentId: string,
    changes: AgentAppearance &
      AgentProfileFields & { name?: string; purpose?: string; monthlyBudgetUsd?: number | null }
  ): Promise<Agent | null> {
    // $4 says whether the budget is being changed, since null (no cap) is a real value.
    const result = await this.db
      .query<AgentRow>(
        `UPDATE endeavor.agents
       SET name = coalesce($2, name),
           purpose = coalesce($3, purpose),
           monthly_budget_usd = CASE WHEN $4 THEN $5 ELSE monthly_budget_usd END,
           avatar_color = CASE WHEN $6 THEN $7 ELSE avatar_color END,
           avatar_icon = CASE WHEN $8 THEN $9 ELSE avatar_icon END,
           produces = CASE WHEN $10 THEN $11 ELSE produces END,
           needs = CASE WHEN $12 THEN $13 ELSE needs END,
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
        [
          agentId,
          changes.name ?? null,
          changes.purpose ?? null,
          changes.monthlyBudgetUsd !== undefined,
          changes.monthlyBudgetUsd ?? null,
          changes.avatarColor !== undefined,
          changes.avatarColor ?? null,
          changes.avatarIcon !== undefined,
          changes.avatarIcon ?? null,
          changes.produces !== undefined,
          changes.produces?.trim() || null,
          changes.needs !== undefined,
          changes.needs?.trim() || null
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
       WHERE id = $1 AND deleted_at IS NULL
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
             WHERE id = $2 AND deleted_at IS NULL AND (NOT ($10::jsonb ? 'expectedVersionId')
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
           ${buildAccessCtes('$2', '$10', 'saved')}
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
function parseJsonDates<Row extends { created_at: Date }>(row: Row): Row {
  const dated = { ...row } as Record<string, unknown>;
  for (const key of ['created_at', 'updated_at', 'disabled_at', 'deleted_at']) {
    if (typeof dated[key] === 'string') {
      dated[key] = new Date(dated[key] as string);
    }
  }
  return dated as Row;
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.deleted_at ? 'Deleted agent' : row.name,
    deletedAt: row.deleted_at,
    purpose: row.purpose,
    produces: row.produces ?? null,
    needs: row.needs ?? null,
    avatarColor: row.avatar_color ?? null,
    avatarIcon: row.avatar_icon ?? null,
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
function buildAccessCtes(agent: string, parameter: string, saved: string): string {
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
