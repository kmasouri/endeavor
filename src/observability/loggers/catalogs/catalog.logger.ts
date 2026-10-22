import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class CatalogLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onSkillSaved(skillId: string, version: number): void {
    currentLogger(this.logger).info(
      { event: 'catalog.skill.saved', skillId, version },
      'skill saved'
    );
  }

  onConnectionSaved(connectionId: string): void {
    currentLogger(this.logger).info(
      { event: 'catalog.connection.saved', connectionId },
      'connection saved'
    );
  }

  onGranted(agentId: string, targetType: string, targetId: string): void {
    currentLogger(this.logger).info(
      { event: 'catalog.grant.added', agentId, targetType, targetId },
      'access granted'
    );
  }

  onRevoked(agentId: string, targetType: string, targetId: string): void {
    currentLogger(this.logger).info(
      { event: 'catalog.grant.revoked', agentId, targetType, targetId },
      'access revoked'
    );
  }
}
