import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class TaskRunnerLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onMessageDelivered(
    messageId: string,
    agentId: string,
    taskId: string,
    kind: 'new_task' | 'update'
  ): void {
    currentLogger(this.logger).info(
      { event: 'runner.message.delivered', messageId, agentId, taskId, kind },
      'message delivered to agent'
    );
  }

  onDeliveryFailed(messageId: string, agentId: string, error: unknown): void {
    currentLogger(this.logger).error(
      { event: 'runner.delivery.failed', messageId, agentId, err: error },
      'message delivery failed'
    );
  }

  onRequestChainTooDeep(messageId: string, agentId: string): void {
    currentLogger(this.logger).warn(
      { event: 'runner.request.too_deep', messageId, agentId },
      'agent request chain too deep; no new task started'
    );
  }

  onParticipantSuggested(taskId: string, suggestedAgentId: string): void {
    currentLogger(this.logger).info(
      { event: 'runner.participant.suggested', taskId, suggestedAgentId },
      'agent suggested adding a participant'
    );
  }

  onConnectionDenied(
    taskId: string,
    connection: string,
    method: string,
    path: string,
    reason: string
  ): void {
    currentLogger(this.logger).warn(
      { event: 'runner.connection.denied', taskId, connection, method, path, reason },
      'connection call refused'
    );
  }

  onApprovalRequested(taskId: string, approvalId: string): void {
    currentLogger(this.logger).info(
      { event: 'runner.approval.requested', taskId, approvalId },
      'agent call waits for approval'
    );
  }

  onScheduledRun(responsibilityId: string, taskId: string | null, skippedSlots: number): void {
    currentLogger(this.logger).info(
      { event: 'runner.schedule.run', responsibilityId, taskId, skippedSlots },
      taskId ? 'scheduled run started' : 'scheduled run skipped'
    );
  }

  onCompletionChecked(taskId: string, met: boolean): void {
    currentLogger(this.logger).info(
      { event: 'runner.completion.checked', taskId, met },
      met ? 'completion check passed' : 'completion check found gaps'
    );
  }

  onScheduledRunFailed(responsibilityId: string, error: unknown): void {
    currentLogger(this.logger).error(
      { event: 'runner.schedule.failed', responsibilityId, err: error },
      'scheduled run failed'
    );
  }

  onScheduledRunSkipped(responsibilityId: string, reason: string): void {
    currentLogger(this.logger).warn(
      { event: 'runner.schedule.skipped', responsibilityId, reason },
      'scheduled run not started'
    );
  }

  onModelTurn(
    taskId: string,
    provider: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number }
  ): void {
    currentLogger(this.logger).info(
      { event: 'runner.model.turn', taskId, provider, model, ...usage },
      'model turn finished'
    );
  }

  onModelFailed(taskId: string, provider: string, retryable: boolean, message: string): void {
    currentLogger(this.logger).warn(
      { event: 'runner.model.failed', taskId, provider, retryable, message },
      'model call failed'
    );
  }

  onTaskRunFailed(taskId: string, error: unknown): void {
    currentLogger(this.logger).error(
      { event: 'runner.task.failed', taskId, err: error },
      'task run failed'
    );
  }

  onTickFailed(error: unknown): void {
    currentLogger(this.logger).error(
      { event: 'runner.tick.failed', err: error },
      'runner tick failed'
    );
  }
}
