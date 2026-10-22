import { FastifyBaseLogger } from 'fastify';
import { currentLogger } from '../request-logger';

export class ConversationLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onConversationCreated(conversationId: string): void {
    currentLogger(this.logger).info(
      { event: 'conversation.created', conversationId },
      'conversation created'
    );
  }

  onMemberAdded(conversationId: string, participantType: string, participantId: string): void {
    currentLogger(this.logger).info(
      { event: 'conversation.member.added', conversationId, participantType, participantId },
      'conversation member added'
    );
  }

  onDocumentAdded(documentId: string, conversationId: string): void {
    currentLogger(this.logger).info(
      { event: 'conversation.document.added', documentId, conversationId },
      'document added'
    );
  }

  onMessagePosted(conversationId: string, messageId: string, addressedAgents: number): void {
    currentLogger(this.logger).info(
      { event: 'conversation.message.posted', conversationId, messageId, addressedAgents },
      'message posted'
    );
  }
}
