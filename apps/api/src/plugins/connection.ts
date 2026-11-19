import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import {
  CatalogPostgresRepository,
  CredentialCipher,
  HumanPostgresRepository,
  ConnectionOAuthPostgresRepository
} from '../data';
import { ConnectionOAuthHttpClient, McpHttpClient } from '../integrations';
import { ConnectionLogger } from '../observability';
import { ConnectionService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    connectionService: ConnectionService;
  }
}

const connectionPlugin: FastifyPluginAsync = async (fastify) => {
  const cipher = new CredentialCipher(config.CREDENTIALS_KEY);
  fastify.decorate(
    'connectionService',
    new ConnectionService(
      new CatalogPostgresRepository(fastify.pg, cipher),
      new HumanPostgresRepository(fastify.pg),
      cipher.ready,
      new ConnectionLogger(fastify.log),
      new McpHttpClient(),
      new ConnectionOAuthPostgresRepository(fastify.pg, cipher),
      new ConnectionOAuthHttpClient(),
      config.APP_PUBLIC_URL
    )
  );
};

export default fp(connectionPlugin, {
  name: 'connection',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
