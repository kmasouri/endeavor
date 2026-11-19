import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Conversation, ConversationMember, ParticipantRef } from '../../shared/types';
import { ConversationFilter, ConversationRepository } from './conversation.repository';

interface ConversationRow {
  id: string;
  title: string;
  project_id: string | null;
  goal: string | null;
  goal_message_id: string | null;
  done_criteria: string | null;
  closed_at: Date | null;
  closed_by_human_id: string | null;
  created_by_human_id: string;
  budget_usd: string | null;
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

// $1 and $2: the participant, or null for everyone. $3: the project, or null for all. $4: 'open',
// 'closed', or 'all'.
const FILTER = `($1::text IS NULL
    OR EXISTS (
      SELECT 1
      FROM endeavor.conversation_members m
      WHERE m.conversation_id = c.id
        AND m.participant_type = $1
        AND m.participant_id = $2
        AND m.removed_at IS NULL
    ))
  AND ($3::uuid IS NULL OR c.project_id = $3)
  AND ($4 = 'all' OR (c.closed_at IS NULL) = ($4 = 'open'))`;

function filterValues(input: ConversationFilter): unknown[] {
  return [
    input.participant?.type ?? null,
    input.participant?.id ?? null,
    input.projectId,
    input.state
  ];
}

export class ConversationPostgresRepository implements ConversationRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: {
    title: string;
    projectId: string | null;
    goal: string | null;
    doneCriteria: string | null;
    createdByHumanId: string;
  }): Promise<Conversation> {
    const result = await this.db.query<ConversationRow>(
      `INSERT INTO endeavor.conversations (
         id, title, project_id, goal, done_criteria, created_by_human_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        input.title,
        input.projectId,
        input.goal,
        input.doneCriteria,
        input.createdByHumanId
      ]
    );

    return toConversation(result.rows[0]);
  }

  async update(
    conversationId: string,
    changes: { title?: string; budgetUsd?: number | null; goal?: string; doneCriteria?: string }
  ): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `UPDATE endeavor.conversations
       SET title = coalesce($2, title),
           budget_usd = CASE WHEN $3 THEN $4 ELSE budget_usd END,
           goal = coalesce($5, goal),
           done_criteria = coalesce($6, done_criteria)
       WHERE id = $1
       RETURNING *`,
      [
        conversationId,
        changes.title ?? null,
        changes.budgetUsd !== undefined,
        changes.budgetUsd ?? null,
        changes.goal ?? null,
        changes.doneCriteria ?? null
      ]
    );
    return result.rows[0] ? toConversation(result.rows[0]) : null;
  }

  async setGoalIfEmpty(
    conversationId: string,
    input: { goal: string; goalMessageId: string; doneCriteria: string }
  ): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `UPDATE endeavor.conversations
       SET goal = $2,
           goal_message_id = $3,
           done_criteria = coalesce(done_criteria, $4)
       WHERE id = $1
         AND goal IS NULL
       RETURNING *`,
      [conversationId, input.goal, input.goalMessageId, input.doneCriteria]
    );
    return result.rows[0] ? toConversation(result.rows[0]) : null;
  }

  async setClosed(
    conversationId: string,
    closedByHumanId: string | null
  ): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `UPDATE endeavor.conversations
       SET closed_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE coalesce(closed_at, now()) END,
           closed_by_human_id = CASE
             WHEN $2::uuid IS NULL THEN NULL
             ELSE coalesce(closed_by_human_id, $2)
           END
       WHERE id = $1
       RETURNING *`,
      [conversationId, closedByHumanId]
    );
    return result.rows[0] ? toConversation(result.rows[0]) : null;
  }

  async getById(conversationId: string): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `SELECT *
       FROM endeavor.conversations
       WHERE id = $1`,
      [conversationId]
    );

    return result.rows[0] ? toConversation(result.rows[0]) : null;
  }

  async list(
    input: ConversationFilter & { limit: number; offset: number }
  ): Promise<Conversation[]> {
    const result = await this.db.query<ConversationRow>(
      `SELECT c.*
       FROM endeavor.conversations c
       WHERE ${FILTER}
       ORDER BY c.created_at DESC, c.id
       LIMIT $5 OFFSET $6`,
      [...filterValues(input), input.limit, input.offset]
    );

    return result.rows.map(toConversation);
  }

  async count(input: ConversationFilter): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.conversations c
       WHERE ${FILTER}`,
      filterValues(input)
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
      `INSERT INTO endeavor.conversation_members (
         conversation_id, participant_type, participant_id, added_by_human_id, history_from
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, participant_type, participant_id) DO UPDATE
       SET removed_at = NULL,
           added_by_human_id = EXCLUDED.added_by_human_id,
           history_from = EXCLUDED.history_from,
           added_at = now()
       WHERE conversation_members.removed_at IS NOT NULL`,
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
       FROM endeavor.conversation_members
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
       FROM endeavor.conversation_members
       WHERE conversation_id = $1
         AND participant_type = $2
         AND participant_id = $3
         AND removed_at IS NULL`,
      [conversationId, participant.type, participant.id]
    );

    return result.rows[0] ? toMember(result.rows[0]) : null;
  }

  async markRead(input: {
    conversationId: string;
    humanId: string;
    messageId: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO endeavor.conversation_reads (
         conversation_id, human_id, last_read_message_id, last_read_at
       )
       SELECT m.conversation_id, $2, m.id, m.created_at
       FROM endeavor.messages m
       WHERE m.id = $3
         AND m.conversation_id = $1
       ON CONFLICT (conversation_id, human_id) DO UPDATE
       SET last_read_message_id = EXCLUDED.last_read_message_id,
           last_read_at = EXCLUDED.last_read_at,
           updated_at = now()
       WHERE (conversation_reads.last_read_at, conversation_reads.last_read_message_id)
           < (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)`,
      [input.conversationId, input.humanId, input.messageId]
    );
  }

  async countUnread(input: {
    humanId: string;
    conversationIds: string[];
  }): Promise<Map<string, number>> {
    if (input.conversationIds.length === 0) {
      return new Map();
    }
    const result = await this.db.query<{ conversation_id: string; unread: number }>(
      `SELECT m.conversation_id, count(*)::int AS unread
       FROM endeavor.messages m
       JOIN endeavor.conversation_members cm
         ON cm.conversation_id = m.conversation_id
        AND cm.participant_type = 'human'
        AND cm.participant_id = $1
        AND cm.removed_at IS NULL
       LEFT JOIN endeavor.conversation_reads r
         ON r.conversation_id = m.conversation_id
        AND r.human_id = $1
       WHERE m.conversation_id = ANY($2::uuid[])
         AND NOT (m.author_type = 'human' AND m.author_id IS NOT DISTINCT FROM $1)
         AND (cm.history_from IS NULL OR m.created_at >= cm.history_from)
         AND (
           r.conversation_id IS NULL
           OR (m.created_at, m.id) > (r.last_read_at, r.last_read_message_id)
         )
       GROUP BY m.conversation_id`,
      [input.humanId, input.conversationIds]
    );

    return new Map(result.rows.map((row) => [row.conversation_id, row.unread]));
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    goal: row.goal,
    goalMessageId: row.goal_message_id,
    doneCriteria: row.done_criteria,
    state: row.closed_at ? 'closed' : 'open',
    closedAt: row.closed_at,
    closedByHumanId: row.closed_by_human_id,
    createdByHumanId: row.created_by_human_id,
    budgetUsd: row.budget_usd === null ? null : Number(row.budget_usd),
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
