import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  CreateTaskBody,
  ListTaskEventsQuery,
  ListTasksQuery,
  ReviewTaskBody,
  TaskActionBody,
  TaskParams
} from '../../schemas';
import { paged, success } from '../../shared/response';

type TaskActionRequest = FastifyRequest<{
  Params: TaskParams;
  Body: TaskActionBody;
  Headers: ActorHeaders;
}>;

// Returns 201 for a new task, or 200 when the runKey matched an existing one.
export async function createTaskHandler(
  request: FastifyRequest<{ Body: CreateTaskBody; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { task, created } = await request.server.taskService.createTask(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(created ? 201 : 200).send(success(task));
}

export async function listTasksHandler(
  request: FastifyRequest<{ Querystring: ListTasksQuery }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { tasks, total } = await request.server.taskService.listTasks(request.query);
  return paged(tasks, { limit, offset, total });
}

export async function getTaskHandler(
  request: FastifyRequest<{ Params: TaskParams }>
): Promise<unknown> {
  return success(await request.server.taskService.getTask(request.params.taskId));
}

export async function listTaskEventsHandler(
  request: FastifyRequest<{ Params: TaskParams; Querystring: ListTaskEventsQuery }>
): Promise<unknown> {
  return success(await request.server.taskService.listEvents(request.params.taskId, request.query));
}

export async function listTaskOutputsHandler(
  request: FastifyRequest<{ Params: TaskParams }>
): Promise<unknown> {
  return success(await request.server.taskService.listOutputs(request.params.taskId));
}

export async function pauseTaskHandler(request: TaskActionRequest): Promise<unknown> {
  return success(
    await request.server.taskService.pauseTask(
      request.headers['x-actor-id'],
      request.params.taskId,
      request.body?.reason
    )
  );
}

export async function resumeTaskHandler(request: TaskActionRequest): Promise<unknown> {
  return success(
    await request.server.taskService.resumeTask(
      request.headers['x-actor-id'],
      request.params.taskId,
      request.body?.reason
    )
  );
}

export async function cancelTaskHandler(request: TaskActionRequest): Promise<unknown> {
  return success(
    await request.server.taskService.cancelTask(
      request.headers['x-actor-id'],
      request.params.taskId,
      request.body?.reason
    )
  );
}

// Returns 201 for the new linked task, or 200 if this task was already restarted.
export async function restartTaskHandler(
  request: TaskActionRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { task, created } = await request.server.taskService.restartTask(
    request.headers['x-actor-id'],
    request.params.taskId,
    request.body?.reason
  );
  return reply.code(created ? 201 : 200).send(success(task));
}

export async function reviewTaskHandler(
  request: FastifyRequest<{ Params: TaskParams; Body: ReviewTaskBody; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.taskService.reviewTask(
      request.headers['x-actor-id'],
      request.params.taskId,
      request.body
    )
  );
}
