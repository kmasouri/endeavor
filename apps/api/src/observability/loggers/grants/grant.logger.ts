import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class GrantLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onGranted(agentId: string, targetType: string, targetId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.grant.added', agentId, targetType, targetId },
      'access granted'
    );
  }

  onRevoked(agentId: string, targetType: string, targetId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.grant.revoked', agentId, targetType, targetId },
      'access revoked'
    );
  }
}
