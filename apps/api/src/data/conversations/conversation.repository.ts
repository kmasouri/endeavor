import { Conversation, ConversationMember, ParticipantRef } from '../../shared/types';

export interface ConversationRepository {
  create(input: { title: string; createdByHumanId: string }): Promise<Conversation>;
  getById(conversationId: string): Promise<Conversation | null>;
  // budgetUsd: a number sets the cap, null removes it, undefined leaves it.
  update(
    conversationId: string,
    changes: { title?: string; budgetUsd?: number | null }
  ): Promise<Conversation | null>;
  // Conversations the participant belongs to, or all of them when participant is null.
  list(input: {
    participant: ParticipantRef | null;
    limit: number;
    offset: number;
  }): Promise<Conversation[]>;
  count(input: { participant: ParticipantRef | null }): Promise<number>;

  // Adds the member, or returns the existing membership unchanged. A removed member is added
  // back as new.
  addMember(input: {
    conversationId: string;
    participant: ParticipantRef;
    addedByHumanId: string | null;
    historyFrom: Date | null;
  }): Promise<ConversationMember>;
  listMembers(conversationId: string): Promise<ConversationMember[]>;
  getMember(
    conversationId: string,
    participant: ParticipantRef
  ): Promise<ConversationMember | null>;

  // Records that the person has seen the conversation up to this message. Never moves back to
  // an older message. The message must belong to the conversation.
  markRead(input: { conversationId: string; humanId: string; messageId: string }): Promise<void>;
  // Unread messages per conversation for a person: messages after the last one they saw,
  // written by someone else, that they are allowed to see. Only conversations they belong to
  // are counted; the rest are left out of the result.
  countUnread(input: { humanId: string; conversationIds: string[] }): Promise<Map<string, number>>;
}
