import { FastifyInstance } from 'fastify';
import { createHumanHandler, listHumansHandler, updateHumanHandler } from '../../handlers';
import {
  createHumanBodySchema,
  optionalActorHeadersSchema,
  actorHeadersSchema,
  updateHumanBodySchema
} from '../../schemas';

export async function humansRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.patch(
    '/humans/me',
    {
      schema: {
        description: 'Update the acting person’s display name or personal display preferences.',
        tags: ['humans'],
        headers: actorHeadersSchema,
        body: updateHumanBodySchema
      }
    },
    updateHumanHandler
  );

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
