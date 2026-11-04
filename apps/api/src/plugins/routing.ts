import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import {
  AgentPostgresRepository,
  ConversationPostgresRepository,
  HumanPostgresRepository,
  MessagePostgresRepository,
  RoutingPostgresRepository,
  TaskPostgresRepository
} from '../data';
import { createOpenAiDecisionModel, RoutingDecisionModelClient } from '../integrations';
import { RoutingLogger } from '../observability';
import { RoutingService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    routingService: RoutingService;
  }
}
const routingPlugin: FastifyPluginAsync = async (fastify) => {
  const logger = new RoutingLogger(fastify.log);
  const service = new RoutingService(
    new RoutingPostgresRepository(fastify.pg),
    new ConversationPostgresRepository(fastify.pg),
    new MessagePostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new TaskPostgresRepository(fastify.pg),
    config.OPENAI_API_KEY
      ? new RoutingDecisionModelClient(
          createOpenAiDecisionModel(
            config.OPENAI_API_KEY,
            config.OPENAI_BASE_URL,
            config.ROUTING_MODEL
          )
        )
      : null,
    logger
  );
  fastify.decorate('routingService', service);
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let active: Promise<void> | undefined;
  const loop = async () => {
    try {
      await service.tick();
    } catch (error) {
      logger.onFailure(null, error);
    }
    if (!stopped)
      timer = setTimeout(() => {
        active = loop();
      }, config.RUNNER_INTERVAL_MS);
  };
  fastify.addHook('preClose', async () => {
    stopped = true;
    clearTimeout(timer);
    service.stop();
    await active;
  });
  if (config.RUNNER_ENABLED)
    fastify.addHook('onReady', async () => {
      timer = setTimeout(() => {
        active = loop();
      }, 0);
    });
};
export default fp(routingPlugin, { name: 'routing', dependencies: ['@fastify/postgres'] });
