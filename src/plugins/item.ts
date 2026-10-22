import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import { ItemPostgresRepository } from '../data';
import { WebhookHttpClient } from '../integrations';
import { ItemLogger } from '../observability';
import { ItemService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    itemService: ItemService;
  }
}

// Builds the item service with its repository, webhook client, and logger. Only the service is
// attached to Fastify: repositories and integrations are used by services and nothing else.
const itemPlugin: FastifyPluginAsync = async (fastify) => {
  const itemRepository = new ItemPostgresRepository(fastify.pg);
  const webhookClient = new WebhookHttpClient(config.WEBHOOK_URL);
  const itemService = new ItemService(itemRepository, webhookClient, new ItemLogger(fastify.log));

  fastify.decorate('itemService', itemService);
};

export default fp(itemPlugin, {
  name: 'item',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
