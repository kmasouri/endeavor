import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  AgentParams,
  CreateAgentBody,
  ListAgentsQuery,
  ListDirectoryQuery,
  UpdateAgentConfigBody,
  UpdateAgentProfileBody
} from '../../schemas';
import { paged, success } from '../../shared/response';

type AgentActionRequest = FastifyRequest<{ Params: AgentParams; Headers: ActorHeaders }>;

export async function agentDeletionImpactHandler(request: AgentActionRequest): Promise<unknown> {
  return success(
    await request.server.agentService.deletionImpact(
      request.headers['x-actor-id'],
      request.params.agentId
    )
  );
}

export async function deleteAgentHandler(request: AgentActionRequest): Promise<unknown> {
  return success(
    await request.server.agentService.deleteAgent(
      request.headers['x-actor-id'],
      request.params.agentId
    )
  );
}

export async function createAgentHandler(
  request: FastifyRequest<{ Body: CreateAgentBody; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const agent = await request.server.agentService.createAgent(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(agent));
}

export async function listAgentsHandler(
  request: FastifyRequest<{ Querystring: ListAgentsQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { agents, total } = await request.server.agentService.listAgents(request.query);
  return paged(agents, { limit, offset, total });
}

export async function getAgentHandler(
  request: FastifyRequest<{ Params: AgentParams }>
): Promise<unknown> {
  return success(await request.server.agentService.getAgent(request.params.agentId));
}

export async function listAgentVersionsHandler(
  request: FastifyRequest<{ Params: AgentParams }>
): Promise<unknown> {
  return success(await request.server.agentService.listVersions(request.params.agentId));
}

export async function updateAgentProfileHandler(
  request: FastifyRequest<{
    Params: AgentParams;
    Body: UpdateAgentProfileBody;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.agentService.updateProfile(
      request.headers['x-actor-id'],
      request.params.agentId,
      request.body
    )
  );
}

export async function updateAgentConfigHandler(
  request: FastifyRequest<{
    Params: AgentParams;
    Body: UpdateAgentConfigBody;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.agentService.updateConfig(
      request.headers['x-actor-id'],
      request.params.agentId,
      request.body
    )
  );
}

export async function disableAgentHandler(request: AgentActionRequest): Promise<unknown> {
  return success(
    await request.server.agentService.setDisabled(
      request.headers['x-actor-id'],
      request.params.agentId,
      true
    )
  );
}

export async function enableAgentHandler(request: AgentActionRequest): Promise<unknown> {
  return success(
    await request.server.agentService.setDisabled(
      request.headers['x-actor-id'],
      request.params.agentId,
      false
    )
  );
}

export async function listDirectoryHandler(
  request: FastifyRequest<{ Querystring: ListDirectoryQuery; Headers: ActorHeaders }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { entries, total } = await request.server.agentService.listDirectory(
    request.headers['x-actor-id'],
    request.query
  );
  return paged(entries, { limit, offset, total });
}

export async function listProvidersHandler(request: FastifyRequest): Promise<unknown> {
  return success(request.server.agentService.listProviders());
}
