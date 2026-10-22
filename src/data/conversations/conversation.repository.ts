import { Conversation, ConversationMember, ParticipantRef } from '../../shared/types';

export interface ConversationRepository {
  create(input: { title: string; createdByHumanId: string }): Promise<Conversation>;
  getById(conversationId: string): Promise<Conversation | null>;
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
}
