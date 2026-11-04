import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  AddProjectDocumentBody,
  CreateProjectBody,
  ListProjectNotesQuery,
  ListProjectsQuery,
  ProjectDocumentParams,
  ProjectParams,
  UpdateProjectBody
} from '../../schemas';
import { paged, success } from '../../shared/response';

export async function createProjectHandler(
  request: FastifyRequest<{ Body: CreateProjectBody; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const project = await request.server.projectService.createProject(
    request.headers['x-actor-id'],
    request.body
  );
  return reply.code(201).send(success(project));
}

export async function listProjectsHandler(
  request: FastifyRequest<{ Querystring: ListProjectsQuery; Headers: ActorHeaders }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { projects, total } = await request.server.projectService.listProjects(
    request.headers['x-actor-id'],
    request.query
  );
  return paged(projects, { limit, offset, total });
}

export async function getProjectHandler(
  request: FastifyRequest<{ Params: ProjectParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.projectService.getProject(
      request.headers['x-actor-id'],
      request.params.projectId
    )
  );
}

export async function updateProjectHandler(
  request: FastifyRequest<{
    Params: ProjectParams;
    Body: UpdateProjectBody;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.projectService.updateProject(
      request.headers['x-actor-id'],
      request.params.projectId,
      request.body
    )
  );
}

export async function addProjectDocumentHandler(
  request: FastifyRequest<{
    Params: ProjectParams;
    Body: AddProjectDocumentBody;
    Headers: ActorHeaders;
  }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const document = await request.server.projectService.addDocument(
    request.headers['x-actor-id'],
    request.params.projectId,
    request.body
  );
  return reply.code(201).send(success(document));
}

export async function listProjectDocumentsHandler(
  request: FastifyRequest<{ Params: ProjectParams; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.projectService.listDocuments(
      request.headers['x-actor-id'],
      request.params.projectId
    )
  );
}

export async function deleteProjectDocumentHandler(
  request: FastifyRequest<{ Params: ProjectDocumentParams; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  await request.server.projectService.deleteDocument(
    request.headers['x-actor-id'],
    request.params.projectId,
    request.params.documentId
  );
  return reply.code(204).send();
}

export async function listProjectNotesHandler(
  request: FastifyRequest<{
    Params: ProjectParams;
    Querystring: ListProjectNotesQuery;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  const { limit, offset } = request.query;
  const { notes, total } = await request.server.projectService.listNotes(
    request.headers['x-actor-id'],
    request.params.projectId,
    request.query
  );
  return paged(notes, { limit, offset, total });
}
