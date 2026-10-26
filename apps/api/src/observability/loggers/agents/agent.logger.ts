import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class AgentLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onAgentDeleted(agentId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'agent.deleted', agentId },
      'agent permanently deleted'
    );
  }

  onAgentCreated(agentId: string): void {
    getCurrentLogger(this.logger).info({ event: 'agent.created', agentId }, 'agent created');
  }

  onAgentConfigured(agentId: string, version: number, provider: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'agent.configured', agentId, version, provider },
      'agent configuration saved'
    );
  }

  onAgentDisabled(agentId: string): void {
    getCurrentLogger(this.logger).info({ event: 'agent.disabled', agentId }, 'agent disabled');
  }

  onAgentEnabled(agentId: string): void {
    getCurrentLogger(this.logger).info({ event: 'agent.enabled', agentId }, 'agent enabled');
  }
}
