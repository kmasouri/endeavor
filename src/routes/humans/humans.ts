import { FastifyInstance } from 'fastify';
import { createHumanHandler, listHumansHandler } from '../../handlers';
import { createHumanBodySchema, optionalActorHeadersSchema } from '../../schemas';

export async function humansRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/humans',
    {
      schema: {
        description:
          'Add a person. The first person added becomes an admin and needs no x-actor-id. After that, only admins can add people.',
        tags: ['humans'],
        headers: optionalActorHeadersSchema,
        body: createHumanBodySchema
      }
    },
    createHumanHandler
  );

  fastifyInstance.get(
    '/humans',
    {
      schema: {
        description: 'List people, oldest first.',
        tags: ['humans']
      }
    },
    listHumansHandler
  );
}
