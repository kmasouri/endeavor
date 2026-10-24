import { z } from 'zod';
import { HTTP_METHODS } from '../../shared/types';

export const skillParamsSchema = z.object({ skillId: z.uuid() });
export const connectionParamsSchema = z.object({ connectionId: z.uuid() });

export const createSkillBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1),
  instructions: z.string().trim().min(1)
});

export const addSkillVersionBodySchema = z
  .strictObject({
    instructions: z.string().trim().min(1)
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

const pathPrefix = z.string().regex(/^\/[^?#]*$/, 'Must start with "/" and have no query string');

const connectionFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }),
  authHeader: z.string().trim().min(1).max(100),
  // Sent once and stored encrypted. The API never returns it.
  credential: z.string().min(1).max(10_000),
  allowedMethods: z.array(z.enum(HTTP_METHODS)).min(1),
  allowedPathPrefixes: z.array(pathPrefix).min(1).max(50),
  // Methods that need a person's approval before each call.
  approvalMethods: z.array(z.enum(HTTP_METHODS))
};

export const createConnectionBodySchema = z.strictObject({
  ...connectionFields,
  authHeader: connectionFields.authHeader.optional(),
  credential: connectionFields.credential.optional(),
  approvalMethods: connectionFields.approvalMethods.optional()
});

export const updateConnectionBodySchema = z
  .strictObject({
    name: connectionFields.name.optional(),
    description: connectionFields.description.optional(),
    baseUrl: connectionFields.baseUrl.optional(),
    authHeader: connectionFields.authHeader.optional(),
    // null removes the credential.
    credential: connectionFields.credential.nullable().optional(),
    allowedMethods: connectionFields.allowedMethods.optional(),
    allowedPathPrefixes: connectionFields.allowedPathPrefixes.optional(),
    approvalMethods: connectionFields.approvalMethods.optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export const listCatalogQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const grantParamsSchema = z.object({ agentId: z.uuid() });

export const grantBodySchema = z.strictObject({
  type: z.enum(['skill', 'connection']),
  id: z.uuid()
});

export const revokeParamsSchema = z.object({
  agentId: z.uuid(),
  type: z.enum(['skill', 'connection']),
  targetId: z.uuid()
});

export const listGrantsQuerySchema = z.strictObject({
  includeRevoked: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
});

export type SkillParams = z.infer<typeof skillParamsSchema>;
export type ConnectionParams = z.infer<typeof connectionParamsSchema>;
export type CreateSkillBody = z.infer<typeof createSkillBodySchema>;
export type AddSkillVersionBody = z.infer<typeof addSkillVersionBodySchema>;
export type CreateConnectionBody = z.infer<typeof createConnectionBodySchema>;
export type UpdateConnectionBody = z.infer<typeof updateConnectionBodySchema>;
export type ListCatalogQuery = z.infer<typeof listCatalogQuerySchema>;
export type GrantParams = z.infer<typeof grantParamsSchema>;
export type GrantBody = z.infer<typeof grantBodySchema>;
export type RevokeParams = z.infer<typeof revokeParamsSchema>;
export type ListGrantsQuery = z.infer<typeof listGrantsQuerySchema>;
