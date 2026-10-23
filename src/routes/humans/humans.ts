import { FastifyInstance } from 'fastify';
import { createHumanHandler, listHumansHandler } from '../../handlers';
import { createHumanBodySchema, optionalActorHeadersSchema } from '../../schemas';

export async function humansRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/humans',
    {
      schema: {
        description:
          'Add a person. The first person added needs no x-actor-id. After that, any person can add people (v1 has one role).',
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
        description:
          'List people, oldest first. No x-actor-id needed, so the web interface can ask who you are.',
        tags: ['humans'],
        headers: optionalActorHeadersSchema
      }
    },
    listHumansHandler
  );
}
