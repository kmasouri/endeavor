import { z } from 'zod';
export const routingParamsSchema = z.strictObject({
  conversationId: z.uuid(),
  decisionId: z.uuid()
});
export type RoutingParams = z.infer<typeof routingParamsSchema>;
export const chooseRoutingBodySchema = z.strictObject({
  agentId: z.uuid().nullable(),
  revision: z.number().int().nonnegative()
});
export type ChooseRoutingBody = z.infer<typeof chooseRoutingBodySchema>;

export const listRoutingQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
export type ListRoutingQuery = z.infer<typeof listRoutingQuerySchema>;
