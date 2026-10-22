import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Conversation, ConversationMember, ParticipantRef } from '../../shared/types';
import { ConversationRepository } from './conversation.repository';

interface ConversationRow {
  id: string;
  title: string;
  created_by_human_id: string;
  created_at: Date;
}

interface MemberRow {
  conversation_id: string;
  participant_type: 'human' | 'agent';
  participant_id: string;
  added_by_human_id: string | null;
  history_from: Date | null;
  added_at: Date;
}

export class ConversationPostgresRepository implements ConversationRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: { title: string; createdByHumanId: string }): Promise<Conversation> {
    const result = await this.db.query<ConversationRow>(
      `INSERT INTO bold_cedar_007.conversations (id, title, created_by_human_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [randomUUID(), input.title, input.createdByHumanId]
    );

    return toConversation(result.rows[0]);
  }

  async getById(conversationId: string): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `SELECT *
       FROM bold_cedar_007.conversations
       WHERE id = $1`,
      [conversationId]
    );

    return result.rows[0] ? toConversation(result.rows[0]) : null;
  }

  async list(input: {
    participant: ParticipantRef | null;
    limit: number;
    offset: number;
  }): Promise<Conversation[]> {
    const result = await this.db.query<ConversationRow>(
      `SELECT c.*
       FROM bold_cedar_007.conversations c
       WHERE $1::text IS NULL
          OR EXISTS (
            SELECT 1
            FROM bold_cedar_007.conversation_members m
            WHERE m.conversation_id = c.id
              AND m.participant_type = $1
              AND m.participant_id = $2
              AND m.removed_at IS NULL
          )
       ORDER BY c.created_at DESC, c.id
       LIMIT $3 OFFSET $4`,
      [input.participant?.type ?? null, input.participant?.id ?? null, input.limit, input.offset]
    );

    return result.rows.map(toConversation);
  }

  async count(input: { participant: ParticipantRef | null }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.conversations c
       WHERE $1::text IS NULL
          OR EXISTS (
            SELECT 1
            FROM bold_cedar_007.conversation_members m
            WHERE m.conversation_id = c.id
              AND m.participant_type = $1
              AND m.participant_id = $2
              AND m.removed_at IS NULL
          )`,
      [input.participant?.type ?? null, input.participant?.id ?? null]
    );

    return result.rows[0].total;
  }

  async addMember(input: {
    conversationId: string;
    participant: ParticipantRef;
    addedByHumanId: string | null;
    historyFrom: Date | null;
  }): Promise<ConversationMember> {
    await this.db.query(
      `INSERT INTO bold_cedar_007.conversation_members (
         conversation_id, participant_type, participant_id, added_by_human_id, history_from
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, participant_type, participant_id) DO NOTHING`,
      [
        input.conversationId,
        input.participant.type,
        input.participant.id,
        input.addedByHumanId,
        input.historyFrom
      ]
    );

    const member = await this.getMember(input.conversationId, input.participant);
    if (!member) {
      throw new Error(`Member ${input.participant.id} was not saved`);
    }
    return member;
  }

  async listMembers(conversationId: string): Promise<ConversationMember[]> {
    const result = await this.db.query<MemberRow>(
      `SELECT *
       FROM bold_cedar_007.conversation_members
       WHERE conversation_id = $1
         AND removed_at IS NULL
       ORDER BY added_at, participant_id`,
      [conversationId]
    );

    return result.rows.map(toMember);
  }

  async getMember(
    conversationId: string,
    participant: ParticipantRef
  ): Promise<ConversationMember | null> {
    const result = await this.db.query<MemberRow>(
      `SELECT *
       FROM bold_cedar_007.conversation_members
       WHERE conversation_id = $1
         AND participant_type = $2
         AND participant_id = $3
         AND removed_at IS NULL`,
      [conversationId, participant.type, participant.id]
    );

    return result.rows[0] ? toMember(result.rows[0]) : null;
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at
  };
}

function toMember(row: MemberRow): ConversationMember {
  return {
    conversationId: row.conversation_id,
    participant: { type: row.participant_type, id: row.participant_id },
    addedByHumanId: row.added_by_human_id,
    historyFrom: row.history_from,
    addedAt: row.added_at
  };
}
