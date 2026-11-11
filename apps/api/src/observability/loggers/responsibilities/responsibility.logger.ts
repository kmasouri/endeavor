import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class ResponsibilityLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onResponsibilityCreated(responsibilityId: string, agentId: string | null): void {
    getCurrentLogger(this.logger).info(
      { event: 'responsibility.created', responsibilityId, agentId },
      'responsibility created'
    );
  }

  onCatchUpResolved(responsibilityId: string, decision: 'run' | 'wait'): void {
    getCurrentLogger(this.logger).info(
      { event: 'responsibility.catchup.resolved', responsibilityId, decision },
      'missed-run question answered'
    );
  }

  onResponsibilityStatusChanged(responsibilityId: string, status: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'responsibility.status.changed', responsibilityId, status },
      'responsibility status changed'
    );
  }
}
