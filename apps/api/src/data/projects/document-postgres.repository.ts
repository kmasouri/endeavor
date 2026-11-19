import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { ProjectDocument } from '../../shared/types';
import { DocumentRepository, DocumentVisibility } from './document.repository';

interface DocumentRow {
  id: string;
  project_id: string | null;
  conversation_id: string | null;
  title: string;
  content: string;
  added_by_human_id: string;
  created_at: Date;
}

export class DocumentPostgresRepository implements DocumentRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async add(input: {
    projectId: string | null;
    conversationId: string | null;
    title: string;
    content: string;
    addedByHumanId: string;
  }): Promise<ProjectDocument> {
    const result = await this.db.query<DocumentRow>(
      `INSERT INTO endeavor.project_documents (
         id, project_id, conversation_id, title, content, added_by_human_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        input.projectId,
        input.conversationId,
        input.title,
        input.content,
        input.addedByHumanId
      ]
    );
    return toDocument(result.rows[0]);
  }

  async list(
    visibility: DocumentVisibility,
    options: { limit?: number; maxChars?: number } = {}
  ): Promise<ProjectDocument[]> {
    const where =
      'projectId' in visibility
        ? 'project_id = $1 AND conversation_id IS NULL'
        : `project_id IS NOT DISTINCT FROM (SELECT project_id FROM endeavor.conversations WHERE id = $1)
           AND (conversation_id = $1 OR (conversation_id IS NULL AND project_id IS NOT NULL))`;
    const result = await this.db.query<DocumentRow>(
      `SELECT id, project_id, conversation_id, title, added_by_human_id, created_at,
              CASE WHEN $3::int IS NULL THEN content ELSE left(content, $3::int) END AS content
       FROM endeavor.project_documents
       WHERE ${where}
         AND deleted_at IS NULL
       ORDER BY created_at DESC, id
       LIMIT $2`,
      [
        'projectId' in visibility ? visibility.projectId : visibility.conversationId,
        options.limit ?? 500,
        options.maxChars ?? null
      ]
    );
    return result.rows.map(toDocument);
  }

  async get(documentId: string): Promise<ProjectDocument | null> {
    const result = await this.db.query<DocumentRow>(
      `SELECT * FROM endeavor.project_documents WHERE id = $1 AND deleted_at IS NULL`,
      [documentId]
    );
    return result.rows[0] ? toDocument(result.rows[0]) : null;
  }

  async delete(documentId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE endeavor.project_documents
       SET deleted_at = now()
       WHERE id = $1
         AND deleted_at IS NULL`,
      [documentId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function toDocument(row: DocumentRow): ProjectDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    title: row.title,
    content: row.content,
    addedByHumanId: row.added_by_human_id,
    createdAt: row.created_at
  };
}
