import { FastifyInstance } from 'fastify';
import {
  cancelResponsibilityHandler,
  createResponsibilityHandler,
  getResponsibilityHandler,
  listResponsibilitiesHandler,
  listRunsHandler,
  pauseResponsibilityHandler,
  resumeResponsibilityHandler,
  startRunHandler,
  updateResponsibilityHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  createResponsibilityBodySchema,
  listResponsibilitiesQuerySchema,
  listRunsQuerySchema,
  responsibilityParamsSchema,
  startRunBodySchema,
  updateResponsibilityBodySchema
} from '../../schemas';

export async function responsibilitiesRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/responsibilities',
    {
      schema: {
        description: 'Set up recurring work for an agent. Each run is a task. Admins only.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        body: createResponsibilityBodySchema
      }
    },
    createResponsibilityHandler
  );

  fastifyInstance.get(
    '/responsibilities',
    {
      schema: {
        description: 'List recurring responsibilities, newest first.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        querystring: listResponsibilitiesQuerySchema
      }
    },
    listResponsibilitiesHandler
  );

  fastifyInstance.get(
    '/responsibilities/:responsibilityId',
    {
      schema: {
        description: 'Get a responsibility, with when it runs next.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema
      }
    },
    getResponsibilityHandler
  );

  fastifyInstance.patch(
    '/responsibilities/:responsibilityId',
    {
      schema: {
        description: 'Change a responsibility. Applies to future runs only. Admins only.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema,
        body: updateResponsibilityBodySchema
      }
    },
    updateResponsibilityHandler
  );

  fastifyInstance.post(
    '/responsibilities/:responsibilityId/pause',
    {
      schema: {
        description: 'Pause the schedule. A run that is already going keeps going. Admins only.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema
      }
    },
    pauseResponsibilityHandler
  );

  fastifyInstance.post(
    '/responsibilities/:responsibilityId/resume',
    {
      schema: {
        description: 'Resume a paused schedule, starting from now. Admins only.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema
      }
    },
    resumeResponsibilityHandler
  );

  fastifyInstance.post(
    '/responsibilities/:responsibilityId/cancel',
    {
      schema: {
        description:
          "Cancel the schedule for good. A run that is already going isn't stopped; cancel that task separately. Admins only.",
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema
      }
    },
    cancelResponsibilityHandler
  );

  fastifyInstance.get(
    '/responsibilities/:responsibilityId/runs',
    {
      schema: {
        description:
          'Run history: the tasks this responsibility started, newest first. Admins only.',
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema,
        querystring: listRunsQuerySchema
      }
    },
    listRunsHandler
  );

  fastifyInstance.post(
    '/responsibilities/:responsibilityId/runs',
    {
      schema: {
        description:
          "Start a run now, outside the schedule, such as for an outside event. The schedule doesn't change. Admins only.",
        tags: ['responsibilities'],
        headers: actorHeadersSchema,
        params: responsibilityParamsSchema,
        body: startRunBodySchema
      }
    },
    startRunHandler
  );
}
