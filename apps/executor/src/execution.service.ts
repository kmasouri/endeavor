import { OperationError } from './errors.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ContainerClient, ContainerRun } from './docker.ts';
import type { RepositorySource } from './github.ts';
import {
  filesSchema,
  toolSchemas,
  type Settings,
  type ToolName,
  type WorkspaceFile
} from './schemas.ts';

const executionResult = z.strictObject({
  exitCode: z.number().int(),
  log: z.string().max(16_000),
  files: filesSchema,
  backgroundProcesses: z.boolean().default(false)
});
const revisionSchema = z.number().int().nonnegative();
const repositorySchema = toolSchemas.checkout_repository.shape.repository;
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const executionSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['running', 'finished', 'cancelled', 'interrupted', 'failed']),
  command: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  exitCode: z.number().int().optional(),
  log: z.string().max(16_000).optional(),
  error: z.string().optional(),
  revision: revisionSchema,
  inputRevision: revisionSchema,
  verifiedRevision: revisionSchema.nullable().optional(),
  workspaceChanged: z.boolean().optional(),
  sha: shaSchema.nullable(),
  repository: repositorySchema.nullable(),
  workspaceReset: z.boolean().optional(),
  backgroundProcesses: z.boolean().optional()
});
const checkoutSchema = z.strictObject({
  repository: repositorySchema,
  sha: shaSchema,
  files: filesSchema,
  baseline: filesSchema
});
const recordSchema = z.strictObject({
  revision: revisionSchema,
  checkout: checkoutSchema.nullable(),
  executions: z.array(executionSchema).max(20),
  touchedAt: z.number().int().nonnegative()
});
const storedRecordSchema = z.strictObject({ version: z.literal(1), record: recordSchema });
const quarantineSchema = z.strictObject({
  version: z.literal(1),
  quarantinedFile: z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.json$/),
  reason: z.enum(['invalid JSON', 'invalid record', 'unsupported version'])
});
type Execution = z.infer<typeof executionSchema>;
type RecordData = z.infer<typeof recordSchema>;
type Quarantine = z.infer<typeof quarantineSchema>;
type Active = { cancelled: boolean; container?: ContainerRun; done?: Promise<void> };
const fresh = (): RecordData => ({
  revision: 0,
  checkout: null,
  executions: [],
  touchedAt: Date.now()
});
export const fileHash = (file: WorkspaceFile) =>
  createHash('sha256')
    .update(file.base64)
    .update(file.executable ? 'x' : '-')
    .digest('hex');

export class ExecutionService {
  private readonly settings: Settings;
  private readonly containers: ContainerClient;
  private readonly source: RepositorySource;
  private readonly warn: (message: string) => void;
  private readonly records = new Map<string, RecordData>();
  private readonly unavailable = new Map<string, Quarantine>();
  private readonly busy = new Set<string>();
  private readonly active = new Map<string, Active>();
  private readonly dirty = new Map<string, Set<string>>();
  constructor(
    settings: Settings,
    containers: ContainerClient,
    source: RepositorySource,
    warn: (message: string) => void = console.warn
  ) {
    this.settings = settings;
    this.containers = containers;
    this.source = source;
    this.warn = warn;
  }

