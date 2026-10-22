import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { MissedRunPolicy, Responsibility, ResponsibilityStatus } from '../../shared/types';
import {
  CreateResponsibilityInput,
  ResponsibilityChanges,
  ResponsibilityRepository
} from './responsibility.repository';

interface ResponsibilityRow {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  title: string;
  brief: string;
  completion_criteria: string;
  interval_minutes: number;
  missed_run_policy: MissedRunPolicy;
  status: ResponsibilityStatus;
  next_run_at: Date;
  last_run_at: Date | null;
  created_by_human_id: string;
  created_at: Date;
  updated_at: Date;
}

const CHANGE_COLUMNS: Record<keyof ResponsibilityChanges, string> = {
  title: 'title',
  brief: 'brief',
  completionCriteria: 'completion_criteria',
  intervalMinutes: 'interval_minutes',
  missedRunPolicy: 'missed_run_policy',
  nextRunAt: 'next_run_at',
  status: 'status'
};

export class ResponsibilityPostgresRepository implements ResponsibilityRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: CreateResponsibilityInput): Promise<Responsibility> {
    const result = await this.db.query<ResponsibilityRow>(
      `INSERT INTO bold_cedar_007.responsibilities (
         id, agent_id, conversation_id, title, brief, completion_criteria, interval_minutes,
         missed_run_policy, next_run_at, created_by_human_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        randomUUID(),
        input.agentId,
        input.conversationId,
        input.title,
        input.brief,
        input.completionCriteria,
        input.intervalMinutes,
        input.missedRunPolicy,
        input.nextRunAt,
        input.createdByHumanId
      ]
    );
    return toResponsibility(result.rows[0]);
  }

  async getById(responsibilityId: string): Promise<Responsibility | null> {
    const result = await this.db.query<ResponsibilityRow>(
      `SELECT * FROM bold_cedar_007.responsibilities WHERE id = $1`,
      [responsibilityId]
    );
    return result.rows[0] ? toResponsibility(result.rows[0]) : null;
  }

  async list(input: {
    agentId?: string;
    status?: ResponsibilityStatus;
    limit: number;
    offset: number;
  }): Promise<Responsibility[]> {
    const result = await this.db.query<ResponsibilityRow>(
      `SELECT *
       FROM bold_cedar_007.responsibilities
       WHERE ($1::uuid IS NULL OR agent_id = $1)
         AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC, id
       LIMIT $3 OFFSET $4`,
      [input.agentId ?? null, input.status ?? null, input.limit, input.offset]
    );
    return result.rows.map(toResponsibility);
  }

  async count(input: { agentId?: string; status?: ResponsibilityStatus }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.responsibilities
       WHERE ($1::uuid IS NULL OR agent_id = $1)
         AND ($2::text IS NULL OR status = $2)`,
      [input.agentId ?? null, input.status ?? null]
    );
    return result.rows[0].total;
  }

  async update(
    responsibilityId: string,
    changes: ResponsibilityChanges
  ): Promise<Responsibility | null> {
    const values: unknown[] = [responsibilityId];
    const sets = ['updated_at = now()'];
    for (const [field, column] of Object.entries(CHANGE_COLUMNS)) {
      const value = changes[field as keyof ResponsibilityChanges];
      if (value !== undefined) {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      }
    }
    const result = await this.db.query<ResponsibilityRow>(
      `UPDATE bold_cedar_007.responsibilities
       SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING *`,
      values
    );
    return result.rows[0] ? toResponsibility(result.rows[0]) : null;
  }

  async listDue(now: Date, limit: number): Promise<Responsibility[]> {
    const result = await this.db.query<ResponsibilityRow>(
      `SELECT *
       FROM bold_cedar_007.responsibilities
       WHERE status = 'enabled'
         AND next_run_at <= $1
       ORDER BY next_run_at
       LIMIT $2`,
      [now, limit]
    );
    return result.rows.map(toResponsibility);
  }

  async advance(
    responsibilityId: string,
    expectedNextRunAt: Date,
    changes: { nextRunAt: Date; lastRunAt: Date | null }
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE bold_cedar_007.responsibilities
       SET next_run_at = $3,
           last_run_at = coalesce($4, last_run_at),
           updated_at = now()
       WHERE id = $1
         AND next_run_at = $2
         AND status = 'enabled'`,
      [responsibilityId, expectedNextRunAt, changes.nextRunAt, changes.lastRunAt]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function toResponsibility(row: ResponsibilityRow): Responsibility {
  return {
    id: row.id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    title: row.title,
    brief: row.brief,
    completionCriteria: row.completion_criteria,
    intervalMinutes: row.interval_minutes,
    missedRunPolicy: row.missed_run_policy,
    status: row.status,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
