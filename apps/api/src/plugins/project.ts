import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  AgentPostgresRepository,
  DocumentPostgresRepository,
  HumanPostgresRepository,
  NotePostgresRepository,
  ProjectPostgresRepository
} from '../data';
import { ProjectLogger } from '../observability';
import { ProjectService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    projectService: ProjectService;
  }
}

const projectPlugin: FastifyPluginAsync = async (fastify) => {
  const projectService = new ProjectService(
    new ProjectPostgresRepository(fastify.pg),
    new DocumentPostgresRepository(fastify.pg),
    new NotePostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new ProjectLogger(fastify.log)
  );

  fastify.decorate('projectService', projectService);
};

export default fp(projectPlugin, {
  name: 'project',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
