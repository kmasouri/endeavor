import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class ProjectLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onProjectCreated(projectId: string, humanId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'project.created', projectId, humanId },
      'project created'
    );
  }

  onProjectUpdated(projectId: string, humanId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'project.updated', projectId, humanId },
      'project updated'
    );
  }

  onProjectArchived(projectId: string, humanId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'project.archived', projectId, humanId },
      'project archived'
    );
  }

  onProjectRestored(projectId: string, humanId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'project.restored', projectId, humanId },
      'project restored'
    );
  }

  onDocumentAdded(documentId: string, projectId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'project.document.added', documentId, projectId },
      'document added'
    );
  }
}
