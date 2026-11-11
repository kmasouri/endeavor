import { FastifyInstance } from 'fastify';
import {
  addProjectDocumentHandler,
  createProjectHandler,
  deleteProjectDocumentHandler,
  getProjectHandler,
  listProjectDocumentsHandler,
  listProjectNotesHandler,
  listProjectsHandler,
  updateProjectHandler
} from '../../handlers';
import {
  actorHeadersSchema,
  addProjectDocumentBodySchema,
  createProjectBodySchema,
  listProjectNotesQuerySchema,
  listProjectsQuerySchema,
  projectDocumentParamsSchema,
  projectParamsSchema,
  updateProjectBodySchema
} from '../../schemas';

export async function projectsRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.post(
    '/projects',
    {
      schema: {
        description:
          'Create a project: a long-lived group of endeavors that holds knowledge sources, saved notes, and default members. Optional about text (up to 5,000 characters) supplies background for every endeavor; null or blank means none. Optional icon and color set the project’s appearance. You become a default member; agentIds and humanIds add more.',
        tags: ['projects'],
        headers: actorHeadersSchema,
        body: createProjectBodySchema
      }
    },
    createProjectHandler
  );

  fastifyInstance.get(
    '/projects',
    {
      schema: {
        description:
          'Projects, newest first. Archived projects are listed only with archived=true. While roles are off, every person sees all of them.',
        tags: ['projects'],
        headers: actorHeadersSchema,
        querystring: listProjectsQuerySchema
      }
    },
    listProjectsHandler
  );

  fastifyInstance.get(
    '/projects/:projectId',
    {
      schema: {
        description: 'Get a project with its optional about text and default people and agents.',
        tags: ['projects'],
        headers: actorHeadersSchema,
        params: projectParamsSchema
      }
    },
    getProjectHandler
  );

  fastifyInstance.patch(
    '/projects/:projectId',
    {
      schema: {
        description:
          'Rename a project, update its icon or color (null resets), set or clear its optional About text (about: null or blank clears it; omitted preserves it; up to 5,000 characters), replace its default agents or people (for endeavors started afterwards), or archive (archived: true) and restore it. The default project cannot be archived.',
        tags: ['projects'],
        headers: actorHeadersSchema,
        params: projectParamsSchema,
        body: updateProjectBodySchema
      }
    },
    updateProjectHandler
  );

  fastifyInstance.post(
    '/projects/:projectId/documents',
    {
      schema: {
        description:
          "Attach a document as a knowledge source for every endeavor in the project. Agents read it but can't change it.",
        tags: ['projects'],
        headers: actorHeadersSchema,
        params: projectParamsSchema,
        body: addProjectDocumentBodySchema
      }
    },
    addProjectDocumentHandler
  );

  fastifyInstance.get(
    '/projects/:projectId/documents',
    {
      schema: {
        description:
          'Documents shared by every endeavor in the project, newest first. Documents limited to one endeavor are listed on that endeavor.',
        tags: ['projects'],
        headers: actorHeadersSchema,
        params: projectParamsSchema
      }
    },
    listProjectDocumentsHandler
  );

  fastifyInstance.delete(
    '/projects/:projectId/documents/:documentId',
    {
      schema: {
        description: 'Remove a document. Agents stop seeing it on their next run.',
        tags: ['projects'],
        headers: actorHeadersSchema,
        params: projectDocumentParamsSchema
      }
    },
    deleteProjectDocumentHandler
  );

  fastifyInstance.get(
    '/projects/:projectId/notes',
    {
      schema: {
        description:
          "Notes agents saved for the whole project, newest first. Fix or delete one through its agent's notes.",
        tags: ['projects'],
        headers: actorHeadersSchema,
        params: projectParamsSchema,
        querystring: listProjectNotesQuerySchema
      }
    },
    listProjectNotesHandler
  );
}
