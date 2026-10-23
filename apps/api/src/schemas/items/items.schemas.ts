import { z } from 'zod';

// Zod schemas are the single source of truth for the HTTP contract. Routes pass them to Fastify
// for validation and Swagger; handlers import the inferred types below.

export const itemParamsSchema = z.object({
  itemId: z.uuid()
});

export const createItemBodySchema = z.strictObject({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

// Query strings arrive as strings, so numeric fields use z.coerce.
export const listItemsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type ItemParams = z.infer<typeof itemParamsSchema>;
export type CreateItemBody = z.infer<typeof createItemBodySchema>;
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
