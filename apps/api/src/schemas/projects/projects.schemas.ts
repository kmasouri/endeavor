import { z } from 'zod';

const projectNameSchema = z.string().trim().min(1).max(100);

export const projectParamsSchema = z.object({
  projectId: z.uuid()
});

export const projectDocumentParamsSchema = z.object({
  projectId: z.uuid(),
  documentId: z.uuid()
});

export const createProjectBodySchema = z.strictObject({
  name: projectNameSchema,
  // Default people and agents, added to every new endeavor in the project.
  agentIds: z.array(z.uuid()).max(20).optional(),
  humanIds: z.array(z.uuid()).max(20).optional()
});

export const updateProjectBodySchema = z
  .strictObject({
    name: projectNameSchema.optional(),
    // Replace that kind of default member. The other kind is kept.
    agentIds: z.array(z.uuid()).max(20).optional(),
    humanIds: z.array(z.uuid()).max(20).optional(),
    // true archives the project; false restores it.
    archived: z.boolean().optional()
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

export const listProjectsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  archived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false)
});

export const listProjectNotesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const addProjectDocumentBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(100_000)
});

export type ProjectParams = z.infer<typeof projectParamsSchema>;
export type ProjectDocumentParams = z.infer<typeof projectDocumentParamsSchema>;
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type ListProjectNotesQuery = z.infer<typeof listProjectNotesQuerySchema>;
export type AddProjectDocumentBody = z.infer<typeof addProjectDocumentBodySchema>;
