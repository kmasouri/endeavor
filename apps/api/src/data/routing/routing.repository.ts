import { RoutingRecord, RoutingMessageInput } from '../../shared/routing';

export interface RoutingSave {
  status: RoutingRecord['status'];
  selectedAgentId: string | null;
  outcome: string;
  reason: string;
  confidence: number;
  candidates: RoutingRecord['candidates'];
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface RoutingRepository {
  delivery(messageId: string): Promise<{ taskId: string | null } | null>;
  discoverFinished(): Promise<void>;
  claim(token: string, leaseMs: number): Promise<RoutingRecord | null>;
  get(id: string): Promise<RoutingRecord | null>;
  count(conversationId: string, since: Date | null): Promise<number>;
  list(
    conversationId: string,
    since: Date | null,
    limit: number,
    offset: number
  ): Promise<RoutingRecord[]>;
  taskMessages(taskId: string): Promise<{ messageId: string; delivered: boolean }[]>;
  // Locks the decision and conversation, checks revision/lease and atomically saves the
  // decision, its visible note and any delivery. A changed source returns false.
  save(
    id: string,
    revision: number,
    input: RoutingSave,
    options: {
      token?: string;
      actorId?: string;
      cancelTask?: { id: string; state: string };
      message: RoutingMessageInput | null;
      deliveryMessageId: string | null;
    }
  ): Promise<boolean>;
}
