import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class ResponsibilityLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onResponsibilityCreated(responsibilityId: string, agentId: string): void {
    currentLogger(this.logger).info(
      { event: 'responsibility.created', responsibilityId, agentId },
      'responsibility created'
    );
  }

  onResponsibilityStatusChanged(responsibilityId: string, status: string): void {
    currentLogger(this.logger).info(
      { event: 'responsibility.status.changed', responsibilityId, status },
      'responsibility status changed'
    );
  }
}
