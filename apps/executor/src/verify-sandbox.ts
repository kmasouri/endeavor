import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DockerClient } from './docker.ts';

// Deliberate opt-in Docker verification; normal unit tests need no daemon.
const docker = new DockerClient();
const image = 'endeavor-sandbox:local';
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const source = {
  path: 'input.txt',
  base64: Buffer.from('task source').toString('base64'),
  executable: false
};
const script = `const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(process.getuid(), 1000);
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
assert.ok(parsed.files.some((file: { path: string }) => file.path === 'output.txt'));

const failed = await docker.run(randomUUID(), image, { files: [], command: 'exit 5' }).result;
assert.equal(JSON.parse(failed.stdout).exitCode, 5);
const symlink = await docker.run(randomUUID(), image, {
  files: [],
  command: 'ln -s /etc/passwd unsafe'
}).result;
assert.notEqual(symlink.code, 0);
assert.ok(JSON.parse(symlink.stdout).error);
const fresh = await docker.run(randomUUID(), image, { files: [], command: 'test ! -e output.txt' })
  .result;
assert.equal(JSON.parse(fresh.stdout).exitCode, 0);
const cancelled = docker.run(randomUUID(), image, { files: [], command: 'sleep 60' });
await new Promise((resolve) => setTimeout(resolve, 500));
await cancelled.cancel();
assert.notEqual((await cancelled.result).code, 0);
console.log(
  'Sandbox verified: offline execution, non-root user, no host secrets or socket, fresh files, failing checks, unsafe exports, cancellation, and cleanup.'
);
