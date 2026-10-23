import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import {
  AgentPostgresRepository,
  CatalogPostgresRepository,
  CredentialCipher,
  HumanPostgresRepository
} from '../data';
import { CatalogLogger } from '../observability';
import { CatalogService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    catalogService: CatalogService;
  }
}

const catalogPlugin: FastifyPluginAsync = async (fastify) => {
  const cipher = new CredentialCipher(config.CREDENTIALS_KEY);
  const catalogService = new CatalogService(
    new CatalogPostgresRepository(fastify.pg, cipher),
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    cipher.ready,
    new CatalogLogger(fastify.log)
  );

  fastify.decorate('catalogService', catalogService);
};

export default fp(catalogPlugin, {
  name: 'catalog',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
