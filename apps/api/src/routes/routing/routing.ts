import { FastifyInstance } from 'fastify';
import { chooseRoutingHandler, listRoutingHandler } from '../../handlers';
import {
  actorHeadersSchema,
  listRoutingQuerySchema,
  chooseRoutingBodySchema,
  conversationParamsSchema,
  routingParamsSchema
} from '../../schemas';
export async function routingRouter(app: FastifyInstance): Promise<void> {
  app.get(
    '/conversations/:conversationId/routing',
    {
      schema: {
        description:
          'Routing decisions and unanswered choices visible to the acting person, newest first, with limit/offset pagination.',
        tags: ['routing'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        querystring: listRoutingQuerySchema
      }
    },
    listRoutingHandler
  );
  app.post(
    '/conversations/:conversationId/routing/:decisionId/choice',
    {
      schema: {
        description:
          'Choose a current member agent or null for No one. revision prevents competing choices. Members only. Changing a choice withdraws pending delivery or stops its own active task before sending the new choice. Work that only received an update is never stopped by this endpoint.',
        tags: ['routing'],
        headers: actorHeadersSchema,
        params: routingParamsSchema,
        body: chooseRoutingBodySchema
      }
    },
    chooseRoutingHandler
  );
}
