import { Actor, AgentNote, ConversationDocument, NoteScope } from '../../shared/types';

export interface NoteRepository {
  create(input: {
    agentId: string;
    body: string;
    sourceTaskId: string | null;
    sourceConversationId: string | null;
    scope: NoteScope;
    createdBy: Actor;
  }): Promise<AgentNote>;
  getById(noteId: string): Promise<AgentNote | null>;
  // Notes that aren't deleted, newest first. conversationIds limits conversation-scoped notes
  // to those conversations; agent-scoped notes are always included.
  list(input: {
    agentId: string;
    conversationIds: string[] | 'all';
    limit: number;
    offset: number;
  }): Promise<AgentNote[]>;
  update(
    noteId: string,
    changes: { body?: string; scope?: NoteScope },
    humanId: string
  ): Promise<AgentNote | null>;
  softDelete(noteId: string, humanId: string): Promise<boolean>;

  addDocument(input: {
    conversationId: string;
    title: string;
    content: string;
    addedByHumanId: string;
  }): Promise<ConversationDocument>;
  listDocuments(conversationId: string): Promise<ConversationDocument[]>;
  getDocument(documentId: string): Promise<ConversationDocument | null>;
  deleteDocument(documentId: string): Promise<boolean>;
}
