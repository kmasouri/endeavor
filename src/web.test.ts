import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastify from 'fastify';
import { registerWebApp } from './web';

describe('registerWebApp', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'web-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the built interface at /app/ and sends / there', async () => {
    await writeFile(join(dir, 'index.html'), '<h1>Collaborative Agents</h1>');
    const app = fastify();
    expect(registerWebApp(app, dir)).toBe(true);

    const home = await app.inject({ method: 'GET', url: '/' });
    const page = await app.inject({ method: 'GET', url: '/app/' });

    expect(home.statusCode).toBe(302);
    expect(home.headers.location).toBe('/app/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Collaborative Agents');
    await app.close();
  });

  it('does nothing when the interface has not been built', async () => {
    const app = fastify();
    expect(registerWebApp(app, dir)).toBe(false);

    const home = await app.inject({ method: 'GET', url: '/' });

    expect(home.statusCode).toBe(404);
    await app.close();
  });
});
