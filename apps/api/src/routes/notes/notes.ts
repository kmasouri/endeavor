import { FastifyInstance } from 'fastify';
import { deleteNoteHandler, listNotesHandler, updateNoteHandler } from '../../handlers';
import {
  actorHeadersSchema,
  agentNotesParamsSchema,
  listNotesQuerySchema,
  noteParamsSchema,
  updateNoteBodySchema
} from '../../schemas';

export async function notesRouter(fastifyInstance: FastifyInstance): Promise<void> {
  fastifyInstance.get(
    '/agents/:agentId/notes',
    {
      schema: {
        description:
          "An agent's saved notes (agent memory), newest first, with where each came from. Notes are the agent's observations, not approved facts. Admins see all; members see notes from their conversations and agent-wide ones.",
        tags: ['notes'],
        headers: actorHeadersSchema,
        params: agentNotesParamsSchema,
        querystring: listNotesQuerySchema
      }
    },
    listNotesHandler
  );

  fastifyInstance.patch(
    '/agents/:agentId/notes/:noteId',
    {
      schema: {
        description:
          "Correct a note, or (admins only) change its scope. 'agent' makes it show in all the agent's tasks.",
        tags: ['notes'],
        headers: actorHeadersSchema,
        params: noteParamsSchema,
        body: updateNoteBodySchema
      }
    },
    updateNoteHandler
  );

  fastifyInstance.delete(
    '/agents/:agentId/notes/:noteId',
    {
      schema: {
        description: 'Delete a note. The agent stops seeing it on its next run.',
        tags: ['notes'],
        headers: actorHeadersSchema,
        params: noteParamsSchema
      }
    },
    deleteNoteHandler
  );
}
