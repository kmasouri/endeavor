import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class ConnectionLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onConnectionAuthentication(connectionId: string, status: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.connection.authentication', connectionId, status },
      'connection authentication changed'
    );
  }

  onConnectionSaved(connectionId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'catalog.connection.saved', connectionId },
      'connection saved'
    );
  }
}
