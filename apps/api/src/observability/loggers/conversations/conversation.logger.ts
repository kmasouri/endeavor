import { FastifyBaseLogger } from 'fastify';
import { getCurrentLogger } from '../request-logger';

export class ConversationLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onConversationCreated(conversationId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.created', conversationId },
      'conversation created'
    );
  }

  onMemberAdded(conversationId: string, participantType: string, participantId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.member.added', conversationId, participantType, participantId },
      'conversation member added'
    );
  }

  onDocumentAdded(documentId: string, conversationId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.document.added', documentId, conversationId },
      'document added'
    );
  }

  onMessagePosted(conversationId: string, messageId: string, addressedAgents: number): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.message.posted', conversationId, messageId, addressedAgents },
      'message posted'
    );
  }

  onGoalSet(conversationId: string, messageId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.goal.set', conversationId, messageId },
      'endeavor goal set'
    );
  }

  onConversationClosed(conversationId: string, humanId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.closed', conversationId, humanId },
      'endeavor closed'
    );
  }

  onConversationReopened(conversationId: string, humanId: string): void {
    getCurrentLogger(this.logger).info(
      { event: 'conversation.reopened', conversationId, humanId },
      'endeavor reopened'
    );
  }
}
