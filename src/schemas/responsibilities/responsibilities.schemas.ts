import { z } from 'zod';

export const responsibilityParamsSchema = z.object({ responsibilityId: z.uuid() });

export const createResponsibilityBodySchema = z.strictObject({
  agentId: z.uuid(),
  // The agent posts its results here. It must already be a member.
  conversationId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1),
  completionCriteria: z.string().trim().min(1),
  intervalMinutes: z.number().int().min(5).max(525_600),
  missedRunPolicy: z.enum(['run_once', 'skip']).optional(),
  startAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .optional()
});

export const updateResponsibilityBodySchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    brief: z.string().trim().min(1).optional(),
    completionCriteria: z.string().trim().min(1).optional(),
    intervalMinutes: z.number().int().min(5).max(525_600).optional(),
    missedRunPolicy: z.enum(['run_once', 'skip']).optional(),
    nextRunAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export const listResponsibilitiesQuerySchema = z.strictObject({
  agentId: z.uuid().optional(),
  status: z.enum(['enabled', 'paused', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const listRunsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

// A run started by hand or by an outside event. Send the same runKey again to get the same run.
export const startRunBodySchema = z
  .strictObject({
    runKey: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().min(1).max(5000).optional()
  })
  .nullish();

export type ResponsibilityParams = z.infer<typeof responsibilityParamsSchema>;
export type CreateResponsibilityBody = z.infer<typeof createResponsibilityBodySchema>;
export type UpdateResponsibilityBody = z.infer<typeof updateResponsibilityBodySchema>;
export type ListResponsibilitiesQuery = z.infer<typeof listResponsibilitiesQuerySchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type StartRunBody = z.infer<typeof startRunBodySchema>;
