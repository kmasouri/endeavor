import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  Actor,
  ActorType,
  CriteriaCheck,
  Task,
  TaskEvent,
  TaskOutput,
  TaskOutputKind,
  TaskRequesterType,
  TaskReview,
  TaskState,
  TaskWait,
  TaskWaitKind
} from '../../shared/types';
import {
  CostFilter,
  CostSummary,
  TaskCost,
  CreateTaskInput,
  CreateTaskOutputInput,
  CreateTaskWaitInput,
  ListTasksInput,
  TaskChanges,
  StoredHttpCall,
  TaskRepository
} from './task.repository';

interface TaskRow {
  id: string;
  run_key: string;
  conversation_id: string | null;
  owner_agent_id: string;
  agent_version_id: string;
  title: string;
  brief: string;
  completion_criteria: string;
  review_required: boolean;
  state: TaskState;
  state_reason: string | null;
  paused_at: Date | null;
  requested_by_type: TaskRequesterType;
  requested_by_id: string | null;
  request_message_id: string | null;
  parent_task_id: string | null;
  restarted_from_task_id: string | null;
  responsibility_id: string | null;
  criteria_check: (Omit<CriteriaCheck, 'checkedAt'> & { checkedAt: string }) | null;
  review: (Omit<TaskReview, 'reviewedAt'> & { reviewedAt: string }) | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

interface TaskWaitRow {
  id: string;
  task_id: string;
  kind: TaskWaitKind;
  target_id: string | null;
  description: string;
  created_at: Date;
  resolved_at: Date | null;
  resolution: Record<string, unknown> | null;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  type: string;
  actor_type: ActorType;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: Date;
}

interface TaskOutputRow {
  id: string;
  task_id: string;
  kind: TaskOutputKind;
  title: string;
  content: string | null;
  uri: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// Maps TaskChanges fields to their columns. Only these columns can be changed by update().
const CHANGE_COLUMNS: Record<keyof TaskChanges, string> = {
  state: 'state',
  stateReason: 'state_reason',
  pausedAt: 'paused_at',
  criteriaCheck: 'criteria_check',
  review: 'review',
  finishedAt: 'finished_at',
  agentVersionId: 'agent_version_id'
};

export class TaskPostgresRepository implements TaskRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async getHttpCall(taskId: string, callId: string): Promise<StoredHttpCall | null> {
    const result = await this.db.query<{
      request_hash: string;
      response: StoredHttpCall['response'];
    }>(
      `SELECT request_hash, response FROM endeavor.http_calls WHERE task_id = $1 AND call_id = $2`,
      [taskId, callId]
    );
    const row = result.rows[0];
    return row ? { requestHash: row.request_hash, response: row.response } : null;
  }

  async claimHttpCall(taskId: string, callId: string, requestHash: string): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO endeavor.http_calls (task_id, call_id, request_hash)
       VALUES ($1, $2, $3) ON CONFLICT (task_id, call_id) DO NOTHING`,
      [taskId, callId, requestHash]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async saveHttpCallResponse(
    taskId: string,
    callId: string,
    requestHash: string,
    response: NonNullable<StoredHttpCall['response']>
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE endeavor.http_calls SET response = $4, finished_at = now()
       WHERE task_id = $1 AND call_id = $2 AND request_hash = $3 AND response IS NULL`,
      [taskId, callId, requestHash, response]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async create(input: CreateTaskInput): Promise<{ task: Task; created: boolean }> {
    return this.insertTask(input, this.db);
  }

