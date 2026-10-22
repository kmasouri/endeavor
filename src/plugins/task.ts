import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AgentPostgresRepository, HumanPostgresRepository, TaskPostgresRepository } from '../data';
import { TaskLogger } from '../observability';
import { TaskService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    taskService: TaskService;
  }
}

const taskPlugin: FastifyPluginAsync = async (fastify) => {
  const taskService = new TaskService(
    new TaskPostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new TaskLogger(fastify.log)
  );

  fastify.decorate('taskService', taskService);
};

export default fp(taskPlugin, {
  name: 'task',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
