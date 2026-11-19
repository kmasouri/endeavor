import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class SkillLogger {
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
}
