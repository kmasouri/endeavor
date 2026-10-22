import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  AgentPostgresRepository,
  ConversationPostgresRepository,
  HumanPostgresRepository,
  MessagePostgresRepository
} from '../data';
import { ConversationLogger } from '../observability';
import { ConversationService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    conversationService: ConversationService;
  }
}

const conversationPlugin: FastifyPluginAsync = async (fastify) => {
  const conversationService = new ConversationService(
    new ConversationPostgresRepository(fastify.pg),
    new MessagePostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new ConversationLogger(fastify.log)
  );

  fastify.decorate('conversationService', conversationService);
};

export default fp(conversationPlugin, {
  name: 'conversation',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
