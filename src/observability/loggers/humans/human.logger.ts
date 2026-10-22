import { FastifyBaseLogger } from 'fastify';
import { HumanRole } from '../../../shared/types';
import { currentLogger } from '../request-logger';

export class HumanLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onHumanCreated(humanId: string, role: HumanRole): void {
    currentLogger(this.logger).info({ event: 'human.created', humanId, role }, 'human created');
  }
}
