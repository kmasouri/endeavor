import { ActorType, Message, MessageDelivery, ParticipantRef } from '../../shared/types';

export interface CreateMessageInput {
  conversationId: string;
  authorType: ActorType;
  authorId: string | null;
  body: string;
  mentions: ParticipantRef[];
  inReplyToMessageId: string | null;
  taskId: string | null;
  // The agents to deliver the message to. The service decides who; this only saves it.
  deliverToAgentIds: string[];
  // Saving again with the same key returns the first message instead of a copy.
  clientKey: string | null;
}

export interface MessageRepository {
  create(input: CreateMessageInput): Promise<{ message: Message; created: boolean }>;
  getById(messageId: string): Promise<Message | null>;
  // Oldest first. since hides older messages, for members who can't see the whole history.
  list(
    conversationId: string,
    options: { since: Date | null; limit: number; offset: number }
  ): Promise<Message[]>;
  // The newest messages, returned oldest first, for building an agent's context.
  listRecent(
    conversationId: string,
    options: { since: Date | null; limit: number }
  ): Promise<Message[]>;

  listPendingDeliveries(limit: number): Promise<MessageDelivery[]>;
  markDelivered(messageId: string, agentId: string, taskId: string | null): Promise<void>;
}
