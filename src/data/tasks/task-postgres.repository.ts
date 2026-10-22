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
  CreateTaskInput,
  CreateTaskOutputInput,
  CreateTaskWaitInput,
  ListTasksInput,
  TaskChanges,
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
  finishedAt: 'finished_at'
};

export class TaskPostgresRepository implements TaskRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: CreateTaskInput): Promise<{ task: Task; created: boolean }> {
    const result = await this.db.query<TaskRow>(
      `INSERT INTO bold_cedar_007.tasks (
         id, run_key, conversation_id, owner_agent_id, agent_version_id, title, brief,
         completion_criteria, review_required, state, requested_by_type, requested_by_id,
         request_message_id, parent_task_id, restarted_from_task_id, responsibility_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'working', $10, $11, $12, $13, $14, $15)
       ON CONFLICT (run_key) DO NOTHING
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

    const existing = await this.getByRunKey(input.runKey);
    if (!existing) {
      throw new Error(`Task with run key ${input.runKey} conflicted but was not found`);
    }
    return { task: existing, created: false };
  }

  async getById(taskId: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM bold_cedar_007.tasks
       WHERE id = $1`,
      [taskId]
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async getByRunKey(runKey: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM bold_cedar_007.tasks
       WHERE run_key = $1`,
      [runKey]
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async list(input: ListTasksInput): Promise<Task[]> {
    const { where, values } = listFilters(input);
    const result = await this.db.query<TaskRow>(
      `SELECT *
       FROM bold_cedar_007.tasks
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
       FROM bold_cedar_007.tasks
       ${where}`,
      values
    );

    return result.rows[0].total;
  }

  async update(
    taskId: string,
    expected: { state: TaskState; paused: boolean },
    changes: TaskChanges
  ): Promise<Task | null> {
    const values: unknown[] = [taskId, expected.state];
    const sets = ['updated_at = now()'];
    for (const [field, column] of Object.entries(CHANGE_COLUMNS)) {
      const value = changes[field as keyof TaskChanges];
      if (value !== undefined) {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      }
    }

    // A task that leaves 'working' gives up its lease, so no worker keeps running it.
    if (changes.state && changes.state !== 'working') {
      sets.push('lease_owner = NULL', 'lease_expires_at = NULL');
    }

    const result = await this.db.query<TaskRow>(
      `UPDATE bold_cedar_007.tasks
       SET ${sets.join(', ')}
       WHERE id = $1
         AND state = $2
         AND (paused_at IS NOT NULL) = ${expected.paused ? 'true' : 'false'}
       RETURNING *`,
      values
    );

    return result.rows[0] ? toTask(result.rows[0]) : null;
  }

  async addWaits(taskId: string, waits: CreateTaskWaitInput[]): Promise<TaskWait[]> {
    const created: TaskWait[] = [];
    for (const wait of waits) {
      const result = await this.db.query<TaskWaitRow>(
        `INSERT INTO bold_cedar_007.task_waits (id, task_id, kind, target_id, description)
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
       FROM bold_cedar_007.task_waits
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
       FROM bold_cedar_007.task_waits
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
      `UPDATE bold_cedar_007.task_waits
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
      `UPDATE bold_cedar_007.task_waits
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
      `INSERT INTO bold_cedar_007.task_events (task_id, type, actor_type, actor_id, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [taskId, type, actor.type, actor.id, data]
    );

    return toTaskEvent(result.rows[0]);
  }

  async listEvents(
    taskId: string,
    options: { afterId: number; limit: number }
  ): Promise<TaskEvent[]> {
    const result = await this.db.query<TaskEventRow>(
      `SELECT *
       FROM bold_cedar_007.task_events
       WHERE task_id = $1
         AND id > $2
       ORDER BY id
       LIMIT $3`,
      [taskId, options.afterId, options.limit]
    );

    return result.rows.map(toTaskEvent);
  }

  async addOutput(taskId: string, input: CreateTaskOutputInput): Promise<TaskOutput> {
    const result = await this.db.query<TaskOutputRow>(
      `INSERT INTO bold_cedar_007.task_outputs (id, task_id, kind, title, content, uri, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [randomUUID(), taskId, input.kind, input.title, input.content, input.uri, input.metadata]
    );

    return toTaskOutput(result.rows[0]);
  }

  async listOutputs(taskId: string): Promise<TaskOutput[]> {
    const result = await this.db.query<TaskOutputRow>(
      `SELECT *
       FROM bold_cedar_007.task_outputs
       WHERE task_id = $1
       ORDER BY created_at, id`,
      [taskId]
    );

    return result.rows.map(toTaskOutput);
  }

  async countOutputs(taskId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.task_outputs
       WHERE task_id = $1`,
      [taskId]
    );

    return result.rows[0].total;
  }

  async claimRunnable(workerId: string, leaseMs: number, limit: number): Promise<Task[]> {
    // SKIP LOCKED lets several workers claim at once without taking the same task.
    const result = await this.db.query<TaskRow>(
      `UPDATE bold_cedar_007.tasks
       SET lease_owner = $1,
           lease_expires_at = now() + ($2::text || ' milliseconds')::interval
       WHERE id IN (
         SELECT id
         FROM bold_cedar_007.tasks
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

  async releaseLease(taskId: string, workerId: string): Promise<void> {
    await this.db.query(
      `UPDATE bold_cedar_007.tasks
       SET lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1
         AND lease_owner = $2`,
      [taskId, workerId]
    );
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
    [input.conversationId, 'conversation_id']
  ];
  for (const [value, column] of filters) {
    if (value !== undefined) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
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
