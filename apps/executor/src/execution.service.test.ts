import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExecutionService } from './execution.service.ts';
import type { ContainerClient, ContainerResult } from './docker.ts';
import { envSchema, filesSchema, pathSchema, type WorkspaceFile } from './schemas.ts';

const file = (path: string, text: string): WorkspaceFile => ({
  path,
  base64: Buffer.from(text).toString('base64'),
  executable: false
});
const initial = [file('index.js', 'original')];
function fakeContainers() {
  const jobs: {
    finish: (
      files?: WorkspaceFile[],
      exitCode?: number,
      code?: number,
      backgroundProcesses?: boolean
    ) => void;
    cancelled: boolean;
    input: unknown;
    task?: string;
  }[] = [];
  let recovered = 0;
  const released: string[] = [];
  const client: ContainerClient = {
    async recover() {
      recovered++;
    },
    async release(task) {
      released.push(task);
    },
    run(_id, _image, input, task) {
      let resolve!: (result: ContainerResult) => void;
      const result = new Promise<ContainerResult>((done) => {
        resolve = done;
      });
      const job = {
        input,
        task,
        cancelled: false,
        finish(files = initial, exitCode = 0, code = 0, backgroundProcesses = false) {
          resolve({
            code,
            stdout: JSON.stringify({ exitCode, log: 'test evidence', files, backgroundProcesses })
          });
        }
      };
      jobs.push(job);
      return {
        result,
        async cancel() {
          job.cancelled = true;
          job.finish([], -1, -1);
        }
      };
    }
  };
  return {
    client,
    jobs,
    released,
    get recovered() {
      return recovered;
    }
  };
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'endeavor-executor-'));
  const containers = fakeContainers();
  const settings = envSchema.parse({ EXECUTOR_TOKEN: 'x'.repeat(32), EXECUTOR_DATA_DIR: dir });
  const source = {
    async snapshot() {
      return { sha: 'a'.repeat(40), archive: 'archive' };
    }
  };
  const service = new ExecutionService(settings, containers.client, source);
  await service.initialize();
  return {
    service,
    containers,
    settings,
    source,
    async cleanup() {
      await service.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
}
async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for execution');
}
async function checkedOut(ctx: Awaited<ReturnType<typeof fixture>>, task: string) {
  const start = (await ctx.service.call(task, 'checkout_repository', {
    repository: 'owner/repo',
    ref: 'main'
  })) as { id: string };
  await until(() => ctx.containers.jobs.length > 0);
  ctx.containers.jobs.at(-1)!.finish();
  await until(
    async () =>
      (
        (await ctx.service.call(task, 'get_execution', { execution_id: start.id })) as {
          status: string;
        }
      ).status === 'finished'
  );
  return start;
}

test('isolates task identities and rejects invalid paths and snapshots', async () => {
  for (const path of [
    '../secret',
    '/etc/passwd',
    'a/../../b',
    'a\\b',
    '.git/config',
    'node_modules/a',
    'a\u0000b'
  ])
    assert.equal(pathSchema.safeParse(path).success, false);
  assert.equal(filesSchema.safeParse([file('a', 'one'), file('a', 'two')]).success, false);
  const ctx = await fixture();
  try {
    const owner = randomUUID();
    const job = await checkedOut(ctx, owner);
    await assert.rejects(
      ctx.service.call(randomUUID(), 'get_execution', { execution_id: job.id }),
      /does not belong/
    );
    await assert.rejects(
      ctx.service.call(owner, 'write_repository_file', {
        path: 'x',
        content: 'x',
        task_id: randomUUID()
      })
    );
    await assert.rejects(ctx.service.call('../escape', 'list_executions', {}));
  } finally {
    await ctx.cleanup();
  }
});

