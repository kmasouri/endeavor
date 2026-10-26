// This file lives in the read-only image. Repository code runs only below /workspace.
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const deadline = setTimeout(() => process.exit(124), 295_000);
deadline.unref();
const maxBytes = 20_000_000;
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 32_000_000) throw new Error('Input too large');
}
const input = JSON.parse(raw);
let log = '';
function run(command, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) } });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const append = (chunk) => { log = (log + chunk.toString()).slice(0, 16_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

try {
  let exitCode = 0;
  if (input.archive) {
    exitCode = await run('tar', ['-xz', '--strip-components=1', '-f', '-'], Buffer.from(input.archive, 'base64'));
    if (exitCode !== 0) throw new Error('Archive extraction failed');
    const submodules = await lstat('/workspace/.gitmodules').then(() => true, () => false);
    if (submodules) throw new Error('Submodules are unsupported');
  } else {
    for (const file of input.files) {
      const parts = file.path.split('/');
      if (parts.some((p) => !p || p === '.' || p === '..' || p === '.git' || p === 'node_modules') || /[\\\x00-\x1f]/.test(file.path)) throw new Error('Invalid path');
      const path = join('/workspace', file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(file.base64, 'base64'), { mode: file.executable ? 0o755 : 0o644 });
    }
    // An operator may provide a project-specific image with offline dependencies here.
    try {
      await lstat('/opt/node_modules');
      await mkdir('/workspace/node_modules');
      for (const name of await readdir('/opt/node_modules')) {
        await symlink(join('/opt/node_modules', name), join('/workspace/node_modules', name));
      }
    } catch { /* The base image supports dependency-free projects. */ }
    const cpu = (await readFile('/proc/self/status', 'utf8')).match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1];
    if (!cpu) throw new Error('CPU affinity is unavailable');
    exitCode = await run('taskset', ['-c', cpu, '/bin/sh', '-c', input.command]);
  }
  const sourcePaths = new Set((input.files ?? []).map((file) => file.path));
  const files = [];
  let bytes = 0;
  async function scan(folder, depth = 0) {
    if (depth > 30) throw new Error('Workspace nesting exceeds limit');
    for (const name of await readdir(join('/workspace', folder))) {
      if (name === 'node_modules' || name === '.git') {
        if (input.archive) throw new Error('Vendored runtime metadata is unsupported');
        continue;
      }
      const relative = folder ? `${folder}/${name}` : name;
      if (!input.archive && !sourcePaths.has(relative) && !Array.from(sourcePaths).some((path) => path.startsWith(relative + '/'))) continue;
      const path = join('/workspace', relative);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Links and special files cannot be exported');
      if (stat.isDirectory()) { await scan(relative, depth + 1); continue; }
      bytes += stat.size;
      if (bytes > maxBytes || stat.size > 2_000_000 || files.length >= 2500) throw new Error('Workspace exceeds export limit');
      const content = await readFile(path);
      files.push({ path: relative, base64: content.toString('base64'), executable: !!(stat.mode & 0o111) });
    }
  }
  await scan('');
  process.stdout.write(JSON.stringify({ exitCode, log, files }));
} catch {
  process.stdout.write(JSON.stringify({ error: 'Execution or workspace export failed. Links, special files, and oversized workspaces are unsupported.', log }));
  process.exitCode = 1;
}
