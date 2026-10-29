// This file lives in the read-only image. Repository code runs only below /workspace.
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
  unlink,
  chmod
} from 'node:fs/promises';
import { join } from 'node:path';

const deadline = setTimeout(() => process.exit(124), 595_000);
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
    const child = spawn(command, args, {
      cwd: '/workspace',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp',
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH
          ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
          : {})
      }
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const append = (chunk) => {
      log = (log + chunk.toString()).slice(0, 16_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', reject);
    child.on('exit', (code) => {
      // Background servers may inherit these pipes. They must not hold the command open.
      setImmediate(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        resolve(code ?? -1);
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

try {
  let exitCode = 0;
  if (input.archive) {
    exitCode = await run(
      'tar',
      ['-xz', '--strip-components=1', '-f', '-'],
      Buffer.from(input.archive, 'base64')
    );
    if (exitCode !== 0) throw new Error('Archive extraction failed');
    const submodules = await lstat('/workspace/.gitmodules').then(
      () => true,
      () => false
    );
    if (submodules) throw new Error('Submodules are unsupported');
  } else {
    async function safePath(relative) {
      const parts = relative.split('/');
      if (
        parts.some((p) => !p || p === '.' || p === '..' || p === '.git' || p === 'node_modules') ||
        /[\\\x00-\x1f]/.test(relative)
      )
        throw new Error('Invalid path');
      let path = '/workspace';
      for (let i = 0; i < parts.length; i++) {
        path = join(path, parts[i]);
        const stat = await lstat(path).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (
          stat?.isSymbolicLink() ||
          (stat && !(i === parts.length - 1 ? stat.isFile() : stat.isDirectory()))
        )
          throw new Error('Unsafe workspace path');
        if (i < parts.length - 1 && !stat) await mkdir(path);
      }
      return path;
    }
    for (const relative of input.deleted ?? []) {
      const path = await safePath(relative);
      await unlink(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    const updatePaths = new Set(input.updates ?? []);
    const updates =
      input.persistent && !input.initialize
        ? input.files.filter((file) => updatePaths.has(file.path))
        : input.files;
    for (const file of updates) {
      const path = await safePath(file.path);
      const content = Buffer.from(file.base64, 'base64');
      const existing = await readFile(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!existing?.equals(content)) await writeFile(path, content, { flag: 'w' });
      await chmod(path, file.executable ? 0o755 : 0o644);
    }
    // An operator may provide a project-specific image with offline dependencies here.
    if (!input.persistent || input.initialize)
      try {
        await lstat('/opt/node_modules');
        await mkdir('/workspace/node_modules');
        for (const name of await readdir('/opt/node_modules')) {
          await symlink(join('/opt/node_modules', name), join('/workspace/node_modules', name));
        }
      } catch {
        /* The base image supports dependency-free projects. */
      }
    const cpu = (await readFile('/proc/self/status', 'utf8')).match(
      /^Cpus_allowed_list:\s*(\d+)/m
    )?.[1];
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
      if (
        !input.archive &&
        !sourcePaths.has(relative) &&
        !Array.from(sourcePaths).some((path) => path.startsWith(relative + '/'))
      )
        continue;
      const path = join('/workspace', relative);
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error('Links and special files cannot be exported');
      if (stat.isDirectory()) {
        await scan(relative, depth + 1);
        continue;
      }
      bytes += stat.size;
      if (bytes > maxBytes || stat.size > 2_000_000 || files.length >= 2500)
        throw new Error('Workspace exceeds export limit');
      const content = await readFile(path);
      files.push({
        path: relative,
        base64: content.toString('base64'),
        executable: !!(stat.mode & 0o111)
      });
    }
  }
  await scan('');
  // Evidence is not stable while another process can keep changing source after export.
  const processes = input.persistent ? await readdir('/proc') : [];
  const initChildren = input.persistent
    ? (await readFile('/proc/1/task/1/children', 'utf8')).trim().split(/\s+/)
    : [];
  const candidates = processes.filter(
    (pid) => /^\d+$/.test(pid) && !['1', initChildren[0], String(process.pid)].includes(pid)
  );
  const states = await Promise.all(
    candidates.map((pid) => readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''))
  );
  const backgroundProcesses = states.filter((status) => status && !/^State:\s*Z/m.test(status));
  process.stdout.write(
    JSON.stringify({ exitCode, log, files, backgroundProcesses: backgroundProcesses.length > 0 })
  );
} catch {
  process.stdout.write(
    JSON.stringify({
      error:
        'Execution or workspace export failed. Links, special files, and oversized workspaces are unsupported.',
      log
    })
  );
  process.exitCode = 1;
}
