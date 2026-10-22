import { FastifyReply, FastifyRequest } from 'fastify';
import type { CreateItemBody, ItemParams, ListItemsQuery } from '../../schemas';
import { paged, success } from '../../shared/response';

export async function createItemHandler(
  request: FastifyRequest<{ Body: CreateItemBody }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const item = await request.server.itemService.createItem(request.body);
  return reply.code(201).send(success(item));
}

export async function listItemsHandler(
  request: FastifyRequest<{ Querystring: ListItemsQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { items, total } = await request.server.itemService.listItems({ limit, offset });
  return paged(items, { limit, offset, total });
}

export async function getItemHandler(
  request: FastifyRequest<{ Params: ItemParams }>
): Promise<unknown> {
  const item = await request.server.itemService.getItem(request.params.itemId);
  return success(item);
}
