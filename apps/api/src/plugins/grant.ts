import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import {
  CatalogPostgresRepository,
  CredentialCipher,
  HumanPostgresRepository,
  AgentPostgresRepository
} from '../data';
import { GrantLogger } from '../observability';
import { GrantService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    grantService: GrantService;
  }
}

const grantPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new CatalogPostgresRepository(
    fastify.pg,
    new CredentialCipher(config.CREDENTIALS_KEY)
  );
  fastify.decorate(
    'grantService',
    new GrantService(
      repository,
      repository,
      repository,
      new AgentPostgresRepository(fastify.pg),
      new HumanPostgresRepository(fastify.pg),
      new GrantLogger(fastify.log)
    )
  );
};

export default fp(grantPlugin, {
  name: 'grant',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
