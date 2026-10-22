import { z } from 'zod';

export const agentNotesParamsSchema = z.object({ agentId: z.uuid() });
export const noteParamsSchema = z.object({ agentId: z.uuid(), noteId: z.uuid() });

export const listNotesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const updateNoteBodySchema = z
  .strictObject({
    body: z.string().trim().min(1).max(10_000).optional(),
    // 'agent' shows the note in all the agent's tasks. Admins only.
    scope: z.enum(['conversation', 'agent']).optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export type AgentNotesParams = z.infer<typeof agentNotesParamsSchema>;
export type NoteParams = z.infer<typeof noteParamsSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>;
