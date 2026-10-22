import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import { AgentPostgresRepository, HumanPostgresRepository } from '../data';
import { AgentLogger } from '../observability';
import { AgentService } from '../services';
import { ModelProvider } from '../shared/types';

declare module 'fastify' {
  interface FastifyInstance {
    agentService: AgentService;
  }
}

// A provider is ready when its API key is set. The scripted provider needs no key.
export function readyProviders(settings: typeof config): ModelProvider[] {
  return [
    ...(settings.ANTHROPIC_API_KEY ? (['anthropic'] as const) : []),
    ...(settings.OPENAI_API_KEY ? (['openai'] as const) : []),
    'scripted'
  ];
}

const agentPlugin: FastifyPluginAsync = async (fastify) => {
  const agentService = new AgentService(
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    readyProviders(config),
    new AgentLogger(fastify.log)
  );

  fastify.decorate('agentService', agentService);
};

export default fp(agentPlugin, {
  name: 'agent',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
