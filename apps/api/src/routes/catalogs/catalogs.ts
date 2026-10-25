import { FastifyInstance } from 'fastify';
import {
  addSkillVersionHandler,
  discoverConnectionToolsHandler,
  createConnectionHandler,
  createSkillHandler,
  disableConnectionHandler,
  disableSkillHandler,
  enableConnectionHandler,
  enableSkillHandler,
  getConnectionHandler,
  getSkillHandler,
  grantHandler,
  listConnectionsHandler,
  listGrantsHandler,
  listSkillsHandler,
  listSkillVersionsHandler,
  revokeHandler,
  updateConnectionHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  addSkillVersionBodySchema,
  connectionParamsSchema,
  createConnectionBodySchema,
  createSkillBodySchema,
  grantBodySchema,
  grantParamsSchema,
  listCatalogQuerySchema,
  listGrantsQuerySchema,
  revokeParamsSchema,
  skillParamsSchema,
  updateConnectionBodySchema
} from '../../schemas';

const tags = ['catalogs'];
const headers = actorHeadersSchema;

export async function catalogsRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/skills',
    {
      schema: {
        description:
          'Add an instructions-only skill with version 1. Skills never select connections or grant API access. Admins only.',
        tags,
        headers,
        body: createSkillBodySchema
      }
    },
    createSkillHandler
  );

  fastifyInstance.get(
    '/skills',
    {
      schema: {
        description: 'List skills by name, with their current version.',
        tags,
        querystring: listCatalogQuerySchema
      }
    },
    listSkillsHandler
  );

  fastifyInstance.get(
    '/skills/:skillId',
    {
      schema: {
        description: 'Get a skill with its current version.',
        tags,
        params: skillParamsSchema
      }
    },
    getSkillHandler
  );

  fastifyInstance.get(
    '/skills/:skillId/versions',
    {
      schema: {
        description:
          'Every instructions-only skill version, newest first. Retired connection associations are omitted.',
        tags,
        params: skillParamsSchema
      }
    },
    listSkillVersionsHandler
  );

  fastifyInstance.post(
    '/skills/:skillId/versions',
    {
      schema: {
        description:
          'Save instructions as a new skill version. Connection selections and grants are unchanged. Agent configurations keep their pinned skill versions. Admins only.',
        tags,
        headers,
        params: skillParamsSchema,
        body: addSkillVersionBodySchema
      }
    },
    addSkillVersionHandler
  );

  fastifyInstance.post(
    '/skills/:skillId/disable',
    {
      schema: {
        description:
          'Disable a skill. Agents stop getting its instructions on their next run. Admins only.',
        tags,
        headers,
        params: skillParamsSchema
      }
    },
    disableSkillHandler
  );

  fastifyInstance.post(
    '/skills/:skillId/enable',
    {
      schema: {
        description: 'Enable a disabled skill. Admins only.',
        tags,
        headers,
        params: skillParamsSchema
      }
    },
    enableSkillHandler
  );

  fastifyInstance.post(
    '/connections',
    {
      schema: {
        description:
          'Add an HTTP API or remote MCP connection. The credential is stored encrypted and never returned. Admins only.',
        tags,
        headers,
        body: createConnectionBodySchema
      }
    },
    createConnectionHandler
  );

  fastifyInstance.get(
    '/connections',
    {
      schema: {
        description: 'List connections by name. Credentials are never included.',
        tags,
        querystring: listCatalogQuerySchema
      }
    },
    listConnectionsHandler
  );

  fastifyInstance.get(
    '/connections/:connectionId',
    {
      schema: {
        description: 'Get a connection. hasCredential says whether one is stored.',
        tags,
        params: connectionParamsSchema
      }
    },
    getConnectionHandler
  );

  fastifyInstance.post(
    '/connections/:connectionId/tools',
    {
      schema: {
        description: 'Discover MCP tools without granting access or executing them. Admins only.',
        tags,
        headers,
        params: connectionParamsSchema
      }
    },
    discoverConnectionToolsHandler
  );

  fastifyInstance.patch(
    '/connections/:connectionId',
    {
      schema: {
        description:
          'Change a connection. Applies on the next tool call. Send credential: null to remove it. Admins only.',
        tags,
        headers,
        params: connectionParamsSchema,
        body: updateConnectionBodySchema
      }
    },
    updateConnectionHandler
  );

  fastifyInstance.post(
    '/connections/:connectionId/disable',
    {
      schema: {
        description:
          'Disable a connection. Every call through it is refused from now on. Admins only.',
        tags,
        headers,
        params: connectionParamsSchema
      }
    },
    disableConnectionHandler
  );

  fastifyInstance.post(
    '/connections/:connectionId/enable',
    {
      schema: {
        description: 'Enable a disabled connection. Admins only.',
        tags,
        headers,
        params: connectionParamsSchema
      }
    },
    enableConnectionHandler
  );

  fastifyInstance.get(
    '/agents/:agentId/grants',
    {
      schema: {
        description: "An agent's grants to skills and connections.",
        tags,
        params: grantParamsSchema,
        querystring: listGrantsQuerySchema
      }
    },
    listGrantsHandler
  );

  fastifyInstance.post(
    '/agents/:agentId/grants',
    {
      schema: {
        description:
          'Grant ongoing access and add the skill or connection to agent configuration as a new version when needed. Existing task pins stay unchanged. Admins only.',
        tags,
        headers,
        params: grantParamsSchema,
        body: grantBodySchema
      }
    },
    grantHandler
  );

  fastifyInstance.delete(
    '/agents/:agentId/grants/:type/:targetId',
    {
      schema: {
        description:
          "Revoke a grant. Applies on the agent's next tool call, even in tasks on older configuration versions. Admins only.",
        tags,
        headers,
        params: revokeParamsSchema
      }
    },
    revokeHandler
  );
}
