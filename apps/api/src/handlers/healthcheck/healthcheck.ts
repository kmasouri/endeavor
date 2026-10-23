import { FastifyRequest, FastifyReply } from 'fastify';
import { success } from '../../shared/response';

export async function healthcheckHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  return reply.code(200).send(success({ status: 'ok' }));
}
