import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { ConversationDocument } from '../../shared/types';
import { DocumentRepository } from './document.repository';

interface DocumentRow {
  id: string;
  conversation_id: string;
  title: string;
  content: string;
  added_by_human_id: string;
  created_at: Date;
}

export class DocumentPostgresRepository implements DocumentRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async add(input: {
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

  async list(
    conversationId: string,
    options: { limit?: number; maxChars?: number } = {}
  ): Promise<ConversationDocument[]> {
    const result = await this.db.query<DocumentRow>(
      `SELECT id, conversation_id, title, added_by_human_id, created_at,
              CASE WHEN $3::int IS NULL THEN content ELSE left(content, $3::int) END AS content
       FROM bold_cedar_007.conversation_documents
       WHERE conversation_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at DESC, id
       LIMIT $2`,
      [conversationId, options.limit ?? 500, options.maxChars ?? null]
    );
    return result.rows.map(toDocument);
  }

  async get(documentId: string): Promise<ConversationDocument | null> {
    const result = await this.db.query<DocumentRow>(
      `SELECT * FROM bold_cedar_007.conversation_documents WHERE id = $1 AND deleted_at IS NULL`,
      [documentId]
    );
    return result.rows[0] ? toDocument(result.rows[0]) : null;
  }

  async delete(documentId: string): Promise<boolean> {
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
