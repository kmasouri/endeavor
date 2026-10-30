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
  // A bounded recent, older or newer window, always returned oldest first. Cursor IDs use
  // their database timestamp and ID together so equal timestamps do not skip messages.
  listWindow(
    conversationId: string,
    options: { since: Date | null; limit: number; beforeId?: string; afterId?: string }
  ): Promise<Message[]>;
  // The newest messages, returned oldest first, for building an agent's context.
  listRecent(
    conversationId: string,
    options: { since: Date | null; limit: number }
  ): Promise<Message[]>;

  // Claims up to limit pending deliveries for leaseMs, so two runners never handle the same
  // one at once. A claim that runs out, such as after a crash, can be claimed again.
  claimDeliveries(limit: number, leaseMs: number): Promise<MessageDelivery[]>;
  markDelivered(messageId: string, agentId: string, taskId: string | null): Promise<void>;
  // Records a failed attempt. After maxAttempts the delivery is marked failed and skipped.
  recordDeliveryFailure(
    messageId: string,
    agentId: string,
    error: string,
    maxAttempts: number
  ): Promise<void>;
}
