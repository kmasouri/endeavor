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

  onAgentDisabledChanged(agentId: string, disabled: boolean): void {
    currentLogger(this.logger).info(
      { event: disabled ? 'agent.disabled' : 'agent.enabled', agentId },
      disabled ? 'agent disabled' : 'agent enabled'
    );
  }
}
