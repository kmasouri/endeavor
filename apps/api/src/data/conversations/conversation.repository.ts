import {
  Conversation,
  ConversationMember,
  EndeavorState,
  ParticipantRef
} from '../../shared/types';

// Which conversations a list returns. participant: only ones they belong to (null for all).
// projectId: only that project's (null for all). state: open, closed, or both.
export interface ConversationFilter {
  participant: ParticipantRef | null;
  projectId: string | null;
  state: EndeavorState | 'all';
}

export interface ConversationRepository {
  create(input: {
    title: string;
    projectId: string | null;
    goal: string | null;
    doneCriteria: string | null;
    createdByHumanId: string;
  }): Promise<Conversation>;
  getById(conversationId: string): Promise<Conversation | null>;
  // budgetUsd: a number sets the cap, null removes it, undefined leaves it.
  update(
    conversationId: string,
    changes: { title?: string; budgetUsd?: number | null; goal?: string; doneCriteria?: string }
  ): Promise<Conversation | null>;
  // Sets the goal only if the conversation has none yet, and the done criteria only if they are
  // empty. Returns null when a goal was already set, so two first messages can't both win.
  setGoalIfEmpty(
    conversationId: string,
    input: { goal: string; goalMessageId: string; doneCriteria: string }
  ): Promise<Conversation | null>;
  // A person closes the conversation; null reopens it. Closing again keeps the first close.
  setClosed(conversationId: string, closedByHumanId: string | null): Promise<Conversation | null>;
  // Newest first.
  list(input: ConversationFilter & { limit: number; offset: number }): Promise<Conversation[]>;
  count(input: ConversationFilter): Promise<number>;

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
