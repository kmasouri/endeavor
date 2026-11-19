import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  OAuthCallbackQuery,
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
  const skill = await request.server.skillService.createSkill(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(skill));
}

export async function listSkillsHandler(
  request: FastifyRequest<{ Querystring: ListCatalogQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { skills, total } = await request.server.skillService.listSkills(request.query);
  return paged(skills, { limit, offset, total });
}

export async function getSkillHandler(
  request: FastifyRequest<{ Params: SkillParams }>
): Promise<unknown> {
  return success(await request.server.skillService.getSkill(request.params.skillId));
}

export async function listSkillVersionsHandler(
  request: FastifyRequest<{ Params: SkillParams }>
): Promise<unknown> {
  return success(await request.server.skillService.listSkillVersions(request.params.skillId));
}

export async function addSkillVersionHandler(
  request: FastifyRequest<{ Params: SkillParams; Body: AddSkillVersionBody } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const skill = await request.server.skillService.addSkillVersion(
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
    await request.server.skillService.updateSkill(
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
    await request.server.skillService.setSkillDisabled(
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
    await request.server.skillService.setSkillDisabled(
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
  const connection = await request.server.connectionService.createConnection(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(connection));
}

export async function listConnectionsHandler(
  request: FastifyRequest<{ Querystring: ListCatalogQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { connections, total } = await request.server.connectionService.listConnections(
    request.query
  );
  return paged(connections, { limit, offset, total });
}

export async function getConnectionHandler(
  request: FastifyRequest<{ Params: ConnectionParams }>
): Promise<unknown> {
  return success(await request.server.connectionService.getConnection(request.params.connectionId));
}

export async function updateConnectionHandler(
  request: FastifyRequest<{ Params: ConnectionParams; Body: UpdateConnectionBody } & Actor>
): Promise<unknown> {
  return success(
    await request.server.connectionService.updateConnection(
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
    await request.server.connectionService.setConnectionDisabled(
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
    await request.server.connectionService.setConnectionDisabled(
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
    await request.server.grantService.listGrants(
      request.params.agentId,
      request.query.includeRevoked
    )
  );
}

export async function grantHandler(
  request: FastifyRequest<{ Params: GrantParams; Body: GrantBody } & Actor>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const grant = await request.server.grantService.grant(
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
  await request.server.grantService.revoke(request.headers['x-actor-id'], request.params.agentId, {
    type: request.params.type,
    id: request.params.targetId
  });
  return reply.code(204).send();
}

export async function discoverConnectionToolsHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>
): Promise<unknown> {
  return success(
    await request.server.connectionService.discoverConnectionTools(
      request.headers['x-actor-id'],
      request.params.connectionId
    )
  );
}

export async function oauthStatusHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>,
  reply: FastifyReply
): Promise<unknown> {
  reply.header('Cache-Control', 'no-store');
  return success(
    await request.server.connectionService.oauthStatus(
      request.headers['x-actor-id'],
      request.params.connectionId
    )
  );
}

export async function startOAuthHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>,
  reply: FastifyReply
): Promise<unknown> {
  const { authorizationUrl, browserKey, callbackUrl } =
    await request.server.connectionService.startOAuth(
      request.headers['x-actor-id'],
      request.params.connectionId
    );
  const callback = new URL(callbackUrl);
  reply.header('Cache-Control', 'no-store');
  reply.header(
    'Set-Cookie',
    `endeavor_oauth_${request.params.connectionId}=${browserKey}; HttpOnly; SameSite=Lax; Path=${callback.pathname}; Max-Age=600${callback.protocol === 'https:' ? '; Secure' : ''}`
  );
  return success({ authorizationUrl });
}

export async function finishOAuthHandler(
  request: FastifyRequest<{ Params: ConnectionParams; Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply
): Promise<unknown> {
  const name = `endeavor_oauth_${request.params.connectionId}=`;
  const cookie = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name));
  const redirect = await request.server.connectionService.finishOAuth(
    request.params.connectionId,
    request.query,
    cookie?.slice(name.length) ?? ''
  );
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header(
    'Set-Cookie',
    `${name}; HttpOnly; SameSite=Lax; Path=/connections/${request.params.connectionId}/oauth/callback; Max-Age=0`
  );
  return reply.redirect(redirect);
}

export async function disconnectOAuthHandler(
  request: FastifyRequest<{ Params: ConnectionParams } & Actor>,
  reply: FastifyReply
): Promise<unknown> {
  reply.header('Cache-Control', 'no-store');
  return success(
    await request.server.connectionService.disconnectOAuth(
      request.headers['x-actor-id'],
      request.params.connectionId
    )
  );
}
