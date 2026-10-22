import { FastifyInstance } from 'fastify';
import {
  cancelTaskHandler,
  createTaskHandler,
  getTaskHandler,
  listTaskEventsHandler,
  listTaskOutputsHandler,
  listTasksHandler,
  pauseTaskHandler,
  restartTaskHandler,
  resumeTaskHandler,
  reviewTaskHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  createTaskBodySchema,
  listTaskEventsQuerySchema,
  listTasksQuerySchema,
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
        description: 'List tasks, newest first. Filter by state, agent, or conversation.',
        tags: ['tasks'],
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
        params: taskParamsSchema,
        querystring: listTaskEventsQuerySchema
      }
    },
    listTaskEventsHandler
  );

  fastifyInstance.get(
    '/tasks/:taskId/outputs',
    {
      schema: {
        description: "A task's outputs and evidence.",
        tags: ['tasks'],
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
}
