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
  getAgentCostsHandler,
  getConversationCostsHandler,
  listConversationOutputsHandler,
  listTaskOutputsHandler,
  listTaskCapabilitiesHandler,
  revokeTaskCapabilityHandler,
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
  approveBodySchema,
  taskCapabilityParamsSchema,
  listApprovalsQuerySchema,
  createTaskBodySchema,
  agentCostParamsSchema,
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
    '/agents/:agentId/costs',
    {
      schema: {
        description:
          'What an agent spent in US dollars: in total, this month (UTC), and its costliest tasks this month, next to its monthly budget. Calls to models with no price in MODEL_PRICES count as unpricedCalls.',
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: agentCostParamsSchema
      }
    },
    getAgentCostsHandler
  );

  fastifyInstance.get(
    '/conversations/:conversationId/costs',
    {
      schema: {
        description:
          "What all agent work in a conversation spent in US dollars, split by agent and including its costliest tasks, next to the conversation's budget.",
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: conversationOutputsParamsSchema
      }
    },
    getConversationCostsHandler
  );

  fastifyInstance.get(
    '/conversations/:conversationId/outputs',
    {
      schema: {
        description:
          'Outputs and evidence from every task in a conversation, newest first. Each is draft until its task completes, then final.',
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
        description:
          "A task's outputs and evidence. Each is draft until the task completes, then final.",
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
          'Approve the action. The runner makes the call, records the result, and wakes the task. For an access request, send duration: "task" (the default) adds access to the waiting task only; "ongoing" also adds the item to the agent\'s configuration as a new version. The capability and scope are checked again first.',
        tags: ['approvals'],
        headers: actorHeadersSchema,
        params: approvalParamsSchema,
        body: approveBodySchema
      }
    },
    approveHandler
  );

  fastifyInstance.post(
    '/approvals/:approvalId/reject',
    {
      schema: {
        description:
          'Reject the action or access request. Nothing is made or granted; the agent is told why.',
        tags: ['approvals'],
        headers: actorHeadersSchema,
        params: approvalParamsSchema,
        body: taskActionBodySchema
      }
    },
    rejectHandler
  );

  fastifyInstance.get(
    '/tasks/:taskId/capabilities',
    {
      schema: {
        description:
          "Skills and connections a person added to this task after an access request, including revoked ones. The task's pinned configuration version is unchanged.",
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskParamsSchema
      }
    },
    listTaskCapabilitiesHandler
  );

  fastifyInstance.delete(
    '/tasks/:taskId/capabilities/:capabilityId',
    {
      schema: {
        description:
          'Revoke access added to this task. It applies from the next call. Ongoing access stays in the agent configuration; remove it there to take it away from future work.',
        tags: ['tasks'],
        headers: actorHeadersSchema,
        params: taskCapabilityParamsSchema
      }
    },
    revokeTaskCapabilityHandler
  );
}
