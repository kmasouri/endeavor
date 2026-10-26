import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  AddSkillVersionBody,
  ConnectionParams,
  CreateConnectionBody,
  CreateSkillBody,
  GrantBody,
  GrantParams,
  ListCatalogQuery,
  ListGrantsQuery,
  RevokeParams,
  SkillParams,
  UpdateSkillBody,
  UpdateConnectionBody
} from '../../schemas';
import { paged, success } from '../../shared/response';

type Actor = { Headers: ActorHeaders };

export async function createSkillHandler(
  request: FastifyRequest<{ Body: CreateSkillBody } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const skill = await request.server.catalogService.createSkill(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(skill));
}

export async function listSkillsHandler(
  request: FastifyRequest<{ Querystring: ListCatalogQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { skills, total } = await request.server.catalogService.listSkills(request.query);
  return paged(skills, { limit, offset, total });
}

export async function getSkillHandler(
  request: FastifyRequest<{ Params: SkillParams }>
): Promise<unknown> {
  return success(await request.server.catalogService.getSkill(request.params.skillId));
}

export async function listSkillVersionsHandler(
  request: FastifyRequest<{ Params: SkillParams }>
): Promise<unknown> {
  return success(await request.server.catalogService.listSkillVersions(request.params.skillId));
}

export async function addSkillVersionHandler(
  request: FastifyRequest<{ Params: SkillParams; Body: AddSkillVersionBody } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const skill = await request.server.catalogService.addSkillVersion(
    request.headers['x-actor-id'],
    request.params.skillId,
    request.body
  );
  return reply.code(201).send(success(skill));
}

export async function updateSkillHandler(
  request: FastifyRequest<{ Params: SkillParams; Body: UpdateSkillBody } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.updateSkill(
      request.headers['x-actor-id'],
      request.params.skillId,
      request.body
    )
  );
}

export async function disableSkillHandler(
  request: FastifyRequest<{ Params: SkillParams } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.setSkillDisabled(
      request.headers['x-actor-id'],
      request.params.skillId,
      true
    )
  );
}

export async function enableSkillHandler(
  request: FastifyRequest<{ Params: SkillParams } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.setSkillDisabled(
      request.headers['x-actor-id'],
      request.params.skillId,
      false
    )
  );
}

export async function createConnectionHandler(
  request: FastifyRequest<{ Body: CreateConnectionBody } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const connection = await request.server.catalogService.createConnection(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(connection));
}

export async function listConnectionsHandler(
  request: FastifyRequest<{ Querystring: ListCatalogQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { connections, total } = await request.server.catalogService.listConnections(request.query);
  return paged(connections, { limit, offset, total });
}

export async function getConnectionHandler(
  request: FastifyRequest<{ Params: ConnectionParams }>
): Promise<unknown> {
  return success(await request.server.catalogService.getConnection(request.params.connectionId));
}

export async function updateConnectionHandler(
  request: FastifyRequest<{ Params: ConnectionParams; Body: UpdateConnectionBody } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.updateConnection(
      request.headers['x-actor-id'],
      request.params.connectionId,
      request.body
    )
  );
}

export async function disableConnectionHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.setConnectionDisabled(
      request.headers['x-actor-id'],
      request.params.connectionId,
      true
    )
  );
}

export async function enableConnectionHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.setConnectionDisabled(
      request.headers['x-actor-id'],
      request.params.connectionId,
      false
    )
  );
}

export async function listGrantsHandler(
  request: FastifyRequest<{ Params: GrantParams; Querystring: ListGrantsQuery }>
): Promise<unknown> {
  return success(
    await request.server.catalogService.listGrants(
      request.params.agentId,
      request.query.includeRevoked
    )
  );
}

export async function grantHandler(
  request: FastifyRequest<{ Params: GrantParams; Body: GrantBody } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const grant = await request.server.catalogService.grant(
    request.headers['x-actor-id'],
    request.params.agentId,
    request.body
  );
  return reply.code(201).send(success(grant));
}

export async function revokeHandler(
  request: FastifyRequest<{ Params: RevokeParams } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  await request.server.catalogService.revoke(
    request.headers['x-actor-id'],
    request.params.agentId,
    {
      type: request.params.type,
      id: request.params.targetId
    }
  );
  return reply.code(204).send();
}

export async function discoverConnectionToolsHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>
): Promise<unknown> {
  return success(
    await request.server.catalogService.discoverConnectionTools(
      request.headers['x-actor-id'],
      request.params.connectionId
    )
  );
}
