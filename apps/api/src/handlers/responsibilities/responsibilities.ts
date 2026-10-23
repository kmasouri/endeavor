import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  CatchUpBody,
  CreateResponsibilityBody,
  ListResponsibilitiesQuery,
  ListRunsQuery,
  ResponsibilityParams,
  StartRunBody,
  UpdateResponsibilityBody
} from '../../schemas';
import { paged, success } from '../../shared/response';

type ActionRequest = FastifyRequest<{ Params: ResponsibilityParams; Headers: ActorHeaders }>;

export async function createResponsibilityHandler(
  request: FastifyRequest<{ Body: CreateResponsibilityBody; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const responsibility = await request.server.responsibilityService.create(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(responsibility));
}

export async function listResponsibilitiesHandler(
  request: FastifyRequest<{ Querystring: ListResponsibilitiesQuery; Headers: ActorHeaders }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { responsibilities, total } = await request.server.responsibilityService.list(
    request.headers['x-actor-id'],
    request.query
  );
  return paged(responsibilities, { limit, offset, total });
}

export async function getResponsibilityHandler(request: ActionRequest): Promise<unknown> {
  return success(
    await request.server.responsibilityService.get(
      request.headers['x-actor-id'],
      request.params.responsibilityId
    )
  );
}

export async function updateResponsibilityHandler(
  request: FastifyRequest<{
    Params: ResponsibilityParams;
    Body: UpdateResponsibilityBody;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.responsibilityService.update(
      request.headers['x-actor-id'],
      request.params.responsibilityId,
      request.body
    )
  );
}

export async function pauseResponsibilityHandler(request: ActionRequest): Promise<unknown> {
  return success(
    await request.server.responsibilityService.setStatus(
      request.headers['x-actor-id'],
      request.params.responsibilityId,
      'paused'
    )
  );
}

export async function resumeResponsibilityHandler(request: ActionRequest): Promise<unknown> {
  return success(
    await request.server.responsibilityService.setStatus(
      request.headers['x-actor-id'],
      request.params.responsibilityId,
      'enabled'
    )
  );
}

export async function cancelResponsibilityHandler(request: ActionRequest): Promise<unknown> {
  return success(
    await request.server.responsibilityService.setStatus(
      request.headers['x-actor-id'],
      request.params.responsibilityId,
      'cancelled'
    )
  );
}

export async function listRunsHandler(
  request: FastifyRequest<{
    Params: ResponsibilityParams;
    Querystring: ListRunsQuery;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { tasks, total } = await request.server.responsibilityService.listRuns(
    request.headers['x-actor-id'],
    request.params.responsibilityId,
    request.query
  );
  return paged(tasks, { limit, offset, total });
}

export async function resolveCatchUpHandler(
  request: FastifyRequest<{
    Params: ResponsibilityParams;
    Body: CatchUpBody;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.responsibilityService.resolveCatchUp(
      request.headers['x-actor-id'],
      request.params.responsibilityId,
      request.body.decision
    )
  );
}

// Returns 201 for a new run, or 200 when the runKey matched an earlier one.
export async function startRunHandler(
  request: FastifyRequest<{
    Params: ResponsibilityParams;
    Body: StartRunBody;
    Headers: ActorHeaders;
  }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { task, created } = await request.server.responsibilityService.startRun(
    request.headers['x-actor-id'],
    request.params.responsibilityId,
    request.body ?? {}
  );
  return reply.code(created ? 201 : 200).send(success(task));
}
