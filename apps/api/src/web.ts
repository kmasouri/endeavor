import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { FastifyInstance } from 'fastify';

// The web interface lives at /app/ so its pages never clash with API paths like /agents.
export const WEB_PREFIX = '/app/';

// Serves the web interface (apps/web), once Vite has built it into apps/web/dist. Without a
// build, nothing is served; use `npm run dev:web` for the interface with live reload.
export function registerWebApp(app: FastifyInstance, dir: string): boolean {
  if (!existsSync(join(dir, 'index.html'))) {
    return false;
  }
  app.register(fastifyStatic, { root: dir, prefix: WEB_PREFIX });
  app.get('/', { schema: { hide: true } }, (_request, reply) => reply.redirect(WEB_PREFIX));
  app.get('/app', { schema: { hide: true } }, (_request, reply) => reply.redirect(WEB_PREFIX));
  return true;
}
