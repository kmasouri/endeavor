import { ProjectDocument } from '../../shared/types';

// Which documents a list returns: the project's shared ones ({ projectId }), or the ones an
// endeavor sees ({ conversationId }): its project's shared documents plus those limited to it.
export type DocumentVisibility = { projectId: string } | { conversationId: string };

// Documents people attach to a project as knowledge sources.
export interface DocumentRepository {
  // conversationId limits the document to that one endeavor; null shares it with the project.
  add(input: {
    projectId: string;
    conversationId: string | null;
    title: string;
    content: string;
    addedByHumanId: string;
  }): Promise<ProjectDocument>;
  // Newest first. maxChars cuts each document's content in the query, so a prompt never loads
  // more than it can use.
  list(
    visibility: DocumentVisibility,
    options?: { limit?: number; maxChars?: number }
  ): Promise<ProjectDocument[]>;
  get(documentId: string): Promise<ProjectDocument | null>;
  delete(documentId: string): Promise<boolean>;
}
