import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  AgentPostgresRepository,
  ConversationPostgresRepository,
  HumanPostgresRepository,
  NotePostgresRepository
} from '../data';
import { NoteLogger } from '../observability';
import { NoteService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    noteService: NoteService;
  }
}

const notePlugin: FastifyPluginAsync = async (fastify) => {
  const noteService = new NoteService(
    new NotePostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new ConversationPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new NoteLogger(fastify.log)
  );

  fastify.decorate('noteService', noteService);
};

export default fp(notePlugin, {
  name: 'note',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
