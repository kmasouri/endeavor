import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  AddDocumentBody,
  DocumentParams,
  AddMemberBody,
  ConversationParams,
  CreateConversationBody,
  ListConversationsQuery,
  ListMessagesQuery,
  PostMessageBody
} from '../../schemas';
import { paged, success } from '../../shared/response';

export async function createConversationHandler(
  request: FastifyRequest<{ Body: CreateConversationBody; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const conversation = await request.server.conversationService.createConversation(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(conversation));
}

export async function listConversationsHandler(
  request: FastifyRequest<{ Querystring: ListConversationsQuery; Headers: ActorHeaders }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { conversations, total } = await request.server.conversationService.listConversations(
    request.headers['x-actor-id'],
    request.query
  );
  return paged(conversations, { limit, offset, total });
}

export async function getConversationHandler(
  request: FastifyRequest<{ Params: ConversationParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.conversationService.getConversation(
      request.headers['x-actor-id'],
      request.params.conversationId
    )
  );
}

export async function addMemberHandler(
  request: FastifyRequest<{
    Params: ConversationParams;
    Body: AddMemberBody;
    Headers: ActorHeaders;
  }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { type, id, history } = request.body;
  const conversation = await request.server.conversationService.addMember(
    request.headers['x-actor-id'],
    request.params.conversationId,
    { participant: { type, id }, history }
  );
  return reply.code(201).send(success(conversation));
}

// Returns 201 for a new message, or 200 when the clientKey matched one already sent.
export async function postMessageHandler(
  request: FastifyRequest<{
    Params: ConversationParams;
    Body: PostMessageBody;
    Headers: ActorHeaders;
  }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { message, created } = await request.server.conversationService.postMessage(
    request.headers['x-actor-id'],
    request.params.conversationId,
    request.body
  );
  return reply.code(created ? 201 : 200).send(success(message));
}

export async function listMessagesHandler(
  request: FastifyRequest<{
    Params: ConversationParams;
    Querystring: ListMessagesQuery;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.conversationService.listMessages(
      request.headers['x-actor-id'],
      request.params.conversationId,
      request.query
    )
  );
}

export async function addDocumentHandler(
  request: FastifyRequest<{
    Params: ConversationParams;
    Body: AddDocumentBody;
    Headers: ActorHeaders;
  }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const document = await request.server.conversationService.addDocument(
    request.headers['x-actor-id'],
    request.params.conversationId,
    request.body
  );
  return reply.code(201).send(success(document));
}

export async function listDocumentsHandler(
  request: FastifyRequest<{ Params: ConversationParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.conversationService.listDocuments(
      request.headers['x-actor-id'],
      request.params.conversationId
    )
  );
}

export async function deleteDocumentHandler(
  request: FastifyRequest<{ Params: DocumentParams; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  await request.server.conversationService.deleteDocument(
    request.headers['x-actor-id'],
    request.params.conversationId,
    request.params.documentId
  );
  return reply.code(204).send();
}
