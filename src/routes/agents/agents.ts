import { FastifyInstance } from 'fastify';
import {
  createAgentHandler,
  disableAgentHandler,
  enableAgentHandler,
  getAgentHandler,
  listAgentsHandler,
  listAgentVersionsHandler,
  listProvidersHandler,
  updateAgentConfigHandler,
  updateAgentProfileHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  agentParamsSchema,
  createAgentBodySchema,
  listAgentsQuerySchema,
  updateAgentConfigBodySchema,
  updateAgentProfileBodySchema
} from '../../schemas';

export async function agentsRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.get(
    '/providers',
    {
      schema: {
        description:
          'Model providers agents can use, and whether each is ready. Tools run on this computer, but models run on the provider.',
        tags: ['agents']
      }
    },
    listProvidersHandler
  );

  fastifyInstance.post(
    '/agents',
    {
      schema: {
        description:
          'Create an agent with its first configuration (version 1). Roles like QA or research are just configurations. Admins only.',
        tags: ['agents'],
        headers: actorHeadersSchema,
        body: createAgentBodySchema
      }
    },
    createAgentHandler
  );

  fastifyInstance.get(
    '/agents',
    {
      schema: {
        description: 'List agents by name, with their current configuration.',
        tags: ['agents'],
        querystring: listAgentsQuerySchema
      }
    },
    listAgentsHandler
  );

  fastifyInstance.get(
    '/agents/:agentId',
    {
      schema: {
        description: 'Get an agent with its current configuration.',
        tags: ['agents'],
        params: agentParamsSchema
      }
    },
    getAgentHandler
  );

  fastifyInstance.get(
    '/agents/:agentId/versions',
    {
      schema: {
        description: "Every saved version of an agent's configuration, newest first.",
        tags: ['agents'],
        params: agentParamsSchema
      }
    },
    listAgentVersionsHandler
  );

  fastifyInstance.patch(
    '/agents/:agentId',
    {
      schema: {
        description: "Change an agent's name or purpose. These are not versioned. Admins only.",
        tags: ['agents'],
        headers: actorHeadersSchema,
        params: agentParamsSchema,
        body: updateAgentProfileBodySchema
      }
    },
    updateAgentProfileHandler
  );

  fastifyInstance.post(
    '/agents/:agentId/config',
    {
      schema: {
        description:
          'Save a new configuration version. Only new tasks use it; running and waiting tasks keep theirs. Admins only.',
        tags: ['agents'],
        headers: actorHeadersSchema,
        params: agentParamsSchema,
        body: updateAgentConfigBodySchema
      }
    },
    updateAgentConfigHandler
  );

  for (const [action, description, handler] of [
    ['disable', 'Stop an agent taking new tasks. Admins only.', disableAgentHandler],
    ['enable', 'Let a disabled agent take new tasks again. Admins only.', enableAgentHandler]
  ] as const) {
    fastifyInstance.post(
      `/agents/:agentId/${action}`,
      {
        schema: {
          description,
          tags: ['agents'],
          headers: actorHeadersSchema,
          params: agentParamsSchema
        }
      },
      handler
    );
  }
}