test('records failing checks, binds evidence to revision, and reports changes against the base', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    await ctx.service.call(task, 'write_repository_file', { path: 'index.js', content: 'fixed' });
    const job = (await ctx.service.call(task, 'run_command', { command: 'npm test' })) as {
      id: string;
    };
    await assert.rejects(
      ctx.service.call(task, 'write_repository_file', { path: 'index.js', content: 'racing edit' }),
      /Wait for/
    );
    ctx.containers.jobs.at(-1)!.finish([file('index.js', 'fixed')], 1);
    await until(
      async () =>
        (
          (await ctx.service.call(task, 'get_execution', { execution_id: job.id })) as {
            status: string;
          }
        ).status === 'finished'
    );
    const result = (await ctx.service.call(task, 'get_execution', { execution_id: job.id })) as {
      exitCode: number;
      revision: number;
      currentRevision: number;
      sha: string;
    };
    assert.equal(result.exitCode, 1);
    assert.equal(result.revision, result.currentRevision);
    assert.equal(result.sha, 'a'.repeat(40));
    await ctx.service.call(task, 'write_repository_file', { path: 'new.js', content: 'new' });
    const stale = (await ctx.service.call(task, 'get_execution', {
      execution_id: job.id
    })) as typeof result;
    assert.notEqual(stale.revision, stale.currentRevision);
    const changes = (await ctx.service.call(task, 'repository_changes', {})) as {
      changed: { path: string }[];
      deleted: string[];
    };
    assert.deepEqual(
      changes.changed.map((change) => change.path),
      ['index.js', 'new.js']
    );
    await ctx.service.call(task, 'delete_repository_file', { path: 'index.js' });
    assert.deepEqual(
      ((await ctx.service.call(task, 'repository_changes', {})) as { deleted: string[] }).deleted,
      ['index.js']
    );
  } finally {
    await ctx.cleanup();
  }
});

test('cancelled and invalid exports preserve the last committed checkout', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const job = (await ctx.service.call(task, 'run_command', { command: 'sleep 100' })) as {
      id: string;
    };
    await ctx.service.call(task, 'cancel_execution', { execution_id: job.id });
    assert.equal(ctx.containers.jobs.at(-1)!.cancelled, true);
    await until(async () => {
      try {
        await ctx.service.call(task, 'read_repository_file', { path: 'index.js' });
        return true;
      } catch {
        return false;
      }
    });
    const bad = (await ctx.service.call(task, 'run_command', { command: 'bad snapshot' })) as {
      id: string;
    };
    ctx.containers.jobs.at(-1)!.finish([file('../outside', 'evil')]);
    await until(
      async () =>
        (
          (await ctx.service.call(task, 'get_execution', { execution_id: bad.id })) as {
            status: string;
          }
        ).status === 'failed'
    );
    assert.equal(
      (
        (await ctx.service.call(task, 'read_repository_file', { path: 'index.js' })) as {
          content: string;
        }
      ).content,
      'original'
    );
    const jobs = (await ctx.service.call(task, 'list_executions', {})) as { id: string }[];
    assert.equal(
      jobs.some((entry) => entry.id === bad.id),
      true
    );
  } finally {
    await ctx.cleanup();
  }
});

