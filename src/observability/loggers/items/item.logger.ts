import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class ItemLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onItemCreated(): void {
    currentLogger(this.logger).info({ event: 'item.created' }, 'item created');
  }

  onItemListed(): void {
    currentLogger(this.logger).info({ event: 'item.listed' }, 'items listed');
  }

  onItemFetched(): void {
    currentLogger(this.logger).info({ event: 'item.fetched' }, 'item fetched');
  }

  onItemWebhookFailed(error: unknown): void {
    currentLogger(this.logger).warn(
      { event: 'item.webhook.failed', err: error },
      'item webhook failed'
    );
  }
}
