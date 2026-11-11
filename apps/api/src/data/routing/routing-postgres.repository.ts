import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { RoutingRecord } from '../../shared/routing';
import { RoutingRepository, RoutingSave } from './routing.repository';

function record(row: Record<string, unknown>): RoutingRecord {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    messageId: row.message_id as string | null,
    taskId: row.task_id as string | null,
    kind: row.kind as RoutingRecord['kind'],
    status: row.status as RoutingRecord['status'],
    selectedAgentId: row.selected_agent_id as string | null,
    outcome: row.outcome as string | null,
    reason: row.reason as string,
    confidence: row.confidence as number,
    candidates: row.candidates as RoutingRecord['candidates'],
    revision: row.revision as number,
    deliveryMessageId: row.delivery_message_id as string | null,
    createdAt: row.created_at as Date
  };
}

export class RoutingPostgresRepository implements RoutingRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async delivery(messageId: string): Promise<{ taskId: string | null } | null> {
    const result = await this.db.query(
      'SELECT task_id FROM endeavor.message_deliveries WHERE message_id=$1',
      [messageId]
    );
    return result.rows[0] ? { taskId: result.rows[0].task_id } : null;
  }

  async discoverFinished(): Promise<void> {
    await this.db.query(`INSERT INTO endeavor.routing_decisions (id, conversation_id, task_id, kind)
      SELECT gen_random_uuid(), t.conversation_id, t.id, 'handoff' FROM endeavor.tasks t
      WHERE t.state = 'completed' AND t.conversation_id IS NOT NULL
        AND t.finished_at >= (SELECT started_at FROM endeavor.routing_epoch LIMIT 1)
        AND EXISTS (SELECT 1 FROM endeavor.task_events e WHERE e.task_id = t.id AND e.type = 'result.posted')
        AND NOT EXISTS (SELECT 1 FROM endeavor.routing_decisions d WHERE d.task_id=t.id AND d.kind='handoff')
      ORDER BY t.finished_at LIMIT 50
      ON CONFLICT DO NOTHING`);
  }

  async claim(token: string, leaseMs: number): Promise<RoutingRecord | null> {
    const result = await this.db.query(
      `UPDATE endeavor.routing_decisions d
      SET lease_token = $1, claimed_until = now() + $2::int * interval '1 millisecond'
      FROM (SELECT id FROM endeavor.routing_decisions WHERE status = 'pending'
        AND (claimed_until IS NULL OR claimed_until < now()) ORDER BY created_at LIMIT 1
        FOR UPDATE SKIP LOCKED) p WHERE d.id = p.id RETURNING d.*`,
      [token, leaseMs]
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async get(id: string): Promise<RoutingRecord | null> {
    const result = await this.db.query('SELECT * FROM endeavor.routing_decisions WHERE id = $1', [
      id
    ]);
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async count(conversationId: string, since: Date | null): Promise<number> {
    const result = await this.db.query(
      `SELECT count(*)::int AS total FROM endeavor.routing_decisions
      WHERE conversation_id=$1 AND status IN ('waiting','resolved')
        AND ($2::timestamptz IS NULL OR created_at >= $2)`,
      [conversationId, since]
    );
    return result.rows[0].total;
  }

  async list(
    conversationId: string,
    since: Date | null,
    limit: number,
    offset: number
  ): Promise<RoutingRecord[]> {
    const result = await this.db.query(
      `SELECT * FROM endeavor.routing_decisions
      WHERE conversation_id = $1 AND status IN ('waiting', 'resolved')
        AND ($2::timestamptz IS NULL OR created_at >= $2)
      ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [conversationId, since, limit, offset]
    );
    return result.rows.map(record);
  }

  async taskMessages(taskId: string): Promise<{ messageId: string; delivered: boolean }[]> {
    const result = await this.db.query(
      `SELECT m.id, EXISTS (
        SELECT 1 FROM endeavor.message_deliveries d WHERE d.message_id = m.id
      ) AS delivered FROM endeavor.messages m WHERE m.task_id = $1`,
      [taskId]
    );
    return result.rows.map((row) => ({ messageId: row.id, delivered: row.delivered }));
  }

  async save(
    id: string,
    revision: number,
    input: RoutingSave,
    options: Parameters<RoutingRepository['save']>[3]
  ): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT d.* FROM endeavor.routing_decisions d
        JOIN endeavor.conversations c ON c.id = d.conversation_id
        WHERE d.id = $1 AND d.revision = $2 AND c.closed_at IS NULL
          AND ($3::uuid IS NULL OR (d.lease_token = $3 AND d.claimed_until > now()))
        FOR UPDATE OF d, c`,
        [id, revision, options.token ?? null]
      );
      const row = locked.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return false;
      }
      if (options.actorId) {
        const member = await client.query(
          `SELECT participant_id FROM endeavor.conversation_members
          WHERE conversation_id=$1 AND participant_type='human' AND participant_id=$2
            AND removed_at IS NULL FOR SHARE`,
          [row.conversation_id, options.actorId]
        );
        if (!member.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
      }
      if (options.actorId && row.delivery_message_id) {
        const delivery = await client.query(
          `SELECT * FROM endeavor.message_deliveries
          WHERE message_id=$1 FOR UPDATE`,
          [row.delivery_message_id]
        );
        for (const d of delivery.rows) {
          if (!d.delivered_at) {
            if (d.claimed_until && d.claimed_until > new Date()) {
              await client.query('ROLLBACK');
              return false;
            }
            await client.query(
              'DELETE FROM endeavor.message_deliveries WHERE message_id=$1 AND agent_id=$2',
              [d.message_id, d.agent_id]
            );
          } else if (options.cancelTask) {
            const plan = options.cancelTask;
            const cancelled = await client.query(
              `UPDATE endeavor.tasks SET state='cancelled', state_reason=$3,
                paused_at=NULL, finished_at=now(), lease_owner=NULL, lease_expires_at=NULL,
                updated_at=now() WHERE id=$1 AND state=$2 AND request_message_id=$4 RETURNING id`,
              [plan.id, plan.state, 'A person changed the routing choice.', row.delivery_message_id]
            );
            if (!cancelled.rowCount || d.task_id !== plan.id) {
              await client.query('ROLLBACK');
              return false;
            }
            await client.query(
              `UPDATE endeavor.task_waits SET resolved_at=now(), resolution=$2
              WHERE task_id=$1 AND resolved_at IS NULL`,
              [plan.id, JSON.stringify({ cancelled: true })]
            );
            await client.query(
              `INSERT INTO endeavor.task_events(task_id,type,actor_type,actor_id,data)
              VALUES ($1,'state.changed','human',$2,$3)`,
              [
                plan.id,
                options.actorId,
                JSON.stringify({
                  from: plan.state,
                  to: 'cancelled',
                  reason: 'Routing choice changed'
                })
              ]
            );
          } else if (d.task_id) {
            // A delivered target must still be terminal when no cancellation was requested.
            const unchanged = await client.query(
              `SELECT id FROM endeavor.tasks
              WHERE id=$1 AND state IN ('completed','cancelled') FOR UPDATE`,
              [d.task_id]
            );
            if (!unchanged.rowCount) {
              await client.query('ROLLBACK');
              return false;
            }
          }
        }
      }

      if (input.selectedAgentId) {
        const available = await client.query(
          `SELECT a.id FROM endeavor.agents a
          JOIN endeavor.conversation_members m ON m.participant_id = a.id AND m.participant_type = 'agent'
          WHERE a.id = $1 AND m.conversation_id = $2 AND m.removed_at IS NULL
            AND a.disabled_at IS NULL AND a.deleted_at IS NULL AND a.current_version_id IS NOT NULL
          FOR SHARE OF a, m`,
          [input.selectedAgentId, row.conversation_id]
        );
        if (!available.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
      }
      if (input.selectedAgentId && row.kind === 'starter') {
        const scheduled = await client.query<{ responsibility_id: string }>(
          `SELECT r.responsibility_id FROM endeavor.responsibility_runs r
           JOIN endeavor.responsibilities s ON s.id = r.responsibility_id
           WHERE r.starter_message_id = $1 FOR NO KEY UPDATE OF s`,
          [row.message_id]
        );
        if (scheduled.rows[0]) {
          // A person can change a past routing choice. Serialize against new starts so a
          // past run cannot be assigned an agent while a newer run is still open.
          const other = await client.query(
            `SELECT 1 FROM endeavor.responsibility_run_history
             WHERE responsibility_id = $1 AND conversation_id IS DISTINCT FROM $2::uuid
               AND state IN ('working', 'waiting', 'blocked', 'routing')
             LIMIT 1`,
            [scheduled.rows[0].responsibility_id, row.conversation_id]
          );
          if (other.rowCount) {
            await client.query('ROLLBACK');
            return false;
          }
        }
      }
      let deliveryMessageId = options.deliveryMessageId;
      if (options.message) {
        const m = options.message;
        const saved = await client.query(
          `INSERT INTO endeavor.messages
          (id, conversation_id, author_type, author_id, body, mentions, in_reply_to_message_id, task_id, client_key)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            randomUUID(),
            m.conversationId,
            m.authorType,
            m.authorId,
            m.body,
            JSON.stringify(m.mentions),
            m.inReplyToMessageId,
            m.taskId,
            m.clientKey
          ]
        );
        if (m.deliverToAgentIds.length) deliveryMessageId = saved.rows[0].id;
      }
      if (input.selectedAgentId && deliveryMessageId) {
        await client.query(
          `INSERT INTO endeavor.message_deliveries(message_id, agent_id)
          VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [deliveryMessageId, input.selectedAgentId]
        );
      }
      await client.query(
        `UPDATE endeavor.routing_decisions SET status=$2, selected_agent_id=$3,
        outcome=$4, reason=$5, confidence=$6, candidates=$7, model=$8, usage=$9,
        revision=revision+1, lease_token=NULL, claimed_until=NULL, delivery_message_id=$10,
        decided_by_human_id=$11, updated_at=now() WHERE id=$1`,
        [
          id,
          input.status,
          input.selectedAgentId,
          input.outcome,
          input.reason,
          input.confidence,
          JSON.stringify(input.candidates),
          input.model,
          JSON.stringify(input.usage),
          deliveryMessageId,
          options.actorId ?? null
        ]
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
}
