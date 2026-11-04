import { ActorType, ParticipantRef } from './types';
export interface RoutingRecord {
  id: string;
  conversationId: string;
  messageId: string | null;
  taskId: string | null;
  kind: 'starter' | 'handoff';
  status: 'pending' | 'waiting' | 'resolved' | 'skipped';
  selectedAgentId: string | null;
  outcome: string | null;
  reason: string;
  confidence: number;
  candidates: { id: string; name: string }[];
  revision: number;
  deliveryMessageId: string | null;
  createdAt: Date;
}

export interface RoutingMessageInput {
  conversationId: string;
  authorType: ActorType;
  authorId: string | null;
  body: string;
  mentions: ParticipantRef[];
  inReplyToMessageId: string | null;
  taskId: string | null;
  deliverToAgentIds: string[];
  clientKey: string | null;
}
