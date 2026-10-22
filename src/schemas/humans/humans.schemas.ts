import { z } from 'zod';

export const createHumanBodySchema = z.strictObject({
  name: z.string().trim().min(1),
  role: z.enum(['admin', 'member']).default('member')
});

export type CreateHumanBody = z.infer<typeof createHumanBodySchema>;
