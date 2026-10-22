import { FastifyInstance, RouteHandlerMethod } from 'fastify';
import * as handlers from '../../handlers';
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

export async function catalogsRouter(fastifyInstance: FastifyInstance): Promise<void> {
  const route = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    description: string,
    schema: Record<string, unknown>,
    handler: unknown
  ) =>
    fastifyInstance.route({
      method,
      url,
      schema: { description, tags: ['catalogs'], ...schema },
      handler: handler as RouteHandlerMethod
    });
  const admin = { headers: actorHeadersSchema };

  route(
    'POST',
    '/skills',
    'Add a skill to the shared catalog, with version 1. This gives no agent access. Admins only.',
    { ...admin, body: createSkillBodySchema },
    handlers.createSkillHandler
  );
  route(
    'GET',
    '/skills',
    'List skills by name, with their current version.',
    { querystring: listCatalogQuerySchema },
    handlers.listSkillsHandler
  );
  route(
    'GET',
    '/skills/:skillId',
    'Get a skill with its current version.',
    { params: skillParamsSchema },
    handlers.getSkillHandler
  );
  route(
    'GET',
    '/skills/:skillId/versions',
    'Every version of a skill, newest first.',
    { params: skillParamsSchema },
    handlers.listSkillVersionsHandler
  );
  route(
    'POST',
    '/skills/:skillId/versions',
    'Save a new version of a skill. Agent configurations saved before keep the version they pinned. Admins only.',
    { ...admin, params: skillParamsSchema, body: addSkillVersionBodySchema },
    handlers.addSkillVersionHandler
  );
  route(
    'POST',
    '/skills/:skillId/disable',
    'Disable a skill. Agents stop getting its instructions on their next run. Admins only.',
    { ...admin, params: skillParamsSchema },
    handlers.disableSkillHandler
  );
  route(
    'POST',
    '/skills/:skillId/enable',
    'Enable a disabled skill. Admins only.',
    { ...admin, params: skillParamsSchema },
    handlers.enableSkillHandler
  );

  route(
    'POST',
    '/connections',
    'Add a connection to an HTTP API. The credential is stored encrypted and never returned. Admins only.',
    { ...admin, body: createConnectionBodySchema },
    handlers.createConnectionHandler
  );
  route(
    'GET',
    '/connections',
    'List connections by name. Credentials are never included.',
    { querystring: listCatalogQuerySchema },
    handlers.listConnectionsHandler
  );
  route(
    'GET',
    '/connections/:connectionId',
    'Get a connection. hasCredential says whether one is stored.',
    { params: connectionParamsSchema },
    handlers.getConnectionHandler
  );
  route(
    'PATCH',
    '/connections/:connectionId',
    'Change a connection. Applies on the next tool call. Send credential: null to remove it. Admins only.',
    { ...admin, params: connectionParamsSchema, body: updateConnectionBodySchema },
    handlers.updateConnectionHandler
  );
  route(
    'POST',
    '/connections/:connectionId/disable',
    'Disable a connection. Every call through it is refused from now on. Admins only.',
    { ...admin, params: connectionParamsSchema },
    handlers.disableConnectionHandler
  );
  route(
    'POST',
    '/connections/:connectionId/enable',
    'Enable a disabled connection. Admins only.',
    { ...admin, params: connectionParamsSchema },
    handlers.enableConnectionHandler
  );

  route(
    'GET',
    '/agents/:agentId/grants',
    "An agent's grants to skills and connections.",
    { params: grantParamsSchema, querystring: listGrantsQuerySchema },
    handlers.listGrantsHandler
  );
  route(
    'POST',
    '/agents/:agentId/grants',
    'Let an agent use a skill or connection. Admins only.',
    { ...admin, params: grantParamsSchema, body: grantBodySchema },
    handlers.grantHandler
  );
  route(
    'DELETE',
    '/agents/:agentId/grants/:type/:targetId',
    "Revoke a grant. Applies on the agent's next tool call, even in tasks on older configuration versions. Admins only.",
    { ...admin, params: revokeParamsSchema },
    handlers.revokeHandler
  );
}
