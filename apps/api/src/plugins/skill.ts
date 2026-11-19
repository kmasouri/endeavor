import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import { CatalogPostgresRepository, CredentialCipher, HumanPostgresRepository } from '../data';
import { SkillLogger } from '../observability';
import { SkillService } from '../services';

declare module 'fastify' {
  interface FastifyInstance {
    skillService: SkillService;
  }
}

const skillPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'skillService',
    new SkillService(
      new CatalogPostgresRepository(fastify.pg, new CredentialCipher(config.CREDENTIALS_KEY)),
      new HumanPostgresRepository(fastify.pg),
      new SkillLogger(fastify.log)
    )
  );
};

export default fp(skillPlugin, {
  name: 'skill',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
