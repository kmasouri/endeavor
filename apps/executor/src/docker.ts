import { spawn } from 'node:child_process';

export interface ContainerResult {
  code: number;
  stdout: string;
}
export interface ContainerRun {
  result: Promise<ContainerResult>;
  cancel: () => Promise<void>;
}
export interface ContainerClient {
  run(id: string, image: string, input: unknown): ContainerRun;
  recover(): Promise<void>;
}
export const CONTAINER_LABEL = 'io.endeavor.executor=ca78';

// No shell on the broker. Repository commands exist only in JSON on stdin to the child.
export function containerArgs(id: string, image: string): string[] {
  return [
    'run',
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
    '1024m',
    '--memory-swap',
    '1024m',
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
  async recover(): Promise<void> {
    // A single broker owns this label. Never touch platform services or unrelated containers.
    const ids = (await docker(['ps', '-aq', '--filter', `label=${CONTAINER_LABEL}`]))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) await docker(['rm', '-f', id]);
  }

  run(id: string, image: string, input: unknown): ContainerRun {
    const name = `endeavor-execution-${id}`;
    const child = spawn('docker', containerArgs(id, image), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stopping: Promise<void> | undefined;
    const cancel = () =>
      (stopping ??= docker(['rm', '-f', name])
        .then(() => undefined)
        .catch(() => undefined));
    const result = new Promise<ContainerResult>((resolve, reject) => {
      let stdout = '';
      let bytes = 0;
      let exceeded = false;
      // Includes JSON/base64 for a bounded 20 MB workspace and its log.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 32_000_000) {
          exceeded = true;
          void cancel();
          return;
        }
        stdout += chunk.toString();
      });
      child.stderr.on('data', () => {
        /* Docker diagnostics may contain local details. */
      });
      child.stdin.on('error', () => {
        /* A failed container can close before input finishes. */
      });
      child.on('error', () => reject(new Error('Docker could not start the execution')));
      const timer = setTimeout(() => {
        void cancel().finally(() => child.kill('SIGKILL'));
      }, 300_000);
      child.on('close', async (code) => {
        clearTimeout(timer);
        await docker(['rm', '-f', name]).catch(() => undefined);
        if (exceeded) reject(new Error('Execution snapshot exceeded its output limit'));
        else resolve({ code: code ?? -1, stdout });
      });
      child.stdin.end(JSON.stringify(input));
    });
    return { result, cancel };
  }
}
