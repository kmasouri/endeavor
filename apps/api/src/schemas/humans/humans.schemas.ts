import { z } from 'zod';

export const createHumanBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'member']).default('member')
});

export type CreateHumanBody = z.infer<typeof createHumanBodySchema>;

export const updateHumanBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    preferences: z
      .strictObject({
        theme: z.enum(['system', 'dark', 'light']).optional(),
        timeFormat: z.enum(['12h', '24h']).optional()
      })
      .refine((value) => Object.keys(value).length > 0, 'Choose a preference to update')
      .optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide a name or preferences');

export type UpdateHumanBody = z.infer<typeof updateHumanBodySchema>;
