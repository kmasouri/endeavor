import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DockerClient } from './docker.ts';

// Deliberate opt-in Docker verification; normal unit tests need no daemon.
const docker = new DockerClient();
const image = process.argv[2] ?? 'endeavor-sandbox:local';
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const source = {
  path: 'input.txt',
  base64: Buffer.from('task source').toString('base64'),
  executable: false
};
const script = `const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(process.getuid(), 1000);
assert.equal(require('node:os').availableParallelism(), 1);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
assert.equal(fs.existsSync('/app/.env'), false);
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.EXECUTOR_GITHUB_TOKEN, undefined);
assert.throws(() => fs.writeFileSync('/root/should-not-exist', 'x'));
assert.equal(fs.readFileSync('input.txt', 'utf8'), 'task source');
fs.writeFileSync('output.txt', 'verified');
fetch('https://registry.npmjs.org', {signal: AbortSignal.timeout(1000)})
  .then(() => { process.exitCode = 1; }, () => console.log('offline isolation verified'));`;
const result = await docker.run(randomUUID(), image, {
  files: [source],
  command: `node -e ${quote(script)}`
}).result;
assert.equal(result.code, 0);
const parsed = JSON.parse(result.stdout);
assert.equal(parsed.exitCode, 0);
assert.match(parsed.log, /offline isolation verified/);
assert.equal(
  parsed.files.some((file: { path: string }) => file.path === 'output.txt'),
  false
);

const failed = await docker.run(randomUUID(), image, { files: [], command: 'exit 5' }).result;
assert.equal(JSON.parse(failed.stdout).exitCode, 5);
const symlink = await docker.run(randomUUID(), image, {
  files: [source],
  command: 'rm input.txt && ln -s /etc/passwd input.txt'
}).result;
assert.notEqual(symlink.code, 0);
assert.ok(JSON.parse(symlink.stdout).error);
const fresh = await docker.run(randomUUID(), image, { files: [], command: 'test ! -e output.txt' })
  .result;
assert.equal(JSON.parse(fresh.stdout).exitCode, 0);
const cancelled = docker.run(randomUUID(), image, { files: [], command: 'sleep 60' });
await cancelled.cancel();
assert.notEqual((await cancelled.result).code, 0);
console.log(
  'Sandbox verified: offline execution, non-root user, no host secrets or socket, fresh files, failing checks, unsafe exports, cancellation, and cleanup.'
);

const task = randomUUID();
const other = randomUUID();
async function command(
  taskId: string,
  command: string,
  files = [source],
  updates: string[] = [],
  deleted: string[] = []
) {
  const result = await docker.run(randomUUID(), image, { files, updates, deleted, command }, taskId)
    .result;
  assert.equal(result.code, 0, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.exitCode, 0, output.log);
  return { ...output, workspaceReset: result.workspaceReset };
}
try {
  const first = await command(
    task,
    'mkdir -p node_modules/local dist && echo dependency > node_modules/local/index.js && echo build > dist/output && echo cache > /tmp/cache; sleep 120 >/tmp/server.log 2>&1 &'
  );
  assert.equal(first.workspaceReset, true);
  const second = await command(
    task,
    'test -f node_modules/local/index.js && test -f dist/output && test -f /tmp/cache && pgrep sleep'
  );
  assert.equal(second.workspaceReset, false);
  assert.equal(second.backgroundProcesses, true);
  await command(
    other,
    'test ! -e node_modules/local/index.js && test ! -e dist/output && test ! -e /tmp/cache'
  );
  const updated = { ...source, base64: Buffer.from('edited source').toString('base64') };
  await command(
    task,
    'test "$(cat input.txt)" = "edited source" && test -f dist/output',
    [updated],
    ['input.txt']
  );
  await command(task, 'test ! -e input.txt && test -f dist/output', [], [], ['input.txt']);
  await docker.release(task);
  const reset = await command(task, 'test ! -e dist/output && test ! -e /tmp/cache');
  assert.equal(reset.workspaceReset, true);
  assert.equal(reset.backgroundProcesses, false);
  const running = docker.run(
    randomUUID(),
    image,
    { files: [source], updates: [], command: 'sleep 60' },
    task
  );
  await running.cancel();
  assert.notEqual((await running.result).code, 0);
  assert.equal((await command(task, 'test ! -e dist/output')).workspaceReset, true);
} finally {
  await docker.release(task);
  await docker.release(other);
}
console.log(
  'Task workspaces verified: reuse, dependencies, build output, background processes, file updates/deletes, isolation, cancellation, recreation, and cleanup.'
);
