import { FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  ConversationParams,
  RoutingParams,
  ListRoutingQuery,
  ChooseRoutingBody
} from '../../schemas';
import { success, paged } from '../../shared/response';
export async function listRoutingHandler(
  request: FastifyRequest<{
    Params: ConversationParams;
    Headers: ActorHeaders;
    Querystring: ListRoutingQuery;
  }>
): Promise<unknown> {
  const { decisions, total } = await request.server.routingService.list(
    request.headers['x-actor-id'],
    request.params.conversationId,
    request.query
  );
  return paged(decisions, { ...request.query, total });
}
export async function chooseRoutingHandler(
  request: FastifyRequest<{ Params: RoutingParams; Headers: ActorHeaders; Body: ChooseRoutingBody }>
): Promise<unknown> {
  return success(
    await request.server.routingService.choose(
      request.headers['x-actor-id'],
      request.params.conversationId,
      request.params.decisionId,
      request.body
    )
  );
}
