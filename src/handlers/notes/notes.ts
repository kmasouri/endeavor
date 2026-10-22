import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ActorHeaders,
  AgentNotesParams,
  ListNotesQuery,
  NoteParams,
  UpdateNoteBody
} from '../../schemas';
import { success } from '../../shared/response';

export async function listNotesHandler(
  request: FastifyRequest<{
    Params: AgentNotesParams;
    Querystring: ListNotesQuery;
    Headers: ActorHeaders;
  }>
): Promise<unknown> {
  return success(
    await request.server.noteService.listNotes(
      request.headers['x-actor-id'],
      request.params.agentId,
      request.query
    )
  );
}

export async function updateNoteHandler(
  request: FastifyRequest<{ Params: NoteParams; Body: UpdateNoteBody; Headers: ActorHeaders }>
): Promise<unknown> {
  return success(
    await request.server.noteService.updateNote(
      request.headers['x-actor-id'],
      request.params.noteId,
      request.body
    )
  );
}

export async function deleteNoteHandler(
  request: FastifyRequest<{ Params: NoteParams; Headers: ActorHeaders }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  await request.server.noteService.deleteNote(request.headers['x-actor-id'], request.params.noteId);
  return reply.code(204).send();
}
