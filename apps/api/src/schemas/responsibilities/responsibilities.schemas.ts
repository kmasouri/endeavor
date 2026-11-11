import { z } from 'zod';

const calendarRecurrenceSchema = z
  .strictObject({
    frequency: z.enum(['daily', 'weekdays', 'weekly']),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          // Reject numeric offset zones: recurrence needs a named timezone with DST rules.
          return !/^[+-]/.test(value) && !!new Intl.DateTimeFormat('en', { timeZone: value });
        } catch {
          return false;
        }
      }, 'Use a valid IANA timezone')
  })
  .refine(
    (rule) =>
      rule.frequency === 'weekly'
        ? !!rule.days?.length && new Set(rule.days).size === rule.days.length
        : rule.days === undefined,
    'Choose unique weekdays only for a weekly rule'
  );

export const responsibilityParamsSchema = z.object({ responsibilityId: z.uuid() });

export const createResponsibilityBodySchema = z
  .strictObject({
    projectId: z.uuid().optional(),
    agentId: z.uuid().nullable().optional(),
    // Legacy clients can still identify the project through a conversation.
    conversationId: z.uuid().optional(),
    title: z.string().trim().min(1).max(200),
    brief: z.string().trim().min(1),
    completionCriteria: z.string().trim().min(1),
    intervalMinutes: z.number().int().min(5).max(525_600).optional(),
    recurrence: calendarRecurrenceSchema.optional(),
    missedRunPolicy: z.enum(['ask', 'run_once', 'skip']).optional(),
    startAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional()
  })
  .refine(
    (body) => (body.intervalMinutes !== undefined) !== (body.recurrence !== undefined),
    'Send either intervalMinutes or recurrence'
  )
  .refine(
    (body) => !body.recurrence || body.startAt === undefined,
    'Calendar rules compute their first slot; omit startAt'
  );

export const updateResponsibilityBodySchema = z
  .strictObject({
    agentId: z.uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    brief: z.string().trim().min(1).optional(),
    completionCriteria: z.string().trim().min(1).optional(),
    intervalMinutes: z.number().int().min(5).max(525_600).optional(),
    recurrence: calendarRecurrenceSchema.optional(),
    missedRunPolicy: z.enum(['ask', 'run_once', 'skip']).optional(),
    nextRunAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field')
  .refine(
    (body) => !(body.intervalMinutes !== undefined && body.recurrence !== undefined),
    'Send either intervalMinutes or recurrence'
  )
  .refine(
    (body) => !body.recurrence || body.nextRunAt === undefined,
    'Calendar rules compute their next slot; omit nextRunAt'
  );

export const listResponsibilitiesQuerySchema = z.strictObject({
  agentId: z.uuid().optional(),
  projectId: z.uuid().optional(),
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

// The answer to "missed runs: run now, or wait for the next one?"
export const catchUpBodySchema = z.strictObject({
  decision: z.enum(['run', 'wait'])
});

export type CatchUpBody = z.infer<typeof catchUpBodySchema>;
export type ResponsibilityParams = z.infer<typeof responsibilityParamsSchema>;
export type CreateResponsibilityBody = z.infer<typeof createResponsibilityBodySchema>;
export type UpdateResponsibilityBody = z.infer<typeof updateResponsibilityBodySchema>;
export type ListResponsibilitiesQuery = z.infer<typeof listResponsibilitiesQuerySchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type StartRunBody = z.infer<typeof startRunBodySchema>;
