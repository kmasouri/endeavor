import { FastifyInstance } from 'fastify';
import {
  addDocumentHandler,
  addMemberHandler,
  closeConversationHandler,
  deleteDocumentHandler,
  listDocumentsHandler,
  createConversationHandler,
  getConversationHandler,
  listConversationsHandler,
  listMessagesHandler,
  markReadHandler,
  postMessageHandler,
  reopenConversationHandler,
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
          "Start an endeavor (a conversation) for one goal, in projectId. Pass projectId: null for standalone or omit it for the default project. Names are stored as lowercase letters, numbers, and hyphens, with at most 64 characters after normalization. You become a member; agentIds and humanIds add chosen members, and the project's default members join too. Without goal, the first message a person posts becomes the goal. doneCriteria is filled in from the goal when left out.",
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
          'Conversations, newest first. In v1 every person sees all of them. Only open ones are listed unless state is closed or all; projectId keeps one project. Each has unreadCount: messages from others you have not seen yet (always 0 where you are not a member).',
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
          'Change a conversation: its channel name (at most 64 characters after normalization to lowercase letters, numbers, and hyphens), its budget for all agent work in it (budgetUsd, null for none), its goal, or its done criteria.',
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
    '/conversations/:conversationId/close',
    {
      schema: {
        description:
          'Close the endeavor: a person confirms its goal is done. It is archived and takes no new messages until reopened. Work already running is not stopped.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema
      }
    },
    closeConversationHandler
  );

  fastifyInstance.post(
    '/conversations/:conversationId/reopen',
    {
      schema: {
        description: 'Reopen a closed endeavor for follow-ups.',
        tags: ['conversations'],
        headers: actorHeadersSchema,
        params: conversationParamsSchema
      }
    },
    reopenConversationHandler
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
          'Post a message. Mentioned agents, and the agent you reply to, are asked to respond. Untagged human messages without a reply are routed asynchronously to one eligible member agent or wait for a person to choose.',
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
        description:
          'Messages, oldest first. Use latest=true for the newest window, beforeId for older history or afterId for new arrivals. Cursor modes cannot be combined or used with offset. The default retains oldest-first offset pagination.',
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
          "Attach a document as a knowledge source for this conversation's agents only. Use /projects/:projectId/documents to share one with every endeavor in the project. Agents read it but can't change it. Members only.",
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
        description:
          "Documents this conversation's agents see: its project's shared documents and the ones limited to it.",
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
