import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class NoteLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onNoteUpdated(noteId: string, agentId: string, humanId: string): void {
    currentLogger(this.logger).info(
      { event: 'note.updated', noteId, agentId, humanId },
      'note updated'
    );
  }

  onNoteDeleted(noteId: string, agentId: string, humanId: string): void {
    currentLogger(this.logger).info(
      { event: 'note.deleted', noteId, agentId, humanId },
      'note deleted'
    );
  }
}
