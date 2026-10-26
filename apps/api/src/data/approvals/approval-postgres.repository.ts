import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  AccessDuration,
  Approval,
  ApprovalRequest,
  ApprovalResult,
  ApprovalStatus
} from '../../shared/types';
import { ApprovalRepository } from './approval.repository';

interface ApprovalRow {
  id: string;
  task_id: string;
  agent_id: string;
  kind: Approval['kind'];
  request: ApprovalRequest;
  status: ApprovalStatus;
  duration: AccessDuration | null;
  decided_by_human_id: string | null;
  decided_at: Date | null;
  reason: string | null;
  executed_at: Date | null;
  result: ApprovalResult | null;
  created_at: Date;
}

export class ApprovalPostgresRepository implements ApprovalRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: {
    clientKey: string;
    taskId: string;
    agentId: string;
    kind: Approval['kind'];
    request: ApprovalRequest;
  }): Promise<{ approval: Approval; created: boolean }> {
    const result = await this.db.query<ApprovalRow>(
      `INSERT INTO endeavor.approvals (id, client_key, task_id, agent_id, kind, request)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_key) DO NOTHING
       RETURNING *`,
      [randomUUID(), input.clientKey, input.taskId, input.agentId, input.kind, input.request]
    );
    if (result.rows[0]) {
      return { approval: toApproval(result.rows[0]), created: true };
    }
    const existing = await this.db.query<ApprovalRow>(
      `SELECT * FROM endeavor.approvals WHERE client_key = $1`,
      [input.clientKey]
    );
    return { approval: toApproval(existing.rows[0]), created: false };
  }

  async getByClientKey(clientKey: string): Promise<Approval | null> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT * FROM endeavor.approvals WHERE client_key = $1`,
      [clientKey]
    );
    return result.rows[0] ? toApproval(result.rows[0]) : null;
  }

  async getById(approvalId: string): Promise<Approval | null> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT * FROM endeavor.approvals WHERE id = $1`,
      [approvalId]
    );
    return result.rows[0] ? toApproval(result.rows[0]) : null;
  }

  async listForTask(taskId: string): Promise<Approval[]> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT * FROM endeavor.approvals WHERE task_id = $1 ORDER BY created_at, id`,
      [taskId]
    );
    return result.rows.map(toApproval);
  }

  async list(input: {
    status?: ApprovalStatus;
    visibleToHumanId?: string;
    limit: number;
    offset: number;
  }): Promise<Approval[]> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT a.*
       FROM endeavor.approvals a
       ${VISIBLE_JOIN}
       ORDER BY a.created_at DESC, a.id
       LIMIT $3 OFFSET $4`,
      [input.status ?? null, input.visibleToHumanId ?? null, input.limit, input.offset]
    );
    return result.rows.map(toApproval);
  }

  async count(input: { status?: ApprovalStatus; visibleToHumanId?: string }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.approvals a
       ${VISIBLE_JOIN}`,
      [input.status ?? null, input.visibleToHumanId ?? null]
    );
    return result.rows[0].total;
  }

  async decide(input: {
    approvalId: string;
    status: 'approved' | 'rejected';
    humanId: string;
    reason: string | null;
    duration?: AccessDuration | null;
  }): Promise<Approval | null> {
    const result = await this.db.query<ApprovalRow>(
      `UPDATE endeavor.approvals
       SET status = $2, decided_by_human_id = $3, decided_at = now(), reason = $4, duration = $5
       WHERE id = $1
         AND status = 'pending'
       RETURNING *`,
      [input.approvalId, input.status, input.humanId, input.reason, input.duration ?? null]
    );
    return result.rows[0] ? toApproval(result.rows[0]) : null;
  }

  async listApprovedNotExecuted(limit: number): Promise<Approval[]> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT *
       FROM endeavor.approvals
       WHERE status = 'approved'
         AND executed_at IS NULL
       ORDER BY decided_at
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(toApproval);
  }

  async listExecutedAwaitingWake(limit: number): Promise<Approval[]> {
    const result = await this.db.query<ApprovalRow>(
      `SELECT a.*
       FROM endeavor.approvals a
       WHERE a.executed_at IS NOT NULL
         AND a.executed_at < now() - interval '2 minutes'
         AND EXISTS (
           SELECT 1
           FROM endeavor.task_waits w
           WHERE w.kind = 'approval'
             AND w.target_id = a.id
             AND w.resolved_at IS NULL
         )
       ORDER BY a.executed_at
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(toApproval);
  }

  async markExecuted(approvalId: string, approvalResult: ApprovalResult): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE endeavor.approvals
       SET executed_at = now(), result = $2
       WHERE id = $1
         AND executed_at IS NULL`,
      [approvalId, approvalResult]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async saveResult(approvalId: string, approvalResult: ApprovalResult): Promise<void> {
    await this.db.query(`UPDATE endeavor.approvals SET result = $2 WHERE id = $1`, [
      approvalId,
      approvalResult
    ]);
  }
}

// $1: status or null for any. $2: a person's ID to limit to tasks they may see, or null.
const VISIBLE_JOIN = `
  JOIN endeavor.tasks t ON t.id = a.task_id
  WHERE ($1::text IS NULL OR a.status = $1)
    AND (
      $2::uuid IS NULL
      OR (t.requested_by_type = 'human' AND t.requested_by_id = $2)
      OR t.conversation_id IN (
        SELECT conversation_id
        FROM endeavor.conversation_members
        WHERE participant_type = 'human' AND participant_id = $2 AND removed_at IS NULL
      )
    )`;

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    kind: row.kind,
    request: row.request,
    status: row.status,
    duration: row.duration ?? null,
    decidedByHumanId: row.decided_by_human_id,
    decidedAt: row.decided_at,
    reason: row.reason,
    executedAt: row.executed_at,
    result: row.result,
    createdAt: row.created_at
  };
}
