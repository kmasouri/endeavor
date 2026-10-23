import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { HumanPostgresRepository } from '../data';
import { HumanLogger } from '../observability';
import { HumanService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    humanService: HumanService;
  }
}

const humanPlugin: FastifyPluginAsync = async (fastify) => {
  const humanService = new HumanService(
    new HumanPostgresRepository(fastify.pg),
    new HumanLogger(fastify.log)
  );

  fastify.decorate('humanService', humanService);
};

export default fp(humanPlugin, {
  name: 'human',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
