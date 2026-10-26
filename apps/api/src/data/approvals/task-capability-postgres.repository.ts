import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  AccessDuration,
  ConnectionScope,
  GrantTargetType,
  TaskCapability
} from '../../shared/types';
import { TaskCapabilityRepository } from './task-capability.repository';

interface TaskCapabilityRow {
  id: string;
  task_id: string;
  approval_id: string;
  target_type: GrantTargetType;
  target_id: string;
  skill_version_id: string | null;
  scope: ConnectionScope | null;
  duration: AccessDuration;
  granted_by_human_id: string;
  granted_at: Date;
  revoked_by_human_id: string | null;
  revoked_at: Date | null;
}

export class TaskCapabilityPostgresRepository implements TaskCapabilityRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async add(input: {
    taskId: string;
    approvalId: string;
    targetType: GrantTargetType;
    targetId: string;
    skillVersionId: string | null;
    scope: ConnectionScope | null;
    duration: AccessDuration;
    grantedByHumanId: string;
  }): Promise<{ capability: TaskCapability; created: boolean }> {
    const result = await this.db.query<TaskCapabilityRow>(
      `INSERT INTO endeavor.task_capabilities (
         id, task_id, approval_id, target_type, target_id, skill_version_id, scope, duration,
         granted_by_human_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (approval_id) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        input.taskId,
        input.approvalId,
        input.targetType,
        input.targetId,
        input.skillVersionId,
        input.scope,
        input.duration,
        input.grantedByHumanId
      ]
    );
    if (result.rows[0]) {
      return { capability: toTaskCapability(result.rows[0]), created: true };
    }
    const existing = await this.db.query<TaskCapabilityRow>(
      `SELECT * FROM endeavor.task_capabilities WHERE approval_id = $1`,
      [input.approvalId]
    );
    return { capability: toTaskCapability(existing.rows[0]), created: false };
  }

  async getById(capabilityId: string): Promise<TaskCapability | null> {
    const result = await this.db.query<TaskCapabilityRow>(
      `SELECT * FROM endeavor.task_capabilities WHERE id = $1`,
      [capabilityId]
    );
    return result.rows[0] ? toTaskCapability(result.rows[0]) : null;
  }

  async listForTask(taskId: string, options: { activeOnly: boolean }): Promise<TaskCapability[]> {
    const result = await this.db.query<TaskCapabilityRow>(
      `SELECT *
       FROM endeavor.task_capabilities
       WHERE task_id = $1
         AND (NOT $2 OR revoked_at IS NULL)
       ORDER BY granted_at, id`,
      [taskId, options.activeOnly]
    );
    return result.rows.map(toTaskCapability);
  }

  async revoke(capabilityId: string, humanId: string): Promise<TaskCapability | null> {
    const result = await this.db.query<TaskCapabilityRow>(
      `UPDATE endeavor.task_capabilities
       SET revoked_at = now(), revoked_by_human_id = $2
       WHERE id = $1
         AND revoked_at IS NULL
       RETURNING *`,
      [capabilityId, humanId]
    );
    return result.rows[0] ? toTaskCapability(result.rows[0]) : null;
  }
}

function toTaskCapability(row: TaskCapabilityRow): TaskCapability {
  return {
    id: row.id,
    taskId: row.task_id,
    approvalId: row.approval_id,
    targetType: row.target_type,
    targetId: row.target_id,
    skillVersionId: row.skill_version_id,
    scope: row.scope,
    duration: row.duration,
    grantedByHumanId: row.granted_by_human_id,
    grantedAt: row.granted_at,
    revokedByHumanId: row.revoked_by_human_id,
    revokedAt: row.revoked_at
  };
}