  async initialize(): Promise<void> {
    await mkdir(this.settings.EXECUTOR_DATA_DIR, { recursive: true, mode: 0o700 });
    await this.containers.recover();
    for (const name of await readdir(this.settings.EXECUTOR_DATA_DIR)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name) || !z.uuid().safeParse(name.slice(0, -5)).success) continue;
      const taskId = name.slice(0, -5);
      const bytes = await readFile(this.file(taskId));
      let parsed: unknown;
      let reason: Quarantine['reason'] = 'invalid record';
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        reason = 'invalid JSON';
      }
      const marker = quarantineSchema.safeParse(parsed);
      if (marker.success) {
        this.markUnavailable(taskId, marker.data);
        continue;
      }
      const version = z.object({ version: z.number() }).safeParse(parsed);
      if (version.success && version.data.version !== 1) reason = 'unsupported version';
      const loaded = version.success
        ? storedRecordSchema.safeParse(parsed).data?.record
        : recordSchema.safeParse(parsed).data;
      if (!loaded) {
        const quarantinedFile = `${taskId}.${randomUUID()}.json`;
        await mkdir(join(this.settings.EXECUTOR_DATA_DIR, 'quarantine'), {
          recursive: true,
          mode: 0o700
        });
        // Keep the original bytes before replacing the root file with a durable marker.
        // If either write fails, stop startup rather than hiding a storage failure.
        await writeFile(
          join(this.settings.EXECUTOR_DATA_DIR, 'quarantine', quarantinedFile),
          bytes,
          {
            flag: 'wx',
            mode: 0o600
          }
        );
        const marker: Quarantine = { version: 1, quarantinedFile, reason };
        await this.writeRecord(taskId, marker);
        this.markUnavailable(taskId, marker);
        continue;
      }
      const record = loaded;
      for (const job of record.executions.filter((job) => job.status === 'running')) {
        job.status = 'interrupted';
        job.verifiedRevision = null;
        job.error =
          'Executor restarted. Outcome is unknown; changes were not imported. Run verification again.';
        job.finishedAt = new Date().toISOString();
      }
      this.records.set(taskId, record);
      await this.persist(taskId, record);
    }
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    for (const [task, record] of this.records) {
      if (
        !this.busy.has(task) &&
        !this.active.has(task) &&
        Date.now() - record.touchedAt > 1_800_000
      ) {
        this.busy.add(task);
        try {
          await this.containers.release(task);
        } finally {
          this.busy.delete(task);
        }
      }
      if (
        !this.busy.has(task) &&
        !this.active.has(task) &&
        Date.now() - record.touchedAt > 86_400_000
      ) {
        // Expiry and a new tool call must not delete the same checkout concurrently.
        this.busy.add(task);
        try {
          await rm(this.file(task), { force: true });
          this.records.delete(task);
          this.dirty.delete(task);
        } finally {
          this.busy.delete(task);
        }
      }
    }
  }
  async close(): Promise<void> {
    for (const active of this.active.values()) {
      active.cancelled = true;
      await active.container?.cancel();
    }
    await Promise.all([...this.active.values()].map((active) => active.done));
    for (const task of this.records.keys()) await this.containers.release(task);
  }
  private file(task: string): string {
    return join(this.settings.EXECUTOR_DATA_DIR, `${task}.json`);
  }
  private markUnavailable(task: string, marker: Quarantine): void {
    this.unavailable.set(task, marker);
    this.warn(
      `Executor task ${task} unavailable: ${marker.reason}. Original record: quarantine/${marker.quarantinedFile}. Restore a validated record while stopped, or explicitly call discard_repository to start over. The quarantine copy is retained.`
    );
  }
  private async writeRecord(task: string, value: unknown): Promise<void> {
    await writeFile(`${this.file(task)}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await rename(`${this.file(task)}.tmp`, this.file(task));
  }
  private async persist(task: string, record: RecordData): Promise<void> {
    await this.writeRecord(task, { version: 1, record });
  }

  async call(task: string, name: ToolName, raw: unknown): Promise<unknown> {
    // Task identity is supplied by the trusted runner, never by model arguments.
    task = z.uuid().parse(task).toLowerCase();
    const input = toolSchemas[name].parse(raw);
    if (name === 'get_execution') {
      const { execution_id, wait_seconds } = toolSchemas.get_execution.parse(input);
      const job = this.records.get(task)?.executions.find((job) => job.id === execution_id);
      const deadline = Date.now() + wait_seconds * 1000;
      // Wait outside the task mutex, so cancellation and completion can proceed.
      while (job?.status === 'running' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    while (this.busy.has(task)) await new Promise((resolve) => setTimeout(resolve, 5));
    this.busy.add(task);
    try {
      if (this.unavailable.has(task)) {
        if (name !== 'discard_repository')
          throw new OperationError(
            'This task has a quarantined executor record. Its original data is preserved. Ask an operator to restore it, or explicitly discard_repository before starting over.'
          );
        await this.containers.release(task);
        await rm(this.file(task), { force: true });
        this.unavailable.delete(task);
        return { discarded: true };
      }
      let record = this.records.get(task);
      if (!record) {
        if (name === 'list_executions') return [];
        if (name === 'discard_repository') return { discarded: true };
        if (name === 'get_execution' || name === 'cancel_execution')
          throw new OperationError('Execution does not belong to this task');
        if (name !== 'checkout_repository')
          throw new OperationError('Check out a repository first');
        await this.cleanup();
        if (this.records.size >= 4)
          throw new OperationError(
            'Executor workspace limit reached; discard finished task checkouts'
          );
        record = fresh();
        this.records.set(task, record);
      }
      record.touchedAt = Date.now();
      const active = this.active.get(task);
      if (name === 'get_execution' || name === 'cancel_execution') {
        const { execution_id } = toolSchemas.get_execution.parse(input);
        const job = record.executions.find((job) => job.id === execution_id);
        if (!job) throw new OperationError('Execution does not belong to this task');
        if (name === 'cancel_execution' && job.status === 'running' && active) {
          active.cancelled = true;
          await active.container?.cancel();
          job.status = 'cancelled';
          job.finishedAt = new Date().toISOString();
        }
        await this.persist(task, record);
        return {
          ...job,
          currentRevision: record.revision,
          currentRepository: record.checkout?.repository ?? null
        };
      }
      if (name === 'list_executions')
        return record.executions.map((job) => ({
          id: job.id,
          status: job.status,
          command: job.command,
          revision: job.revision,
          sha: job.sha
        }));
      if (active)
        throw new OperationError(
          'Wait for or cancel the current execution before editing the checkout'
        );
      if (name === 'discard_repository') {
        await this.containers.release(task);
        await rm(this.file(task), { force: true });
        this.records.delete(task);
        this.dirty.delete(task);
        return { discarded: true };
      }
      if (name === 'checkout_repository' || name === 'run_command') {
        if (this.active.size >= 2)
          throw new OperationError('Two executions are already running; try again later');
        if (name === 'run_command' && !record.checkout)
          throw new OperationError('Check out a repository first');
        const job: Execution = {
          id: randomUUID(),
          status: 'running',
          command:
            name === 'run_command' ? toolSchemas.run_command.parse(input).command : 'checkout',
          startedAt: new Date().toISOString(),
          revision: record.revision,
          inputRevision: record.revision,
          sha: name === 'checkout_repository' ? null : (record.checkout?.sha ?? null),
          repository:
            name === 'checkout_repository'
              ? toolSchemas.checkout_repository.parse(input).repository
              : (record.checkout?.repository ?? null)
        };
        record.executions = [...record.executions.slice(-19), job];
        const operation: Active = { cancelled: false };
        this.active.set(task, operation);
        try {
          await this.persist(task, record);
        } catch (error) {
          this.active.delete(task);
          throw error;
        }
        // Starts after the initial state is durable. MCP returns promptly; polling is separate.
        operation.done = this.execute(
          task,
          record,
          job,
          operation,
          name === 'checkout_repository' ? toolSchemas.checkout_repository.parse(input) : null
        ).catch(() => {
          job.status = 'failed';
          job.verifiedRevision = null;
          job.error = 'Execution state could not be saved. Verify storage before trying again.';
        });
        return { ...job };
      }
      const checkout = record.checkout;
      if (!checkout) throw new OperationError('Check out a repository first');
      if (name === 'list_repository_files') {
        const { offset, limit } = toolSchemas.list_repository_files.parse(input);
        return {
          repository: checkout.repository,
          sha: checkout.sha,
          revision: record.revision,
          total: checkout.files.length,
          paths: checkout.files.slice(offset, offset + limit).map((file) => file.path)
        };
      }
      if (name === 'repository_changes') {
        const before = new Map(checkout.baseline.map((file) => [file.path, fileHash(file)]));
        const after = new Set(checkout.files.map((file) => file.path));
        const { offset, limit } = toolSchemas.repository_changes.parse(input);
        const changed = checkout.files
          .filter((file) => before.get(file.path) !== fileHash(file))
          .map((file) => ({
            path: file.path,
            hash: fileHash(file),
            bytes: Buffer.byteLength(file.base64, 'base64'),
            executable: file.executable
          }));
        const deleted = [...before.keys()].filter((path) => !after.has(path));
        return {
          repository: checkout.repository,
          sha: checkout.sha,
          revision: record.revision,
          changed: changed.slice(offset, offset + limit),
          deleted: deleted.slice(offset, offset + limit),
          changedTotal: changed.length,
          deletedTotal: deleted.length,
          nextOffset:
            Math.max(changed.length, deleted.length) > offset + limit ? offset + limit : null
        };
      }
      const { path } = toolSchemas.read_repository_file.parse({
        path: (input as { path: string }).path
      });
      const existing = checkout.files.find((file) => file.path === path);
      if (name === 'read_repository_file') {
        if (!existing) throw new OperationError('File does not exist');
        const bytes = Buffer.from(existing.base64, 'base64');
        const content = bytes.toString('utf8');
        if (!Buffer.from(content).equals(bytes))
          throw new OperationError('This file is binary; text editing is unavailable');
        const { offset, limit } = toolSchemas.read_repository_file.parse(input);
        return {
          path,
          content: content.slice(offset, offset + limit),
          truncated: content.length > offset + limit,
          nextOffset: content.length > offset + limit ? offset + limit : null,
          totalCharacters: content.length,
          hash: fileHash(existing),
          revision: record.revision
        };
      }
      if (name === 'delete_repository_file' && !existing)
        throw new OperationError('File does not exist');
      const next = checkout.files.filter((file) => file.path !== path);
      if (name === 'write_repository_file')
        next.push({
          path,
          base64: Buffer.from(toolSchemas.write_repository_file.parse(input).content).toString(
            'base64'
          ),
          executable: existing?.executable ?? false
        });
      checkout.files = filesSchema.parse(next);
      const dirty = this.dirty.get(task) ?? new Set<string>();
      dirty.add(path);
      this.dirty.set(task, dirty);
      record.revision++;
      await this.persist(task, record);
      return { path, revision: record.revision };
    } finally {
      this.busy.delete(task);
    }
  }

  private async execute(
    task: string,
    record: RecordData,
    job: Execution,
    active: Active,
    checkout: { repository: string; ref: string } | null
  ): Promise<void> {
    let exported: z.infer<typeof executionResult> | undefined;
    let snapshot: { sha: string; archive: string } | null = null;
    const before =
      record.checkout?.files
        .map((file) => `${file.path}:${fileHash(file)}`)
        .sort()
        .join('\n') ?? '';
    try {
      snapshot = checkout ? await this.source.snapshot(checkout.repository, checkout.ref) : null;
      if (!active.cancelled) {
        active.container = this.containers.run(
          job.id,
          this.settings.EXECUTOR_IMAGE,
          snapshot
            ? { archive: snapshot.archive }
            : {
                files: record.checkout!.files,
                updates: [...(this.dirty.get(task) ?? [])],
                deleted: [...(this.dirty.get(task) ?? [])].filter(
                  (path) => !record.checkout!.files.some((file) => file.path === path)
                ),
                command: job.command
              },
          snapshot ? undefined : task
        );
        const result = await active.container.result;
        job.workspaceReset = result.workspaceReset;
        if (result.code !== 0) throw new OperationError('Container failed');
        exported = executionResult.parse(JSON.parse(result.stdout));
        if (!snapshot) {
          const sourcePaths = new Set(record.checkout!.files.map((file) => file.path));
          exported.files = exported.files.filter((file) => sourcePaths.has(file.path));
        }
        // A replacement checkout only retires the old workspace after a valid export.
        if (snapshot) await this.containers.release(task);
      }
    } catch {
      // Provider errors, Docker output, and filesystem details never enter evidence.
      exported = undefined;
    }
    if (!checkout && (!exported || active.cancelled)) {
      try {
        await this.containers.release(task);
      } catch {
        exported = undefined;
      }
    }
    while (this.busy.has(task)) await new Promise((resolve) => setTimeout(resolve, 5));
    this.busy.add(task);
    try {
      if (active.cancelled) job.status = 'cancelled';
      else if (!exported) {
        job.status = 'failed';
        job.error =
          'Checkout, execution, or export failed. Check repository access, image availability, resource limits, and supported files. Changes were not imported.';
      } else {
        if (snapshot && checkout)
          record.checkout = {
            repository: checkout.repository,
            sha: snapshot.sha,
            files: exported.files,
            baseline: exported.files
          };
        else record.checkout!.files = exported.files;
        record.revision++;
        this.dirty.delete(task);
        job.revision = record.revision;
        job.sha = record.checkout!.sha;
        job.status = 'finished';
        job.exitCode = exported.exitCode;
        job.log = exported.log;
        job.backgroundProcesses = exported.backgroundProcesses;
        job.workspaceChanged =
          before !==
          exported.files
            .map((file) => `${file.path}:${fileHash(file)}`)
            .sort()
            .join('\n');
        job.verifiedRevision =
          !checkout &&
          !job.workspaceChanged &&
          !exported.backgroundProcesses &&
          exported.exitCode === 0
            ? record.revision
            : null;
      }
      job.finishedAt = new Date().toISOString();
      record.touchedAt = Date.now();
      await this.persist(task, record);
    } finally {
      this.busy.delete(task);
      this.active.delete(task);
    }
  }
}
