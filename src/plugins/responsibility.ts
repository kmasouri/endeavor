import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  AgentPostgresRepository,
  ConversationPostgresRepository,
  HumanPostgresRepository,
  ResponsibilityPostgresRepository,
  TaskPostgresRepository
} from '../data';
import { ResponsibilityLogger, TaskLogger } from '../observability';
import { ResponsibilityService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    responsibilityService: ResponsibilityService;
  }
}

const responsibilityPlugin: FastifyPluginAsync = async (fastify) => {
  const responsibilityService = new ResponsibilityService(
    new ResponsibilityPostgresRepository(fastify.pg),
    new TaskPostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new ConversationPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new ResponsibilityLogger(fastify.log),
    new TaskLogger(fastify.log)
  );

  fastify.decorate('responsibilityService', responsibilityService);
};

export default fp(responsibilityPlugin, {
  name: 'responsibility',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
