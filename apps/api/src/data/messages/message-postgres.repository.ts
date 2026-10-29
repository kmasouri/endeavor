import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { ActorType, Message, MessageDelivery, ParticipantRef } from '../../shared/types';
import { CreateMessageInput, MessageRepository } from './message.repository';

interface MessageRow {
  id: string;
  conversation_id: string;
  author_type: ActorType;
  author_id: string | null;
  body: string;
  mentions: ParticipantRef[];
  in_reply_to_message_id: string | null;
  task_id: string | null;
  created_at: Date;
}

interface DeliveryRow {
  message_id: string;
  agent_id: string;
  created_at: Date;
}

export class MessagePostgresRepository implements MessageRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  // The message and its deliveries are saved in one statement, so a message addressed to an
  // agent is never saved without its delivery.
  async create(input: CreateMessageInput): Promise<{ message: Message; created: boolean }> {
    const result = await this.db.query<MessageRow>(
      `WITH saved AS (
         INSERT INTO endeavor.messages (
           id, conversation_id, author_type, author_id, body, mentions, in_reply_to_message_id,
           task_id, client_key
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (client_key) WHERE client_key IS NOT NULL DO NOTHING
         RETURNING *
       ), delivered AS (
         INSERT INTO endeavor.message_deliveries (message_id, agent_id)
         SELECT saved.id, agent_id
         FROM saved, unnest($10::uuid[]) AS agent_id
       )
       SELECT * FROM saved`,
      [
        randomUUID(),
        input.conversationId,
        input.authorType,
        input.authorId,
        input.body,
        // jsonb needs a JSON string here: pg would send a JS array as a Postgres array.
        JSON.stringify(input.mentions),
        input.inReplyToMessageId,
        input.taskId,
        input.clientKey,
        input.deliverToAgentIds
      ]
    );

    if (result.rows[0]) {
      return { message: toMessage(result.rows[0]), created: true };
    }

    const existing = await this.db.query<MessageRow>(
      `SELECT *
       FROM endeavor.messages
       WHERE client_key = $1`,
      [input.clientKey]
    );
    return { message: toMessage(existing.rows[0]), created: false };
  }

  async getById(messageId: string): Promise<Message | null> {
    const result = await this.db.query<MessageRow>(
      `SELECT *
       FROM endeavor.messages
       WHERE id = $1`,
      [messageId]
    );

    return result.rows[0] ? toMessage(result.rows[0]) : null;
  }

  async list(
    conversationId: string,
    options: { since: Date | null; limit: number; offset: number }
  ): Promise<Message[]> {
    const result = await this.db.query<MessageRow>(
      `SELECT *
       FROM endeavor.messages
       WHERE conversation_id = $1
         AND ($2::timestamptz IS NULL OR created_at >= $2)
       ORDER BY created_at, id
       LIMIT $3 OFFSET $4`,
      [conversationId, options.since, options.limit, options.offset]
    );

    return result.rows.map(toMessage);
  }

  async listWindow(
    conversationId: string,
    options: { since: Date | null; limit: number; beforeId?: string; afterId?: string }
  ): Promise<Message[]> {
    const order = options.afterId ? 'ASC' : 'DESC';
    const result = await this.db.query<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM endeavor.messages
         WHERE conversation_id = $1
           AND ($2::timestamptz IS NULL OR created_at >= $2)
           AND ($4::uuid IS NULL OR (created_at, id) < (
             SELECT created_at, id FROM endeavor.messages WHERE id = $4 AND conversation_id = $1
           ))
           AND ($5::uuid IS NULL OR (created_at, id) > (
             SELECT created_at, id FROM endeavor.messages WHERE id = $5 AND conversation_id = $1
           ))
         ORDER BY created_at ${order}, id ${order}
         LIMIT $3
       ) message_window ORDER BY created_at, id`,
      [
        conversationId,
        options.since,
        options.limit,
        options.beforeId ?? null,
        options.afterId ?? null
      ]
    );
    return result.rows.map(toMessage);
  }

  async listRecent(
    conversationId: string,
    options: { since: Date | null; limit: number }
  ): Promise<Message[]> {
    const result = await this.db.query<MessageRow>(
      `SELECT *
       FROM (
         SELECT *
         FROM endeavor.messages
         WHERE conversation_id = $1
           AND ($2::timestamptz IS NULL OR created_at >= $2)
         ORDER BY created_at DESC, id DESC
         LIMIT $3
       ) recent
       ORDER BY created_at, id`,
      [conversationId, options.since, options.limit]
    );

    return result.rows.map(toMessage);
  }

  async claimDeliveries(limit: number, leaseMs: number): Promise<MessageDelivery[]> {
    const result = await this.db.query<DeliveryRow>(
      `UPDATE endeavor.message_deliveries d
       SET claimed_until = now() + $2::int * interval '1 millisecond'
       FROM (
         SELECT message_id, agent_id
         FROM endeavor.message_deliveries
         WHERE delivered_at IS NULL
           AND failed_at IS NULL
           AND (claimed_until IS NULL OR claimed_until < now())
         ORDER BY created_at, message_id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ) pending
       WHERE d.message_id = pending.message_id
         AND d.agent_id = pending.agent_id
       RETURNING d.message_id, d.agent_id, d.created_at`,
      [limit, Math.round(leaseMs)]
    );

    // RETURNING order isn't guaranteed; deliver oldest first.
    result.rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    return result.rows.map((row) => ({
      messageId: row.message_id,
      agentId: row.agent_id,
      createdAt: row.created_at
    }));
  }

  async recordDeliveryFailure(
    messageId: string,
    agentId: string,
    error: string,
    maxAttempts: number
  ): Promise<void> {
    await this.db.query(
      `UPDATE endeavor.message_deliveries
       SET attempts = attempts + 1,
           last_error = $3,
           claimed_until = NULL,
           failed_at = CASE WHEN attempts + 1 >= $4::int THEN now() ELSE NULL END
       WHERE message_id = $1
         AND agent_id = $2`,
      [messageId, agentId, error.slice(0, 2000), maxAttempts]
    );
  }

  async markDelivered(messageId: string, agentId: string, taskId: string | null): Promise<void> {
    await this.db.query(
      `UPDATE endeavor.message_deliveries
       SET delivered_at = now(), task_id = $3
       WHERE message_id = $1
         AND agent_id = $2`,
      [messageId, agentId, taskId]
    );
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorType: row.author_type,
    authorId: row.author_id,
    body: row.body,
    mentions: row.mentions,
    inReplyToMessageId: row.in_reply_to_message_id,
    taskId: row.task_id,
    createdAt: row.created_at
  };
}
