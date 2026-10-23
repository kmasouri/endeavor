import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceFsClient } from './workspace-fs.client';

const TASK = '00000000-0000-4000-8000-000000000001';
const OTHER_TASK = '00000000-0000-4000-8000-000000000002';

describe('WorkspaceFsClient', () => {
  let root: string;
  let client: WorkspaceFsClient;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspaces-'));
    client = new WorkspaceFsClient(root, { maxWriteBytes: 100, maxReadChars: 10, maxListEntries: 3 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes, reads, and lists files in the task folder', async () => {
    await client.write(TASK, 'notes/plan.md', 'step one');
    await client.write(TASK, 'a.txt', 'hi');

    expect(await client.read(TASK, 'notes/plan.md')).toEqual({
      content: 'step one',
      bytes: 8,
      truncated: false
    });
    expect(await client.list(TASK)).toEqual({
      entries: [
        { path: 'a.txt', type: 'file', bytes: 2 },
        { path: 'notes', type: 'folder', bytes: null },
        { path: 'notes/plan.md', type: 'file', bytes: 8 }
      ],
      truncated: false
    });
    expect((await client.list(TASK, 'notes')).entries).toEqual([
      { path: 'notes/plan.md', type: 'file', bytes: 8 }
    ]);
  });

  it('shows an empty workspace before anything is written', async () => {
    expect(await client.list(TASK)).toEqual({ entries: [], truncated: false });
  });

  it('keeps each task to its own folder', async () => {
    await client.write(OTHER_TASK, 'secret.txt', 'theirs');

    await expect(client.read(TASK, '../' + OTHER_TASK + '/secret.txt')).rejects.toMatchObject({
      name: 'workspacePathInvalid'
    });
    await expect(client.read(TASK, 'secret.txt')).rejects.toMatchObject({
      name: 'workspaceFileNotFound'
    });
  });

  it.each(['/etc/passwd', '../escape.txt', 'a/../../escape.txt', 'C:\\x.txt', 'a\0b'])(
    'refuses the path %p',
    async (path) => {
      await expect(client.write(TASK, path, 'x')).rejects.toMatchObject({
        name: 'workspacePathInvalid'
      });
    }
  );

  it('refuses links that point outside the workspace', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'file.txt'), 'outside');
    await mkdir(join(root, TASK));
    await symlink(outside, join(root, TASK, 'link'));

    await expect(client.read(TASK, 'link/file.txt')).rejects.toMatchObject({
      name: 'workspacePathInvalid'
    });
    await expect(client.write(TASK, 'link/new.txt', 'x')).rejects.toMatchObject({
      name: 'workspacePathInvalid'
    });
  });

  it('enforces the size limits', async () => {
    await expect(client.write(TASK, 'big.txt', 'x'.repeat(101))).rejects.toMatchObject({
      name: 'workspaceFileTooLarge'
    });

    await client.write(TASK, 'long.txt', 'x'.repeat(20));
    expect(await client.read(TASK, 'long.txt')).toEqual({
      content: 'x'.repeat(10),
      bytes: 20,
      truncated: true
    });

    await client.write(TASK, 'b.txt', '');
    await client.write(TASK, 'c.txt', '');
    await client.write(TASK, 'd.txt', '');
    expect((await client.list(TASK)).truncated).toBe(true);
  });

  it('refuses to read a file that is not text', async () => {
    await mkdir(join(root, TASK));
    await writeFile(join(root, TASK, 'image.bin'), Buffer.from([1, 0, 2]));

    await expect(client.read(TASK, 'image.bin')).rejects.toMatchObject({
      name: 'workspaceFileNotText'
    });
  });
});
