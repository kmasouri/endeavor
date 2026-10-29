import { spawn } from 'node:child_process';

export interface ContainerResult {
  code: number;
  stdout: string;
  workspaceReset?: boolean;
}
export interface ContainerRun {
  result: Promise<ContainerResult>;
  cancel: () => Promise<void>;
}
export interface ContainerClient {
  run(id: string, image: string, input: unknown, task?: string): ContainerRun;
  release(task: string): Promise<void>;
  recover(): Promise<void>;
}
export const CONTAINER_LABEL = 'io.endeavor.executor=ca78';

// No shell on the broker. Repository commands exist only in JSON on stdin to the child.
export function containerArgs(id: string, image: string): string[] {
  return [
    'create',
    '--init',
    '--pull',
    'never',
    '--name',
    `endeavor-execution-${id}`,
    '--label',
    CONTAINER_LABEL,
    '--network',
    'none',
    '--read-only',
    '--user',
    '1000:1000',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '2048m',
    '--memory-swap',
    '2048m',
    '--cpus',
    '1',
    '--pids-limit',
    '256',
    '--ulimit',
    'nofile=256:256',
    '--ulimit',
    'fsize=67108864:67108864',
    '--log-driver',
    'none',
    '--tmpfs',
    '/workspace:rw,nosuid,nodev,size=256m,mode=1777',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=64m,mode=1777',
    '--workdir',
    '/workspace',
    '--env',
    'HOME=/tmp',
    '-i',
    image
  ];
}

async function docker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(0, 100_000);
    });
    child.on('error', () => reject(new Error('Docker is unavailable')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Docker did not respond'));
    }, 10_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error('Docker operation failed'));
    });
  });
}

export class DockerClient implements ContainerClient {
  private readonly sessions = new Map<string, { name: string; ready: Promise<void> }>();

  async release(task: string): Promise<void> {
    const session = this.sessions.get(task);
    if (!session) return;
    try {
      await session.ready;
    } catch {
      await docker(['rm', '-f', session.name]).catch(() => undefined);
      this.sessions.delete(task);
      return;
    }
    await docker(['rm', '-f', session.name]).catch(async () => {
      // Docker may already have lost the container. A daemon failure must still surface.
      const remaining = await docker(['ps', '-aq', '--filter', `name=^/${session.name}$`]);
      if (remaining.trim()) throw new Error('Workspace container could not be removed');
    });
    this.sessions.delete(task);
  }

  async recover(): Promise<void> {
    // A single broker owns this label. Never touch platform services or unrelated containers.
    const ids = (await docker(['ps', '-aq', '--filter', `label=${CONTAINER_LABEL}`]))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) await docker(['rm', '-f', id]);
    this.sessions.clear();
  }

  run(id: string, image: string, input: unknown, task?: string): ContainerRun {
    let session = task ? this.sessions.get(task) : undefined;
    const workspaceReset = !!task && !session;
    const name = session?.name ?? `endeavor-execution-${id}`;
    // Create before starting: cancellation waits for the named container to exist, so an
    // immediate cancellation cannot race a later Docker create and leave work running.
    let created: Promise<unknown>;
    if (task) {
      if (!session) {
        const args = containerArgs(id, image);
        // The task container stays alive; each command runs the immutable image worker via exec.
        args.splice(args.length - 1, 0, '--entrypoint', 'node');
        args.push('-e', 'setInterval(() => {}, 3600000)');
        const ready = docker(args)
          .then(() => docker(['start', name]))
          .then(() => undefined);
        session = { name, ready };
        this.sessions.set(task, session);
      }
      created = session.ready;
    } else created = docker(containerArgs(id, image));
    let cancelled = false;
    let stopping: Promise<void> | undefined;
    const cancel = () => {
      cancelled = true;
      return (stopping ??= created
        .then(async () => {
          if (task) await this.release(task);
          else await docker(['rm', '-f', name]);
        })
        .then(() => undefined)
        .catch(() => undefined));
    };
    const result = (async () => {
      await created;
      if (cancelled) return { code: -1, stdout: '' };
      return new Promise<ContainerResult>((resolve, reject) => {
        const args = task
          ? ['exec', '-i', name, 'node', '/sandbox/worker.mjs']
          : ['start', '--attach', '--interactive', name];
        const child = spawn('docker', args, {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let bytes = 0;
        let exceeded = false;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 32_000_000) {
            exceeded = true;
            void cancel();
            return;
          }
          stdout += chunk;
        });
        child.stderr.on('data', () => {
          /* Docker diagnostics stay private. */
        });
        child.stdin.on('error', () => {
          /* A cancelled container can close its input early. */
        });
        child.on('error', () => reject(new Error('Docker could not start the execution')));
        const timer = setTimeout(() => {
          void cancel().finally(() => child.kill('SIGKILL'));
        }, 600_000);
        child.on('close', (code) => {
          clearTimeout(timer);
          if (exceeded) reject(new Error('Execution snapshot exceeded its output limit'));
          else resolve({ code: code ?? -1, stdout, workspaceReset });
        });
        child.stdin.end(
          JSON.stringify({
            ...(input as object),
            ...(task ? { persistent: true, initialize: workspaceReset } : {})
          })
        );
      });
    })().finally(async () => {
      if (!task) await docker(['rm', '-f', name]).catch(() => undefined);
    });
    return { result, cancel };
  }
}
