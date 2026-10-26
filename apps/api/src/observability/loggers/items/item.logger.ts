import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class ItemLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onItemCreated(): void {
    getCurrentLogger(this.logger).info({ event: 'item.created' }, 'item created');
  }

  onItemListed(): void {
    getCurrentLogger(this.logger).info({ event: 'item.listed' }, 'items listed');
  }

  onItemFetched(): void {
    getCurrentLogger(this.logger).info({ event: 'item.fetched' }, 'item fetched');
  }

  onItemWebhookFailed(error: unknown): void {
    getCurrentLogger(this.logger).warn(
      { event: 'item.webhook.failed', err: error },
      'item webhook failed'
    );
  }
}
