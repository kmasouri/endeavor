import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const qualityOnly = process.argv.includes('--quality');
const root = fileURLToPath(new URL('../', import.meta.url));
const logs = await mkdtemp(join(tmpdir(), 'endeavor-check-'));
const started = performance.now();
const results = [];
const children = new Set();
console.log(`Check logs: ${logs}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
  });
}

async function run(name, args) {
  const start = performance.now();
  const path = join(logs, `${name}.log`);
  const output = createWriteStream(path);
  console.log(`Starting ${name}`);
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.add(child);
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const code = await new Promise((resolve) => {
    child.on('error', (error) => {
      output.write(`${error}\n`);
      resolve(1);
    });
    child.on('close', (status) => resolve(status ?? 1));
  });
  children.delete(child);
  await new Promise((resolve) => output.end(resolve));
  const seconds = Math.round((performance.now() - start) / 100) / 10;
  results.push({ name, seconds, code, log: path });
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name}: ${seconds}s`);
  if (code !== 0) console.error(await readFile(path, 'utf8'));
  return code === 0;
}

// Only browser tests depend on a build. All other checks can start immediately.
await Promise.all([
  run('lint', ['run', 'lint']),
  run('types', ['run', 'typecheck']),
  run('unit', ['test']),
  run('build-api-executor', ['run', 'build', '--workspace=apps/api', '--workspace=apps/executor']),
  (async () => {
    if (await run('build-web', ['run', 'build', '--workspace=apps/web'])) {
      if (!qualityOnly && !process.exitCode) {
        await run('browser', ['run', 'test:e2e', '--workspace=apps/web']);
      }
    }
  })()
]);

const seconds = Math.round((performance.now() - started) / 100) / 10;
await writeFile(join(logs, 'results.json'), JSON.stringify({ seconds, results }, null, 2) + '\n');
console.log(`Total: ${seconds}s`);
if (results.some((result) => result.code !== 0)) process.exitCode ||= 1;
