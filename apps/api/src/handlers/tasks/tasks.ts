import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  AgentCostParams,
  ApprovalParams,
  ListApprovalsQuery,
  CreateTaskBody,
  ConversationOutputsParams,
  ListConversationOutputsQuery,
  ListTaskEventsQuery,
  ListTasksQuery,
  MigrateTaskVersionBody,
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
  request: FastifyRequest<{ Querystring: ListTasksQuery; Headers: ActorHeaders }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { tasks, total } = await request.server.taskService.listTasks(
    request.headers['x-actor-id'],
    request.query
  );
  return paged(tasks, { limit, offset, total });
}

export async function getTaskHandler(
  request: FastifyRequest<{ Params: TaskParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.taskService.getTask(request.headers['x-actor-id'], request.params.taskId)
  );
}

export async function listTaskEventsHandler(
  request: FastifyRequest<{
    Params: TaskParams;
    Querystring: ListTaskEventsQuery;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.taskService.listEvents(
      request.headers['x-actor-id'],
      request.params.taskId,
      request.query
    )
  );
}

export async function agentCostsHandler(
  request: FastifyRequest<{ Params: AgentCostParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.taskService.agentCosts(
      request.headers['x-actor-id'],
      request.params.agentId
    )
  );
}

export async function conversationCostsHandler(
  request: FastifyRequest<{ Params: ConversationOutputsParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.taskService.conversationCosts(
      request.headers['x-actor-id'],
      request.params.conversationId
    )
  );
}

export async function listConversationOutputsHandler(
  request: FastifyRequest<{
    Params: ConversationOutputsParams;
    Querystring: ListConversationOutputsQuery;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { outputs, total } = await request.server.taskService.listConversationOutputs(
    request.headers['x-actor-id'],
    request.params.conversationId,
    { limit, offset }
  );
  return paged(outputs, { limit, offset, total });
}

export async function listTaskOutputsHandler(
  request: FastifyRequest<{ Params: TaskParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.taskService.listOutputs(
      request.headers['x-actor-id'],
      request.params.taskId
    )
  );
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

export async function migrateTaskVersionHandler(
  request: FastifyRequest<{
    Params: TaskParams;
    Body: MigrateTaskVersionBody;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.taskService.migrateTaskVersion(
      request.headers['x-actor-id'],
      request.params.taskId,
      request.body ?? {}
    )
  );
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

export async function listApprovalsHandler(
  request: FastifyRequest<{ Querystring: ListApprovalsQuery; Headers: ActorHeaders }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { approvals, total } = await request.server.taskService.listApprovals(
    request.headers['x-actor-id'],
    request.query
  );
  return paged(approvals, { limit, offset, total });
}

export async function getApprovalHandler(
  request: FastifyRequest<{ Params: ApprovalParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.taskService.getApproval(
      request.headers['x-actor-id'],
      request.params.approvalId
    )
  );
}

type DecisionRequest = FastifyRequest<{
  Params: ApprovalParams;
  Body: TaskActionBody;
  Headers: ActorHeaders;
}>;

export async function approveHandler(request: DecisionRequest): Promise<unknown> {
  return success(
    await request.server.taskService.approve(
      request.headers['x-actor-id'],
      request.params.approvalId,
      request.body?.reason
    )
  );
}

export async function rejectHandler(request: DecisionRequest): Promise<unknown> {
  return success(
    await request.server.taskService.reject(
      request.headers['x-actor-id'],
      request.params.approvalId,
      request.body?.reason
    )
  );
}
