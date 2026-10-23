import { ConversationDocument } from '../../shared/types';

// Documents people attach to a conversation as knowledge sources.
export interface DocumentRepository {
  add(input: {
    conversationId: string;
    title: string;
    content: string;
    addedByHumanId: string;
  }): Promise<ConversationDocument>;
  // Newest first. maxChars cuts each document's content in the query, so a prompt never loads
  // more than it can use.
  list(
    conversationId: string,
    options?: { limit?: number; maxChars?: number }
  ): Promise<ConversationDocument[]>;
  get(documentId: string): Promise<ConversationDocument | null>;
  delete(documentId: string): Promise<boolean>;
}
