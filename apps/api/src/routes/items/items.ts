import { FastifyInstance } from 'fastify';
import { createItemHandler, getItemHandler, listItemsHandler } from '../../handlers';
import { createItemBodySchema, itemParamsSchema, listItemsQuerySchema } from '../../schemas';

export async function itemsRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/items',
    {
      schema: {
        description: 'Create an item.',
        tags: ['items'],
        body: createItemBodySchema
      }
    },
    createItemHandler
  );

  fastifyInstance.get(
    '/items',
    {
      schema: {
        description: 'List items ordered by name.',
        tags: ['items'],
        querystring: listItemsQuerySchema
      }
    },
    listItemsHandler
  );

  fastifyInstance.get(
    '/items/:itemId',
    {
      schema: {
        description: 'Get an item by ID.',
        tags: ['items'],
        params: itemParamsSchema
      }
    },
    getItemHandler
  );
}
