import { z } from 'zod';
import { MODEL_PROVIDERS } from '../../shared/types';

export const agentParamsSchema = z.object({
  agentId: z.uuid()
});

const agentConfigFields = {
  instructions: z.string().trim().min(1),
  provider: z.enum(MODEL_PROVIDERS),
  model: z.string().trim().min(1),
  skillIds: z.array(z.uuid()).max(50).optional(),
  connectionIds: z.array(z.uuid()).max(50).optional()
};

export const createAgentBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1),
  ...agentConfigFields
});

export const updateAgentProfileBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    purpose: z.string().trim().min(1).optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export const updateAgentConfigBodySchema = z
  .strictObject({
    instructions: agentConfigFields.instructions.optional(),
    provider: agentConfigFields.provider.optional(),
    model: agentConfigFields.model.optional(),
    skillIds: agentConfigFields.skillIds,
    connectionIds: agentConfigFields.connectionIds
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export const listAgentsQuerySchema = z.strictObject({
  includeDisabled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const listDirectoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type ListDirectoryQuery = z.infer<typeof listDirectoryQuerySchema>;
export type AgentParams = z.infer<typeof agentParamsSchema>;
export type CreateAgentBody = z.infer<typeof createAgentBodySchema>;
export type UpdateAgentProfileBody = z.infer<typeof updateAgentProfileBodySchema>;
export type UpdateAgentConfigBody = z.infer<typeof updateAgentConfigBodySchema>;
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;