test('successful verification requires unchanged files and long source remains readable in pages', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const changed = (await ctx.service.call(task, 'run_command', {
      command: 'generate-and-test'
    })) as { id: string };
    ctx.containers.jobs
      .at(-1)!
      .finish([
        file('index.js', 'changed during tests'),
        file('generated/report.json', 'temporary')
      ]);
    await until(
      async () =>
        (
          (await ctx.service.call(task, 'get_execution', { execution_id: changed.id })) as {
            status: string;
          }
        ).status === 'finished'
    );
    const invalid = (await ctx.service.call(task, 'get_execution', {
      execution_id: changed.id
    })) as { workspaceChanged: boolean; verifiedRevision: number | null };
    assert.equal(invalid.workspaceChanged, true);
    assert.equal(invalid.verifiedRevision, null);
    await assert.rejects(
      ctx.service.call(task, 'read_repository_file', { path: 'generated/report.json' }),
      /does not exist/
    );
    const verified = (await ctx.service.call(task, 'run_command', { command: 'test' })) as {
      id: string;
    };
    ctx.containers.jobs.at(-1)!.finish([file('index.js', 'changed during tests')]);
    await until(
      async () =>
        (
          (await ctx.service.call(task, 'get_execution', { execution_id: verified.id })) as {
            status: string;
          }
        ).status === 'finished'
    );
    const valid = (await ctx.service.call(task, 'get_execution', {
      execution_id: verified.id
    })) as { verifiedRevision: number; currentRevision: number };
    assert.equal(valid.verifiedRevision, valid.currentRevision);
    await ctx.service.call(task, 'write_repository_file', {
      path: 'long.ts',
      content: 'a'.repeat(8000) + 'last page'
    });
    const first = (await ctx.service.call(task, 'read_repository_file', { path: 'long.ts' })) as {
      content: string;
      nextOffset: number;
    };
    assert.equal(first.content.length, 8000);
    const last = (await ctx.service.call(task, 'read_repository_file', {
      path: 'long.ts',
      offset: first.nextOffset
    })) as { content: string; nextOffset: null };
    assert.equal(last.content, 'last page');
    assert.equal(last.nextOffset, null);
    const stale = (await ctx.service.call(task, 'get_execution', {
      execution_id: verified.id
    })) as typeof valid;
    assert.notEqual(stale.verifiedRevision, stale.currentRevision);
  } finally {
    await ctx.cleanup();
  }
});

test('recovery cleans labelled containers and marks in-flight outcomes unknown without replay', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const job = (await ctx.service.call(task, 'run_command', { command: 'npm test' })) as {
      id: string;
    };
    const recovered = new ExecutionService(ctx.settings, ctx.containers.client, ctx.source);
    await recovered.initialize();
    const result = (await recovered.call(task, 'get_execution', { execution_id: job.id })) as {
      status: string;
      error: string;
    };
    assert.equal(result.status, 'interrupted');
    assert.match(result.error, /unknown/);
    assert.equal(ctx.containers.recovered, 2);
    assert.equal(ctx.containers.jobs.length, 2);
  } finally {
    await ctx.cleanup();
  }
});

test('read probes do not reserve workspaces and discard releases a slot', async () => {
  const ctx = await fixture();
  const tasks: string[] = [];
  try {
    for (let i = 0; i < 8; i++)
      assert.deepEqual(await ctx.service.call(randomUUID(), 'list_executions', {}), []);
    for (let i = 0; i < 4; i++) {
      const task = randomUUID();
      tasks.push(task);
      await checkedOut(ctx, task);
    }
    await assert.rejects(
      ctx.service.call(randomUUID(), 'checkout_repository', {
        repository: 'owner/repo',
        ref: 'main'
      }),
      /workspace limit/
    );
    await ctx.service.call(tasks[0], 'discard_repository', {});
    await checkedOut(ctx, randomUUID());
  } finally {
    await ctx.cleanup();
  }
});

test('a waiting status read never holds the cancellation lock', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const job = (await ctx.service.call(task, 'run_command', { command: 'sleep 60' })) as {
      id: string;
    };
    const started = Date.now();
    const waiting = ctx.service.call(task, 'get_execution', {
      execution_id: job.id,
      wait_seconds: 20
    });
    await ctx.service.call(task, 'cancel_execution', { execution_id: job.id });
    assert.equal(((await waiting) as { status: string }).status, 'cancelled');
    assert.ok(Date.now() - started < 5000);
  } finally {
    await ctx.cleanup();
  }
});

