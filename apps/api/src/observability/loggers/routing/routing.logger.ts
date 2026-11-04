import { FastifyBaseLogger } from 'fastify';
export class RoutingLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}
  onDecision(id: string, outcome: string, confidence: number, model: string | null): void {
    this.logger.info(
      { event: 'routing.decided', id, outcome, confidence, model },
      'routing decided'
    );
  }
  onFailure(id: string | null, error: unknown): void {
    this.logger.error({ event: 'routing.failed', id, err: error }, 'routing failed');
  }
}
