import { FastifyInstance } from 'fastify';
import { healthcheckHandler } from '../../handlers';

export async function healthcheckRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.get('/health', {
    schema: {
      description: 'Return service health status.',
      tags: ['health']
    },
    handler: healthcheckHandler
  });
}