test('commands share only their task workspace and synchronize explicit file edits', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  const other = randomUUID();
  async function run(taskId: string) {
    const start = (await ctx.service.call(taskId, 'run_command', { command: 'test' })) as {
      id: string;
    };
    const job = ctx.containers.jobs.at(-1)!;
    assert.equal(job.task, taskId);
    job.finish((job.input as { files: WorkspaceFile[] }).files);
    await until(
      async () =>
        (
          (await ctx.service.call(taskId, 'get_execution', { execution_id: start.id })) as {
            status: string;
          }
        ).status === 'finished'
    );
    return job;
  }
  try {
    await checkedOut(ctx, task);
    await checkedOut(ctx, other);
    assert.equal(ctx.containers.jobs[0].task, undefined);
    assert.deepEqual((await run(task)).input, {
      files: initial,
      updates: [],
      deleted: [],
      command: 'test'
    });
    await ctx.service.call(task, 'write_repository_file', { path: 'new.js', content: 'added' });
    const edited = await run(task);
    assert.deepEqual((edited.input as { updates: string[] }).updates, ['new.js']);
    assert.deepEqual((await run(other)).input, {
      files: initial,
      updates: [],
      deleted: [],
      command: 'test'
    });
    assert.deepEqual((await run(task)).input, {
      files: [initial[0], file('new.js', 'added')],
      updates: [],
      deleted: [],
      command: 'test'
    });
    await ctx.service.call(task, 'delete_repository_file', { path: 'new.js' });
    assert.deepEqual(((await run(task)).input as { deleted: string[] }).deleted, ['new.js']);
    const releases = ctx.containers.released.length;
    await checkedOut(ctx, task);
    assert.deepEqual(ctx.containers.released.slice(releases), [task]);
    await ctx.service.call(task, 'discard_repository', {});
    assert.equal(ctx.containers.released.at(-1), task);
  } finally {
    await ctx.cleanup();
  }
});

test('idle cleanup releases containers while retaining source until checkout expiry', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const records = (ctx.service as unknown as { records: Map<string, { touchedAt: number }> })
      .records;
    records.get(task)!.touchedAt = Date.now() - 1_800_001;
    await ctx.service.cleanup();
    assert.equal(ctx.containers.released.at(-1), task);
    assert.equal(
      (
        (await ctx.service.call(task, 'read_repository_file', { path: 'index.js' })) as {
          content: string;
        }
      ).content,
      'original'
    );
    records.get(task)!.touchedAt = Date.now() - 86_400_001;
    await ctx.service.cleanup();
    await assert.rejects(
      ctx.service.call(task, 'read_repository_file', { path: 'index.js' }),
      /Check out/
    );
  } finally {
    await ctx.cleanup();
  }
});

test('background work cannot certify a source revision', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const job = (await ctx.service.call(task, 'run_command', {
      command: 'start server and test'
    })) as { id: string };
    ctx.containers.jobs.at(-1)!.finish(initial, 0, 0, true);
    await until(
      async () =>
        (
          (await ctx.service.call(task, 'get_execution', { execution_id: job.id })) as {
            status: string;
          }
        ).status === 'finished'
    );
    const result = (await ctx.service.call(task, 'get_execution', { execution_id: job.id })) as {
      verifiedRevision: null;
      backgroundProcesses: boolean;
    };
    assert.equal(result.backgroundProcesses, true);
    assert.equal(result.verifiedRevision, null);
  } finally {
    await ctx.cleanup();
  }
});

test('failed workspace cleanup records failure and releases the task lock for retry', async () => {
  const ctx = await fixture();
  const task = randomUUID();
  try {
    await checkedOut(ctx, task);
    const release = ctx.containers.client.release;
    ctx.containers.client.release = async () => {
      throw new Error('daemon unavailable');
    };
    const job = (await ctx.service.call(task, 'run_command', { command: 'invalid export' })) as {
      id: string;
    };
    ctx.containers.jobs.at(-1)!.finish([file('../bad', 'invalid')]);
    await until(
      async () =>
        (
          (await ctx.service.call(task, 'get_execution', { execution_id: job.id })) as {
            status: string;
          }
        ).status === 'failed'
    );
    assert.equal(
      (
        (await ctx.service.call(task, 'read_repository_file', { path: 'index.js' })) as {
          content: string;
        }
      ).content,
      'original'
    );
    ctx.containers.client.release = release;
  } finally {
    await ctx.cleanup();
  }
});
