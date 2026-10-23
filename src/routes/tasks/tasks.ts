import { FastifyInstance } from 'fastify';
import {
  approveHandler,
  cancelTaskHandler,
  getApprovalHandler,
  listApprovalsHandler,
  rejectHandler,
  createTaskHandler,
  getTaskHandler,
  listTaskEventsHandler,
  listConversationOutputsHandler,
  listTaskOutputsHandler,
  listTasksHandler,
  migrateTaskVersionHandler,
  pauseTaskHandler,
  restartTaskHandler,
  resumeTaskHandler,
  reviewTaskHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  approvalParamsSchema,
  listApprovalsQuerySchema,
  createTaskBodySchema,
  conversationOutputsParamsSchema,
  listConversationOutputsQuerySchema,
  listTaskEventsQuerySchema,
  listTasksQuerySchema,
  migrateTaskVersionBodySchema,
  reviewTaskBodySchema,
  taskActionBodySchema,
  taskParamsSchema
} from '../../schemas';

export async function tasksRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/tasks',
    {
      schema: {
        description:
          "Give an agent a task. It starts as working, using the agent's current configuration. Send the same runKey again to get the same task back.",
        tags: ['tasks'],
        headers: actorHeadersSchema,
        body: createTaskBodySchema
      }
    },
    createTaskHandler
  );

  fastifyInstance.get(
    '/tasks',
    {
      schema: {
        description:
          'List tasks you may see, newest first. Admins see all; members see tasks in their conversations and tasks they asked for.',
        tags: ['tasks'],
        headers: actorHeadersSchema,
        querystring: listTasksQuerySchema
      }
    },
    listTasksHandler
  );

  fastifyInstance.get(
    '/tasks/:taskId',
    {
      schema: {
        description: 'Get a task with all its waits, open and resolved.',
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskParamsSchema
      }
    },
    getTaskHandler
  );

  fastifyInstance.get(
    '/tasks/:taskId/events',
    {
      schema: {
        description: "A task's execution history, oldest first. Page with afterId.",
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskParamsSchema,
        querystring: listTaskEventsQuerySchema
      }
    },
    listTaskEventsHandler
  );

  fastifyInstance.get(
    '/conversations/:conversationId/outputs',
    {
      schema: {
        description:
          'Outputs and evidence from every task in a conversation, newest first: results, documents, links, files, and logs.',
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: conversationOutputsParamsSchema,
        querystring: listConversationOutputsQuerySchema
      }
    },
    listConversationOutputsHandler
  );

  fastifyInstance.get(
    '/tasks/:taskId/outputs',
    {
      schema: {
        description: "A task's outputs and evidence.",
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskParamsSchema
      }
    },
    listTaskOutputsHandler
  );

  const actions = [
    [
      'pause',
      'Pause an open task. It keeps its state and does nothing until resumed.',
      pauseTaskHandler
    ],
    ['resume', 'Resume a paused task, or send a blocked task back to working.', resumeTaskHandler],
    [
      'cancel',
      'Cancel an open task. Cancelled tasks never resume on their own.',
      cancelTaskHandler
    ],
    [
      'restart',
      'Run a completed or cancelled task again, as a new linked task. The old one stays as it was.',
      restartTaskHandler
    ]
  ] as const;

  for (const [action, description, handler] of actions) {
    fastifyInstance.post(
      `/tasks/:taskId/${action}`,
      {
        schema: {
          description,
          tags: ['tasks'],
          headers: actorHeadersSchema,
          params: taskParamsSchema,
          body: taskActionBodySchema
        }
      },
      handler
    );
  }

  fastifyInstance.post(
    '/tasks/:taskId/version',
    {
      schema: {
        description:
          "Move an open task to another version of its agent's configuration (default: the current one). Tasks never change version on their own. Admins only.",
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskParamsSchema,
        body: migrateTaskVersionBodySchema
      }
    },
    migrateTaskVersionHandler
  );

  fastifyInstance.post(
    '/tasks/:taskId/review',
    {
      schema: {
        description:
          'Review the output of a task waiting for review. Approving completes it; otherwise it goes back to working with your notes.',
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskParamsSchema,
        body: reviewTaskBodySchema
      }
    },
    reviewTaskHandler
  );

  fastifyInstance.get(
    '/approvals',
    {
      schema: {
        description:
          'Actions agents asked to take that need a person, newest first. Filter with status=pending. Shows only approvals on tasks you may see.',
        tags: ['approvals'],
        headers: actorHeadersSchema,
        querystring: listApprovalsQuerySchema
      }
    },
    listApprovalsHandler
  );

  fastifyInstance.get(
    '/approvals/:approvalId',
    {
      schema: {
        description: 'Get one approval, with its request and, once carried out, its result.',
        tags: ['approvals'],
        headers: actorHeadersSchema,
        params: approvalParamsSchema
      }
    },
    getApprovalHandler
  );

  fastifyInstance.post(
    '/approvals/:approvalId/approve',
    {
      schema: {
        description:
          'Approve the action. The runner makes the call, records the result, and wakes the task.',
        tags: ['approvals'],
        headers: actorHeadersSchema,
        params: approvalParamsSchema,
        body: taskActionBodySchema
      }
    },
    approveHandler
  );

  fastifyInstance.post(
    '/approvals/:approvalId/reject',
    {
      schema: {
        description: 'Reject the action. It is never made; the agent is told why.',
        tags: ['approvals'],
        headers: actorHeadersSchema,
        params: approvalParamsSchema,
        body: taskActionBodySchema
      }
    },
    rejectHandler
  );
}
