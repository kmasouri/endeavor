import { FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateHumanBody,
  OptionalActorHeaders,
  UpdateHumanBody,
  ActorHeaders
} from '../../schemas';
import { success } from '../../shared/response';

export async function createHumanHandler(
  request: FastifyRequest<{ Body: CreateHumanBody; Headers: OptionalActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const human = await request.server.humanService.createHuman(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(human));
}

export async function listHumansHandler(
  request: FastifyRequest<{ Headers: OptionalActorHeaders }>
): Promise<unknown> {
  return success(await request.server.humanService.listHumans(request.headers['x-actor-id']));
}

export async function updateHumanHandler(
  request: FastifyRequest<{ Body: UpdateHumanBody; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.humanService.updateProfile(request.headers['x-actor-id'], request.body)
  );
}
