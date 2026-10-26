import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class CatalogLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onSkillDiscoveryChanged(skillId: string, discoverable: boolean): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.skill.discovery_changed', skillId, discoverable },
      'skill discovery changed'
    );
  }

  onSkillSaved(skillId: string, version: number): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.skill.saved', skillId, version },
      'skill saved'
    );
  }

  onConnectionSaved(connectionId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.connection.saved', connectionId },
      'connection saved'
    );
  }

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
