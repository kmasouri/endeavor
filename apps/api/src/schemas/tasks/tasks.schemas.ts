import { z } from 'zod';
import { ACCESS_DURATIONS, TASK_STATES } from '../../shared/types';

export const taskParamsSchema = z.object({
  taskId: z.uuid()
});

export const createTaskBodySchema = z.strictObject({
  ownerAgentId: z.uuid(),
  title: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  completionCriteria: z.string().trim().min(1),
  reviewRequired: z.boolean().optional(),
  runKey: z.string().trim().min(1).max(200).optional()
});

export const listTasksQuerySchema = z.strictObject({
  state: z.enum(TASK_STATES).optional(),
  ownerAgentId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const listTaskEventsQuerySchema = z.strictObject({
  afterId: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

// Pause, resume, cancel, and restart take an optional note. The body can be left out:
// Fastify passes a missing body as null, so these use nullish().
export const taskActionBodySchema = z
  .strictObject({
    reason: z.string().trim().min(1).optional()
  })
  .nullish();

// Send {} or no body to use the agent's current version.
export const migrateTaskVersionBodySchema = z
  .strictObject({
    versionId: z.uuid().optional(),
    reason: z.string().trim().min(1).optional()
  })
  .nullish();

export const reviewTaskBodySchema = z.strictObject({
  approved: z.boolean(),
  notes: z.string().trim().min(1).optional()
});

export const conversationOutputsParamsSchema = z.object({ conversationId: z.uuid() });
export const agentCostParamsSchema = z.object({ agentId: z.uuid() });

export const listConversationOutputsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const approvalParamsSchema = z.object({ approvalId: z.uuid() });

// duration is for access requests only: "task" (the default) or "ongoing".
export const approveBodySchema = z
  .strictObject({
    reason: z.string().trim().min(1).optional(),
    duration: z.enum(ACCESS_DURATIONS).optional()
  })
  .nullish();

export const taskCapabilityParamsSchema = z.object({
  taskId: z.uuid(),
  capabilityId: z.uuid()
});

export const listApprovalsQuerySchema = z.strictObject({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type AgentCostParams = z.infer<typeof agentCostParamsSchema>;
export type ConversationOutputsParams = z.infer<typeof conversationOutputsParamsSchema>;
export type ListConversationOutputsQuery = z.infer<typeof listConversationOutputsQuerySchema>;
export type ApprovalParams = z.infer<typeof approvalParamsSchema>;
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;
export type ApproveBody = z.infer<typeof approveBodySchema>;
export type TaskCapabilityParams = z.infer<typeof taskCapabilityParamsSchema>;
export type TaskParams = z.infer<typeof taskParamsSchema>;
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ListTaskEventsQuery = z.infer<typeof listTaskEventsQuerySchema>;
export type TaskActionBody = z.infer<typeof taskActionBodySchema>;
export type MigrateTaskVersionBody = z.infer<typeof migrateTaskVersionBodySchema>;
export type ReviewTaskBody = z.infer<typeof reviewTaskBodySchema>;
