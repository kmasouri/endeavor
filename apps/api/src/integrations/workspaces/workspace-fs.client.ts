import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError } from '../../shared/errors';
import {
  WorkspaceClient,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceListing
} from './workspace.client';

export interface WorkspaceLimits {
  maxWriteBytes: number;
  maxReadChars: number;
  maxListEntries: number;
}

const DEFAULT_LIMITS: WorkspaceLimits = {
  maxWriteBytes: 1_000_000,
  maxReadChars: 100_000,
  maxListEntries: 500
};

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keeps each task's files in <rootDir>/<taskId> on this computer's disk.
export class WorkspaceFsClient implements WorkspaceClient {
  private readonly rootDir: string;
  private readonly limits: WorkspaceLimits;

  constructor(rootDir: string, limits: Partial<WorkspaceLimits> = {}) {
    this.rootDir = resolve(rootDir);
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async list(taskId: string, folder = ''): Promise<WorkspaceListing> {
    const { root, full } = this.resolveWorkspacePath(taskId, folder);
    let found;
    try {
      await this.ensureRealPathInside(root, full);
      found = await readdir(full, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        // A workspace with nothing written yet is empty, not an error.
        if (full === root) {
          return { entries: [], truncated: false };
        }
        throw new AppError('workspaceFileNotFound', `No folder at ${folder}.`);
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        throw new AppError('workspaceFileNotFound', `${folder} is a file. Use read_file.`);
      }
      throw error;
    }

    // Sort and cut down first, so a huge folder doesn't mean looking up every file's size.
    const kept = found
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({ entry, absolute: join(entry.parentPath, entry.name) }))
      .map((item) => ({ ...item, path: relative(root, item.absolute).split(sep).join('/') }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const entries: WorkspaceEntry[] = [];
    for (const { entry, absolute, path } of kept.slice(0, this.limits.maxListEntries)) {
      entries.push({
        path,
        type: entry.isFile() ? 'file' : 'folder',
        bytes: entry.isFile() ? (await stat(absolute)).size : null
      });
    }
    return { entries, truncated: kept.length > this.limits.maxListEntries };
  }

  async read(taskId: string, path: string): Promise<WorkspaceFile> {
    const { root, full } = this.resolveWorkspacePath(taskId, path, { file: true });
    let buffer: Buffer;
    try {
      await this.ensureRealPathInside(root, full);
      buffer = await readFile(full);
    } catch (error) {
      if (isMissing(error) || (error as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new AppError('workspaceFileNotFound', `No file at ${path}.`);
      }
      throw error;
    }
    if (buffer.includes(0)) {
      throw new AppError('workspaceFileNotText', `${path} isn't a text file.`);
    }
    const text = buffer.toString('utf8');
    return {
      content: text.slice(0, this.limits.maxReadChars),
      bytes: buffer.length,
      truncated: text.length > this.limits.maxReadChars
    };
  }

  async write(taskId: string, path: string, content: string): Promise<{ bytes: number }> {
    const { root, full } = this.resolveWorkspacePath(taskId, path, { file: true });
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.limits.maxWriteBytes) {
      throw new AppError(
        'workspaceFileTooLarge',
        `Files can be at most ${this.limits.maxWriteBytes} bytes; this one is ${bytes}.`
      );
    }
    await mkdir(root, { recursive: true });
    let parent = root;
    await this.ensureRealPathInside(root, parent);
    // Validate each existing parent before mkdir can follow it into another workspace.
    for (const part of relative(root, dirname(full)).split(sep).filter(Boolean)) {
      parent = join(parent, part);
      await mkdir(parent, { recursive: true });
      await this.ensureRealPathInside(root, parent);
    }
    try {
      await this.ensureRealPathInside(root, full);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    try {
      await writeFile(full, content, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new AppError('workspacePathInvalid', `${path} is a folder.`);
      }
      throw error;
    }
    return { bytes };
  }

  // Turns a workspace path into a real path, and refuses anything that would leave the task's
  // folder, such as "../other-task/file" or "/etc/passwd".
  private resolveWorkspacePath(
    taskId: string,
    path: string,
    options: { file?: boolean } = {}
  ): { root: string; full: string } {
    if (!TASK_ID.test(taskId)) {
      throw new AppError('workspacePathInvalid', 'Unknown task workspace.');
    }
    const cleaned = path.trim();
    if (cleaned.includes('\0') || isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
      throw new AppError(
        'workspacePathInvalid',
        'Use a path inside your workspace, like notes/plan.md.'
      );
    }
    const root = join(this.rootDir, taskId);
    const full = resolve(root, cleaned);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new AppError('workspacePathInvalid', 'Paths must stay inside your workspace.');
    }
    if (options.file && full === root) {
      throw new AppError('workspacePathInvalid', 'Give a file name, like notes/plan.md.');
    }
    return { root, full };
  }

  // A link inside the folder could point outside it. Follow links and check again.
  private async ensureRealPathInside(root: string, full: string): Promise<void> {
    const [realBase, realRoot, realFull] = await Promise.all([
      realpath(this.rootDir),
      realpath(root),
      realpath(full)
    ]);
    if (
      realRoot !== join(realBase, basename(root)) ||
      (realFull !== realRoot && !realFull.startsWith(realRoot + sep))
    ) {
      throw new AppError('workspacePathInvalid', 'Paths must stay inside your workspace.');
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}
