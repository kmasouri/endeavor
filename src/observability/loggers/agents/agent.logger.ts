import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class AgentLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onAgentCreated(agentId: string): void {
    currentLogger(this.logger).info({ event: 'agent.created', agentId }, 'agent created');
  }

  onAgentConfigured(agentId: string, version: number, provider: string): void {
    currentLogger(this.logger).info(
      { event: 'agent.configured', agentId, version, provider },
      'agent configuration saved'
    );
  }

  onAgentDisabled(agentId: string): void {
    currentLogger(this.logger).info({ event: 'agent.disabled', agentId }, 'agent disabled');
  }

  onAgentEnabled(agentId: string): void {
    currentLogger(this.logger).info({ event: 'agent.enabled', agentId }, 'agent enabled');
  }
}
