import { FastifyInstance } from 'fastify';
import {
  addDocumentHandler,
  addMemberHandler,
  deleteDocumentHandler,
  listDocumentsHandler,
  createConversationHandler,
  getConversationHandler,
  listConversationsHandler,
  listMessagesHandler,
  markReadHandler,
  postMessageHandler,
  updateConversationHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  addDocumentBodySchema,
  documentParamsSchema,
  addMemberBodySchema,
  conversationParamsSchema,
  createConversationBodySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadBodySchema,
  postMessageBodySchema,
  updateConversationBodySchema
} from '../../schemas';

export async function conversationsRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/conversations',
    {
      schema: {
        description:
          'Start a conversation. Names are stored as lowercase letters, numbers, and hyphens. You become a member; agentIds and humanIds add chosen members.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        body: createConversationBodySchema
      }
    },
    createConversationHandler
  );

  fastifyInstance.get(
    '/conversations',
    {
      schema: {
        description:
          'Conversations, newest first. Admins see all of them; members see the ones they belong to. Each has unreadCount: messages from others you have not seen yet (0 where you are not a member).',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        querystring: listConversationsQuerySchema
      }
    },
    listConversationsHandler
  );

  fastifyInstance.patch(
    '/conversations/:conversationId',
    {
      schema: {
        description:
          'Change a conversation: its channel name (normalized to lowercase letters, numbers, and hyphens), or its budget for all agent work in it (budgetUsd, null for none).',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        body: updateConversationBodySchema
      }
    },
    updateConversationHandler
  );

  fastifyInstance.get(
    '/conversations/:conversationId',
    {
      schema: {
        description: 'Get a conversation with its members.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema
      }
    },
    getConversationHandler
  );

  fastifyInstance.post(
    '/conversations/:conversationId/members',
    {
      schema: {
        description: 'Add a person or agent. Only people add members; agents can only suggest one.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        body: addMemberBodySchema
      }
    },
    addMemberHandler
  );

  fastifyInstance.post(
    '/conversations/:conversationId/messages',
    {
      schema: {
        description:
          'Post a message. Mentioned agents, and the agent you reply to, are asked to respond. Others are not woken.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        body: postMessageBodySchema
      }
    },
    postMessageHandler
  );

  fastifyInstance.get(
    '/conversations/:conversationId/messages',
    {
      schema: {
        description: 'Messages, oldest first.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        querystring: listMessagesQuerySchema
      }
    },
    listMessagesHandler
  );

  fastifyInstance.put(
    '/conversations/:conversationId/read',
    {
      schema: {
        description:
          'Mark the conversation read up to messageId, the newest message you have seen. It never moves back to an older message. Returns your unreadCount.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        body: markReadBodySchema
      }
    },
    markReadHandler
  );

  fastifyInstance.post(
    '/conversations/:conversationId/documents',
    {
      schema: {
        description:
          "Attach a document as a knowledge source for this conversation's agents. Agents read it but can't change it. Members only.",
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema,
        body: addDocumentBodySchema
      }
    },
    addDocumentHandler
  );

  fastifyInstance.get(
    '/conversations/:conversationId/documents',
    {
      schema: {
        description: 'Documents attached to this conversation.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema
      }
    },
    listDocumentsHandler
  );

  fastifyInstance.delete(
    '/conversations/:conversationId/documents/:documentId',
    {
      schema: {
        description: 'Remove a document. Agents stop seeing it on their next run. Members only.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: documentParamsSchema
      }
    },
    deleteDocumentHandler
  );
}
