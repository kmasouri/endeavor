import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Actor, ActorType, AgentNote, NoteScope } from '../../shared/types';
import { NoteRepository, NoteVisibility } from './note.repository';

interface NoteRow {
  id: string;
  agent_id: string;
  body: string;
  source_task_id: string | null;
  source_conversation_id: string | null;
  scope: NoteScope;
  created_by_type: ActorType;
  created_by_id: string | null;
  updated_by_human_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class NotePostgresRepository implements NoteRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: {
    agentId: string;
    body: string;
    sourceTaskId: string | null;
    sourceConversationId: string | null;
    scope: NoteScope;
    createdBy: Actor;
    clientKey: string | null;
  }): Promise<AgentNote> {
    const result = await this.db.query<NoteRow>(
      `INSERT INTO endeavor.agent_notes (
         id, agent_id, body, source_task_id, source_conversation_id, scope, created_by_type,
         created_by_id, client_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (client_key) WHERE client_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        input.agentId,
        input.body,
        input.sourceTaskId,
        input.sourceConversationId,
        input.scope,
        input.createdBy.type,
        input.createdBy.id,
        input.clientKey
      ]
    );
    if (result.rows[0]) {
      return toNote(result.rows[0]);
    }
    const existing = await this.db.query<NoteRow>(
      `SELECT * FROM endeavor.agent_notes WHERE client_key = $1`,
      [input.clientKey]
    );
    return toNote(existing.rows[0]);
  }

  async getById(noteId: string): Promise<AgentNote | null> {
    const result = await this.db.query<NoteRow>(
      `SELECT * FROM endeavor.agent_notes WHERE id = $1 AND deleted_at IS NULL`,
      [noteId]
    );
    return result.rows[0] ? toNote(result.rows[0]) : null;
  }

  async list(input: {
    agentId: string;
    visibility: NoteVisibility;
    limit: number;
    offset: number;
  }): Promise<AgentNote[]> {
    const { where, values } = visibilityFilter(input.agentId, input.visibility);
    const result = await this.db.query<NoteRow>(
      `SELECT *
       FROM endeavor.agent_notes
       WHERE ${where}
       ORDER BY created_at DESC, id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.offset]
    );
    return result.rows.map(toNote);
  }

  async count(input: { agentId: string; visibility: NoteVisibility }): Promise<number> {
    const { where, values } = visibilityFilter(input.agentId, input.visibility);
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM endeavor.agent_notes WHERE ${where}`,
      values
    );
    return result.rows[0].total;
  }

  async update(
    noteId: string,
    changes: { body?: string; scope?: NoteScope },
    humanId: string
  ): Promise<AgentNote | null> {
    const result = await this.db.query<NoteRow>(
      `UPDATE endeavor.agent_notes
       SET body = coalesce($2, body),
           scope = coalesce($3, scope),
           updated_by_human_id = $4,
           updated_at = now()
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING *`,
      [noteId, changes.body ?? null, changes.scope ?? null, humanId]
    );
    return result.rows[0] ? toNote(result.rows[0]) : null;
  }

  async softDelete(noteId: string, humanId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE endeavor.agent_notes
       SET deleted_at = now(), deleted_by_human_id = $2
       WHERE id = $1
         AND deleted_at IS NULL`,
      [noteId, humanId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function visibilityFilter(
  agentId: string,
  visibility: NoteVisibility
): { where: string; values: unknown[] } {
  const base = 'agent_id = $1 AND deleted_at IS NULL';
  if (visibility === 'all') {
    return { where: base, values: [agentId] };
  }
  if ('conversationId' in visibility) {
    return {
      where: `${base} AND (scope = 'agent' OR (scope = 'conversation' AND source_conversation_id = $2))`,
      values: [agentId, visibility.conversationId]
    };
  }
  return {
    where: `${base} AND (scope = 'agent' OR (scope = 'conversation' AND source_conversation_id IN (
      SELECT conversation_id
      FROM endeavor.conversation_members
      WHERE participant_type = 'human' AND participant_id = $2 AND removed_at IS NULL
    )))`,
    values: [agentId, visibility.visibleToHumanId]
  };
}

function toNote(row: NoteRow): AgentNote {
  return {
    id: row.id,
    agentId: row.agent_id,
    body: row.body,
    sourceTaskId: row.source_task_id,
    sourceConversationId: row.source_conversation_id,
    scope: row.scope,
    createdBy: { type: row.created_by_type, id: row.created_by_id },
    updatedByHumanId: row.updated_by_human_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
