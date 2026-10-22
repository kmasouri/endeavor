import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Actor, ActorType, AgentNote, ConversationDocument, NoteScope } from '../../shared/types';
import { NoteRepository } from './note.repository';

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

interface DocumentRow {
  id: string;
  conversation_id: string;
  title: string;
  content: string;
  added_by_human_id: string;
  created_at: Date;
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
  }): Promise<AgentNote> {
    const result = await this.db.query<NoteRow>(
      `INSERT INTO bold_cedar_007.agent_notes (
         id, agent_id, body, source_task_id, source_conversation_id, scope, created_by_type,
         created_by_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        randomUUID(),
        input.agentId,
        input.body,
        input.sourceTaskId,
        input.sourceConversationId,
        input.scope,
        input.createdBy.type,
        input.createdBy.id
      ]
    );
    return toNote(result.rows[0]);
  }

  async getById(noteId: string): Promise<AgentNote | null> {
    const result = await this.db.query<NoteRow>(
      `SELECT * FROM bold_cedar_007.agent_notes WHERE id = $1 AND deleted_at IS NULL`,
      [noteId]
    );
    return result.rows[0] ? toNote(result.rows[0]) : null;
  }

  async list(input: {
    agentId: string;
    conversationIds: string[] | 'all';
    limit: number;
    offset: number;
  }): Promise<AgentNote[]> {
    const all = input.conversationIds === 'all';
    const result = await this.db.query<NoteRow>(
      `SELECT *
       FROM bold_cedar_007.agent_notes
       WHERE agent_id = $1
         AND deleted_at IS NULL
         AND ($2::boolean OR scope = 'agent' OR source_conversation_id = ANY($3::uuid[]))
       ORDER BY created_at DESC, id
       LIMIT $4 OFFSET $5`,
      [input.agentId, all, all ? [] : input.conversationIds, input.limit, input.offset]
    );
    return result.rows.map(toNote);
  }

  async update(
    noteId: string,
    changes: { body?: string; scope?: NoteScope },
    humanId: string
  ): Promise<AgentNote | null> {
    const result = await this.db.query<NoteRow>(
      `UPDATE bold_cedar_007.agent_notes
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
      `UPDATE bold_cedar_007.agent_notes
       SET deleted_at = now(), deleted_by_human_id = $2
       WHERE id = $1
         AND deleted_at IS NULL`,
      [noteId, humanId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addDocument(input: {
    conversationId: string;
    title: string;
    content: string;
    addedByHumanId: string;
  }): Promise<ConversationDocument> {
    const result = await this.db.query<DocumentRow>(
      `INSERT INTO bold_cedar_007.conversation_documents (
         id, conversation_id, title, content, added_by_human_id
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [randomUUID(), input.conversationId, input.title, input.content, input.addedByHumanId]
    );
    return toDocument(result.rows[0]);
  }

  async listDocuments(conversationId: string): Promise<ConversationDocument[]> {
    const result = await this.db.query<DocumentRow>(
      `SELECT *
       FROM bold_cedar_007.conversation_documents
       WHERE conversation_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at, id`,
      [conversationId]
    );
    return result.rows.map(toDocument);
  }

  async getDocument(documentId: string): Promise<ConversationDocument | null> {
    const result = await this.db.query<DocumentRow>(
      `SELECT * FROM bold_cedar_007.conversation_documents WHERE id = $1 AND deleted_at IS NULL`,
      [documentId]
    );
    return result.rows[0] ? toDocument(result.rows[0]) : null;
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE bold_cedar_007.conversation_documents
       SET deleted_at = now()
       WHERE id = $1
         AND deleted_at IS NULL`,
      [documentId]
    );
    return (result.rowCount ?? 0) > 0;
  }
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

function toDocument(row: DocumentRow): ConversationDocument {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    content: row.content,
    addedByHumanId: row.added_by_human_id,
    createdAt: row.created_at
  };
}
