import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildServer } from './server.ts';
import { ExecutionService } from './execution.service.ts';
import { envSchema } from './schemas.ts';
import { containerArgs } from './docker.ts';

test('speaks MCP to the installed client and requires trusted task identity for calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'endeavor-mcp-executor-'));
  const settings = envSchema.parse({ EXECUTOR_TOKEN: 'z'.repeat(32), EXECUTOR_DATA_DIR: dir });
  const service = new ExecutionService(
    settings,
    {
      async recover() {},
      run() {
        throw new Error('not used');
      }
    },
    {
      async snapshot() {
        throw new Error('not used');
      }
    }
  );
  await service.initialize();
  const app = buildServer(service, settings.EXECUTOR_TOKEN);
  const client = new Client(
    { name: 'executor-test', version: '1' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } }
  );
  try {
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    assert.equal((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode, 401);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${settings.EXECUTOR_TOKEN}` } }
      })
    );
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'run_command'));
    const missing = await client.callTool({ name: 'list_executions', arguments: {} });
    assert.equal(missing.isError, true);
    await client.close();
    const scoped = new Client(
      { name: 'scoped', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } }
    );
    try {
      await scoped.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${settings.EXECUTOR_TOKEN}`,
              'X-Endeavor-Task-Id': randomUUID()
            }
          }
        })
      );
      const valid = await scoped.callTool({ name: 'list_executions', arguments: {} });
      assert.notEqual(valid.isError, true);
      const spoof = await scoped.callTool({
        name: 'list_executions',
        arguments: { task_id: randomUUID() }
      });
      assert.equal(spoof.isError, true);
    } finally {
      await scoped.close();
    }
  } finally {
    await client.close();
    await app.close();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('container policy refuses network, mounts, privileges, and unlimited resources', () => {
  const args = containerArgs(randomUUID(), 'endeavor-sandbox:local');
  for (const [option, expected] of [
    ['--network', 'none'],
    ['--user', '1000:1000'],
    ['--cap-drop', 'ALL'],
    ['--security-opt', 'no-new-privileges'],
    ['--memory', '1024m'],
    ['--pids-limit', '256'],
    ['--cpus', '1']
  ])
    assert.equal(args[args.indexOf(option) + 1], expected);
  assert.ok(args.includes('--read-only'));
  for (const forbidden of ['--volume', '-v', '--mount', '--privileged', '--pid', '--device'])
    assert.equal(args.includes(forbidden), false);
});
