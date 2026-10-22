import { z } from 'zod';
import { TASK_STATES } from '../../shared/types';

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

// Pause, resume, cancel, and restart take an optional note. Send {} for none.
export const taskActionBodySchema = z
  .strictObject({
    reason: z.string().trim().min(1).optional()
  })
  .optional();

export const reviewTaskBodySchema = z.strictObject({
  approved: z.boolean(),
  notes: z.string().trim().min(1).optional()
});

export type TaskParams = z.infer<typeof taskParamsSchema>;
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ListTaskEventsQuery = z.infer<typeof listTaskEventsQuerySchema>;
export type TaskActionBody = z.infer<typeof taskActionBodySchema>;
export type ReviewTaskBody = z.infer<typeof reviewTaskBodySchema>;