  async createScheduled(
    input: CreateTaskInput,
    expectedNextRunAt: Date
  ): Promise<{ task: Task; created: boolean } | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Agent deletion locks the agent before its schedules and tasks. Keep that order.
      await client.query('SELECT id FROM endeavor.agents WHERE id = $1 FOR SHARE', [
        input.ownerAgentId
      ]);
      const schedule = await client.query(
        `SELECT id FROM endeavor.responsibilities
         WHERE id = $1 AND agent_id = $2 AND status = 'enabled' AND next_run_at = $3
         FOR SHARE`,
        [input.responsibilityId, input.ownerAgentId, expectedNextRunAt]
      );
      if (!schedule.rows.length) {
        await client.query('COMMIT');
        return null;
      }
      const result = await this.insertTask(input, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveCatchUp(input: {
    responsibilityId: string;
    agentId: string;
    slot: Date;
    task: CreateTaskInput | null;
  }): Promise<{ task: Task | null; created: boolean } | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Match permanent deletion's agent-before-schedule lock order.
      const agent = await client.query<{
        disabled_at: Date | null;
        deleted_at: Date | null;
        current_version_id: string | null;
      }>(
        'SELECT disabled_at, deleted_at, current_version_id FROM endeavor.agents WHERE id = $1 FOR SHARE',
        [input.agentId]
      );
      if (
        input.task &&
        (!agent.rows[0] ||
          agent.rows[0].disabled_at ||
          agent.rows[0].deleted_at ||
          agent.rows[0].current_version_id !== input.task.agentVersionId)
      ) {
        await client.query('COMMIT');
        return { task: null, created: false };
      }
      // Non-key updates serialize answers without blocking a competing task's foreign key.
      await client.query(
        'SELECT id FROM endeavor.responsibilities WHERE id = $1 AND agent_id = $2 FOR NO KEY UPDATE',
        [input.responsibilityId, input.agentId]
      );
      // Check after taking the lock: a wait may have crossed the question's expiry. now()
      // would still be the transaction's start time, so use the live database clock.
      const pending = await client.query(
        `SELECT id FROM endeavor.responsibilities WHERE id = $1 AND agent_id = $2
         AND status = 'enabled' AND catch_up_slot = $3 AND next_run_at > clock_timestamp()`,
        [input.responsibilityId, input.agentId, input.slot]
      );
      if (!pending.rows.length) {
        await client.query('COMMIT');
        return null;
      }
      const result = input.task
        ? await this.insertTask(input.task, client)
        : { task: null, created: false };
      if (input.task && result.task?.runKey !== input.task.runKey) {
        await client.query('COMMIT');
        return result;
      }
      const saved = await client.query(
        `INSERT INTO endeavor.catch_up_decisions (responsibility_id, slot, next_run_at, decision, task_id)
         SELECT id, catch_up_slot, next_run_at, $2, $3 FROM endeavor.responsibilities
         WHERE id = $1 AND next_run_at > clock_timestamp()
         ON CONFLICT DO NOTHING RETURNING responsibility_id`,
        [input.responsibilityId, input.task ? 'run' : 'wait', result.task?.id ?? null]
      );
      if (!saved.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `UPDATE endeavor.responsibilities SET catch_up_slot = NULL,
        catch_up_missed = NULL, updated_at = now() WHERE id = $1`,
        [input.responsibilityId]
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertTask(
    input: CreateTaskInput,
    db: Pick<FastifyInstance['pg'], 'query'>
  ): Promise<{ task: Task; created: boolean }> {
    const result = await db.query<TaskRow>(
      `INSERT INTO endeavor.tasks (
         id, run_key, conversation_id, owner_agent_id, agent_version_id, title, brief,
         completion_criteria, review_required, state, requested_by_type, requested_by_id,
         request_message_id, parent_task_id, restarted_from_task_id, responsibility_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'working', $10, $11, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        input.runKey,
        input.conversationId,
        input.ownerAgentId,
        input.agentVersionId,
        input.title,
        input.brief,
        input.completionCriteria,
        input.reviewRequired,
        input.requestedByType,
        input.requestedById,
        input.requestMessageId,
        input.parentTaskId,
        input.restartedFromTaskId,
        input.responsibilityId
      ]
    );

    if (result.rows[0]) {
      return { task: toTask(result.rows[0]), created: true };
    }

    // Use the same connection: a scheduled insert keeps its schedule lock through conflict
    // recovery too. Run-key matches take precedence over a competing open run.
    const byKey = await db.query<TaskRow>('SELECT * FROM endeavor.tasks WHERE run_key = $1', [
      input.runKey
    ]);
    const byEndeavor =
      !byKey.rows[0] && input.conversationId
        ? await db.query<TaskRow>(
            `SELECT * FROM endeavor.tasks WHERE conversation_id = $1 AND owner_agent_id = $2
             AND state IN ('working', 'waiting', 'blocked') LIMIT 1`,
            [input.conversationId, input.ownerAgentId]
          )
        : null;
    const existing =
      byKey.rows[0] ??
      byEndeavor?.rows[0] ??
      (input.responsibilityId
        ? (
            await db.query<TaskRow>(
              `SELECT * FROM endeavor.tasks WHERE responsibility_id = $1
           AND state IN ('working', 'waiting', 'blocked') LIMIT 1`,
              [input.responsibilityId]
            )
          ).rows[0]
        : undefined);
    if (!existing) {
      throw new Error(`Task with run key ${input.runKey} conflicted but was not found`);
    }
    return { task: toTask(existing), created: false };
  }

  async getById(taskId: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM endeavor.tasks
       WHERE id = $1`,
      [taskId]
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async getByRunKey(runKey: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM endeavor.tasks
       WHERE run_key = $1`,
      [runKey]
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async list(input: ListTasksInput): Promise<Task[]> {
    const { where, values } = listFilters(input);
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM endeavor.tasks
       ${where}
       ORDER BY created_at DESC, id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.offset]
    );

    return result.rows.map(toTask);
  }

  async count(input: Omit<ListTasksInput, 'limit' | 'offset'>): Promise<number> {
    const { where, values } = listFilters(input);
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.tasks
       ${where}`,
      values
    );

    return result.rows[0].total;
  }

  async update(
    taskId: string,
    expected: { state: TaskState; paused: boolean; agentVersionId?: string },
    changes: TaskChanges
  ): Promise<Task | null> {
    const values: unknown[] = [
      taskId,
      expected.state,
      expected.paused,
      expected.agentVersionId ?? null
    ];
    const sets = ['updated_at = now()'];
    for (const [field, column] of Object.entries(CHANGE_COLUMNS)) {
      const value = changes[field as keyof TaskChanges];
      if (value !== undefined) {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      }
    }

    // A task that leaves 'working', or is paused, gives up its lease, so no worker keeps
    // running it.
    if ((changes.state && changes.state !== 'working') || changes.pausedAt) {
      sets.push('lease_owner = NULL', 'lease_expires_at = NULL');
    }

    const result = await this.db.query<TaskRow>(
      `UPDATE endeavor.tasks
       SET ${sets.join(', ')}
       WHERE id = $1
         AND state = $2
         AND (paused_at IS NOT NULL) = $3
         AND ($4::uuid IS NULL OR agent_version_id = $4)
       RETURNING *`,
      values
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async addWaits(taskId: string, waits: CreateTaskWaitInput[]): Promise<TaskWait[]> {
    const created: TaskWait[] = [];
    for (const wait of waits) {
      const result = await this.db.query<TaskWaitRow>(
        `INSERT INTO endeavor.task_waits (id, task_id, kind, target_id, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [randomUUID(), taskId, wait.kind, wait.targetId, wait.description]
      );
      created.push(toTaskWait(result.rows[0]));
    }
    return created;
  }

  async listWaits(taskId: string, options: { openOnly: boolean }): Promise<TaskWait[]> {
    const result = await this.db.query<TaskWaitRow>(
      `SELECT *
       FROM endeavor.task_waits
       WHERE task_id = $1
         AND ($2::boolean = false OR resolved_at IS NULL)
       ORDER BY created_at, id`,
      [taskId, options.openOnly]
    );

    return result.rows.map(toTaskWait);
  }

  async findOpenWaits(kind: TaskWaitKind, targetId: string): Promise<TaskWait[]> {
    const result = await this.db.query<TaskWaitRow>(
      `SELECT *
       FROM endeavor.task_waits
       WHERE kind = $1
         AND target_id = $2
         AND resolved_at IS NULL
       ORDER BY created_at, id`,
      [kind, targetId]
    );

    return result.rows.map(toTaskWait);
  }

  async resolveWait(waitId: string, resolution: Record<string, unknown>): Promise<TaskWait | null> {
    const result = await this.db.query<TaskWaitRow>(
      `UPDATE endeavor.task_waits
       SET resolved_at = now(), resolution = $2
       WHERE id = $1
         AND resolved_at IS NULL
       RETURNING *`,
      [waitId, resolution]
    );

    return result.rows[0] ? toTaskWait(result.rows[0]) : null;
  }

  async resolveOpenWaits(taskId: string, resolution: Record<string, unknown>): Promise<number> {
    const result = await this.db.query(
      `UPDATE endeavor.task_waits
       SET resolved_at = now(), resolution = $2
       WHERE task_id = $1
         AND resolved_at IS NULL`,
      [taskId, resolution]
    );

    return result.rowCount ?? 0;
  }

  async addEvent(
    taskId: string,
    type: string,
    actor: Actor,
    data: Record<string, unknown>
  ): Promise<TaskEvent> {
    const result = await this.db.query<TaskEventRow>(
      `INSERT INTO endeavor.task_events (task_id, type, actor_type, actor_id, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [taskId, type, actor.type, actor.id, data]
    );

    return toTaskEvent(result.rows[0]);
  }

  async recordToolResults(
    taskId: string,
    workerId: string,
    data: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO endeavor.task_events (task_id, type, actor_type, actor_id, data)
       SELECT id, 'tool.results', 'system', NULL, $3::jsonb
       FROM (
         SELECT id FROM endeavor.tasks
         WHERE id = $1
           AND (
             (lease_owner = $2 AND lease_expires_at > now())
             OR (lease_owner IS NULL AND (state <> 'working' OR paused_at IS NOT NULL))
           )
         FOR UPDATE
       ) controlled_task`,
      [taskId, workerId, data]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listEvents(
    taskId: string,
    options: { afterId: number; limit: number }
  ): Promise<TaskEvent[]> {
    const result = await this.db.query<TaskEventRow>(
      `SELECT *
       FROM endeavor.task_events
       WHERE task_id = $1
         AND id > $2
       ORDER BY id
       LIMIT $3`,
      [taskId, options.afterId, options.limit]
    );

    return result.rows.map(toTaskEvent);
  }

  async listLatestEvents(taskIds: string[], types: string[]): Promise<TaskEvent[]> {
    if (taskIds.length === 0) return [];
    const result = await this.db.query<TaskEventRow>(
      `SELECT event.* FROM unnest($1::uuid[]) AS requested(task_id)
       CROSS JOIN LATERAL (
         SELECT * FROM endeavor.task_events
         WHERE task_id = requested.task_id AND type = ANY($2::text[])
         ORDER BY id DESC LIMIT 1
       ) AS event`,
      [taskIds, types]
    );
    return result.rows.map(toTaskEvent);
  }

  async addOutput(taskId: string, input: CreateTaskOutputInput): Promise<TaskOutput> {
    const result = await this.db.query<TaskOutputRow>(
      `INSERT INTO endeavor.task_outputs (id, task_id, kind, title, content, uri, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [randomUUID(), taskId, input.kind, input.title, input.content, input.uri, input.metadata]
    );

    return toTaskOutput(result.rows[0]);
  }

  async listOutputs(taskId: string): Promise<TaskOutput[]> {
    const result = await this.db.query<TaskOutputRow>(
      `SELECT *
       FROM endeavor.task_outputs
       WHERE task_id = $1
       ORDER BY created_at, id`,
      [taskId]
    );

    return result.rows.map(toTaskOutput);
  }

  async listConversationOutputs(
    conversationId: string,
    options: { limit: number; offset: number }
  ): Promise<TaskOutput[]> {
    const result = await this.db.query<TaskOutputRow>(
      `SELECT o.*
       FROM endeavor.task_outputs o
       JOIN endeavor.tasks t ON t.id = o.task_id
       WHERE t.conversation_id = $1
       ORDER BY o.created_at DESC, o.id
       LIMIT $2 OFFSET $3`,
      [conversationId, options.limit, options.offset]
    );

    return result.rows.map(toTaskOutput);
  }

  async countConversationOutputs(conversationId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.task_outputs o
       JOIN endeavor.tasks t ON t.id = o.task_id
       WHERE t.conversation_id = $1`,
      [conversationId]
    );

    return result.rows[0]?.total ?? 0;
  }

  async sumCost(filter: CostFilter): Promise<CostSummary> {
    const { where, values } = buildCostWhereClause(filter);
    const result = await this.db.query<{
      cost: string | null;
      tokens: string | null;
      unpriced: number;
    }>(
      `SELECT sum((e.data->>'costUsd')::numeric) AS cost,
              sum(coalesce((e.data->'usage'->>'inputTokens')::bigint, 0)
                + coalesce((e.data->'usage'->>'outputTokens')::bigint, 0)) AS tokens,
              count(*) FILTER (WHERE e.data->>'costUsd' IS NULL)::int AS unpriced
       FROM endeavor.task_events e
       JOIN endeavor.tasks t ON t.id = e.task_id
       WHERE ${where}`,
      values
    );
    const row = result.rows[0];
    return {
      costUsd: Number(row?.cost ?? 0),
      tokens: Number(row?.tokens ?? 0),
      unpricedCalls: row?.unpriced ?? 0
    };
  }

  async listTaskCosts(filter: CostFilter, limit: number): Promise<TaskCost[]> {
    const { where, values } = buildCostWhereClause(filter);
    const result = await this.db.query<{
      id: string;
      title: string;
      cost: string | null;
      tokens: string | null;
    }>(
      `SELECT t.id, t.title,
              sum((e.data->>'costUsd')::numeric) AS cost,
              sum(coalesce((e.data->'usage'->>'inputTokens')::bigint, 0)
                + coalesce((e.data->'usage'->>'outputTokens')::bigint, 0)) AS tokens
       FROM endeavor.task_events e
       JOIN endeavor.tasks t ON t.id = e.task_id
       WHERE ${where}
       GROUP BY t.id, t.title
       ORDER BY cost DESC NULLS LAST, tokens DESC
       LIMIT $${values.length + 1}`,
      [...values, limit]
    );
    return result.rows.map((row) => ({
      taskId: row.id,
      title: row.title,
      costUsd: Number(row.cost ?? 0),
      tokens: Number(row.tokens ?? 0)
    }));
  }

  async countOutputs(taskId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.task_outputs
       WHERE task_id = $1`,
      [taskId]
    );

    return result.rows[0].total;
  }

  async claimRunnable(workerId: string, leaseMs: number, limit: number): Promise<Task[]> {
    // SKIP LOCKED lets several workers claim at once without taking the same task.
    const result = await this.db.query<TaskRow>(
      `UPDATE endeavor.tasks
       SET lease_owner = $1,
           lease_expires_at = now() + ($2::text || ' milliseconds')::interval
       WHERE id IN (
         SELECT id
         FROM endeavor.tasks
         WHERE state = 'working'
           AND paused_at IS NULL
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
         ORDER BY updated_at, id
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [workerId, String(leaseMs), limit]
    );

    return result.rows.map(toTask);
  }

  async releaseLease(taskId: string, workerId: string, delayMs = 0): Promise<void> {
    await this.db.query(
      `UPDATE endeavor.tasks
       SET lease_owner = NULL,
           lease_expires_at = CASE
             WHEN $3::int > 0 THEN now() + $3::int * interval '1 millisecond'
             ELSE NULL
           END
       WHERE id = $1
         AND lease_owner = $2`,
      [taskId, workerId, Math.round(delayMs)]
    );
  }

  async renewLease(taskId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE endeavor.tasks
       SET lease_expires_at = now() + ($3::text || ' milliseconds')::interval
       WHERE id = $1
         AND lease_owner = $2`,
      [taskId, workerId, String(leaseMs)]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async findOpenRun(responsibilityId: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM endeavor.tasks
       WHERE responsibility_id = $1
         AND state IN ('working', 'waiting', 'blocked')
       ORDER BY created_at DESC
       LIMIT 1`,
      [responsibilityId]
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async findOpenTask(conversationId: string, agentId: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM endeavor.tasks
       WHERE conversation_id = $1
         AND owner_agent_id = $2
         AND state IN ('working', 'waiting', 'blocked')
       ORDER BY created_at DESC
       LIMIT 1`,
      [conversationId, agentId]
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async listWaitingWithoutOpenWaits(limit: number): Promise<Task[]> {
    const result = await this.db.query<TaskRow>(
      `SELECT t.*
       FROM endeavor.tasks t
       WHERE t.state = 'waiting'
         AND NOT EXISTS (
           SELECT 1
           FROM endeavor.task_waits w
           WHERE w.task_id = t.id
             AND w.resolved_at IS NULL
         )
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(toTask);
  }

  async listFinishedWithoutEvent(eventType: string, limit: number): Promise<Task[]> {
    const result = await this.db.query<TaskRow>(
      `SELECT t.*
       FROM endeavor.tasks t
       WHERE t.state = 'completed'
         AND t.request_message_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM endeavor.task_events e
           WHERE e.task_id = t.id
             AND e.type = $1
         )
       ORDER BY t.finished_at
       LIMIT $2`,
      [eventType, limit]
    );

    return result.rows.map(toTask);
  }

  async countEvents(taskId: string, type: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.task_events
       WHERE task_id = $1
         AND type = $2`,
      [taskId, type]
    );

    return result.rows[0].total;
  }
}

function listFilters(input: Omit<ListTasksInput, 'limit' | 'offset'>): {
  where: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const filters: [unknown, string][] = [
    [input.state, 'state'],
    [input.ownerAgentId, 'owner_agent_id'],
    [input.conversationId, 'conversation_id'],
    [input.responsibilityId, 'responsibility_id']
  ];
  for (const [value, column] of filters) {
    if (value !== undefined) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }
  if (input.visibleToHumanId !== undefined) {
    values.push(input.visibleToHumanId);
    const humanParam = values.length;
    conditions.push(
      `(conversation_id IN (
          SELECT conversation_id
          FROM endeavor.conversation_members
          WHERE participant_type = 'human' AND participant_id = $${humanParam} AND removed_at IS NULL
        )
        OR (requested_by_type = 'human' AND requested_by_id = $${humanParam}))`
    );
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    runKey: row.run_key,
    conversationId: row.conversation_id,
    ownerAgentId: row.owner_agent_id,
    agentVersionId: row.agent_version_id,
    title: row.title,
    brief: row.brief,
    completionCriteria: row.completion_criteria,
    reviewRequired: row.review_required,
    state: row.state,
    stateReason: row.state_reason,
    pausedAt: row.paused_at,
    requestedByType: row.requested_by_type,
    requestedById: row.requested_by_id,
    requestMessageId: row.request_message_id,
    parentTaskId: row.parent_task_id,
    restartedFromTaskId: row.restarted_from_task_id,
    responsibilityId: row.responsibility_id,
    criteriaCheck: row.criteria_check
      ? { ...row.criteria_check, checkedAt: new Date(row.criteria_check.checkedAt) }
      : null,
    review: row.review ? { ...row.review, reviewedAt: new Date(row.review.reviewedAt) } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at
  };
}

function toTaskWait(row: TaskWaitRow): TaskWait {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    targetId: row.target_id,
    description: row.description,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution
  };
}

function toTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: Number(row.id),
    taskId: row.task_id,
    type: row.type,
    actor: { type: row.actor_type, id: row.actor_id },
    data: row.data,
    createdAt: row.created_at
  };
}

function toTaskOutput(row: TaskOutputRow): TaskOutput {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    uri: row.uri,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

// The WHERE clause for cost queries. Only fixed column names are written into the SQL; every
// value is a parameter.
function buildCostWhereClause(filter: CostFilter): { where: string; values: unknown[] } {
  const clauses = [`e.type IN ('model.turn', 'completion.checked')`];
  const values: unknown[] = [];
  if (filter.agentId) {
    values.push(filter.agentId);
    clauses.push(`t.owner_agent_id = $${values.length}`);
  }
  if (filter.conversationId) {
    values.push(filter.conversationId);
    clauses.push(`t.conversation_id = $${values.length}`);
  }
  if (filter.since) {
    values.push(filter.since);
    clauses.push(`e.created_at >= $${values.length}`);
  }
  return { where: clauses.join(' AND '), values };
}
