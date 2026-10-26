import { FastifyBaseLogger } from 'fastify';
import { HumanRole } from '../../../shared/types';
import { getCurrentLogger } from '../request-logger';

export class HumanLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onHumanUpdated(humanId: string): void {
    getCurrentLogger(this.logger).info({ event: 'human.updated', humanId }, 'human updated');
  }

  onHumanCreated(humanId: string, role: HumanRole): void {
    getCurrentLogger(this.logger).info({ event: 'human.created', humanId, role }, 'human created');
  }
}
