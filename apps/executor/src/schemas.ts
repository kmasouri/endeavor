import { z } from 'zod';

export const MAX_FILES = 2500;
export const MAX_BYTES = 20_000_000;
export const pathSchema = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !Array.from(path).some((char) => char.charCodeAt(0) < 32) &&
      path
        .split('/')
        .every(
          (part) =>
            part !== '' && part !== '.' && part !== '..' && !['.git', 'node_modules'].includes(part)
        ),
    'Use a relative file path without links, .git, node_modules, or traversal'
  );
export const fileSchema = z.strictObject({
  path: pathSchema,
  base64: z
    .string()
    .max(2_800_000)
    .refine(
      (value) => Buffer.from(value, 'base64').toString('base64') === value,
      'Use canonical base64'
    ),
  executable: z.boolean().default(false)
});
export const filesSchema = z
  .array(fileSchema)
  .max(MAX_FILES)
  .superRefine((files, ctx) => {
    if (files.reduce((sum, file) => sum + Buffer.byteLength(file.base64, 'base64'), 0) > MAX_BYTES)
      ctx.addIssue({ code: 'custom', message: 'Workspace exceeds 20 MB' });
    const paths = new Set<string>();
    for (const file of files) {
      if (paths.has(file.path)) ctx.addIssue({ code: 'custom', message: 'Duplicate file path' });
      paths.add(file.path);
    }
  });
export type WorkspaceFile = z.infer<typeof fileSchema>;
const empty = z.strictObject({});
export const toolSchemas = {
  checkout_repository: z.strictObject({
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    ref: z.string().min(1).max(200)
  }),
  list_repository_files: z.strictObject({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(100)
  }),
  list_executions: empty,
  read_repository_file: z.strictObject({
    path: pathSchema,
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(8000).default(8000)
  }),
  write_repository_file: z.strictObject({ path: pathSchema, content: z.string().max(1_000_000) }),
  delete_repository_file: z.strictObject({ path: pathSchema }),
  run_command: z.strictObject({ command: z.string().trim().min(1).max(4000) }),
  get_execution: z.strictObject({
    execution_id: z.uuid(),
    wait_seconds: z.number().int().min(0).max(20).default(20)
  }),
  cancel_execution: z.strictObject({ execution_id: z.uuid() }),
  repository_changes: z.strictObject({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(25).default(25)
  }),
  discard_repository: empty
} as const;
export type ToolName = keyof typeof toolSchemas;
const descriptions: Record<ToolName, string> = {
  checkout_repository:
    'Start an isolated checkout of an allowed GitHub repository and ref. Returns a job; poll get_execution. Replaces this task checkout only after success. Ref resolves to an immutable commit. Does not run repository code.',
  list_executions:
    'List recent executions for this task, including IDs for recovering a call whose response was lost.',
  list_repository_files:
    'List files in this task checkout, including its repository and base commit.',
  read_repository_file:
    'Read a UTF-8 text file in this task checkout in pages of at most 8,000 characters. Use nextOffset to read the rest.',
  write_repository_file:
    'Replace a UTF-8 text file in this task checkout. No changes are published to GitHub.',
  delete_repository_file:
    'Delete a file from this task checkout. No changes are published to GitHub.',
  run_command:
    "Run a shell command against this task checkout in this task's reusable offline container. Returns an execution ID immediately; poll get_execution. Dependencies come from the configured image; network installs are unavailable. The timeout is ten minutes. Only existing source files are imported. Generated files, caches, dependencies, and background processes persist until workspace cleanup; use write_repository_file to add publishable source. workspaceReset reports a newly created environment. Redirect background logs to a file.",
  get_execution:
    'Wait up to 20 seconds for completion, then read status, exit code, bounded log, base commit, and snapshot revision. Set wait_seconds to 0 for an immediate read. Poll until finished before editing or publishing. A cancelled or interrupted run never imports its files. Background processes prevent verification; stop them before the final check.',
  cancel_execution:
    'Cancel a running execution and remove its workspace container, including background processes. Keep the last accepted source snapshot.',
  repository_changes:
    'List changed and deleted paths relative to the checked-out commit, with content hashes. Read the changed files and publish them through the GitHub connection after reviewing the diff. Tests apply only to the reported revision.',
  discard_repository:
    'Delete this task checkout, evidence, and workspace container. Refused while an execution is running.'
};
export const TOOLS = Object.entries(toolSchemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as ToolName],
  inputSchema: z.toJSONSchema(schema, { target: 'draft-7' })
}));

export const envSchema = z.object({
  EXECUTOR_HOST: z.string().default('0.0.0.0'),
  EXECUTOR_PORT: z.coerce.number().int().min(1).max(65535).default(3200),
  EXECUTOR_TOKEN: z.string().min(32),
  EXECUTOR_IMAGE: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/)
    .default('endeavor-sandbox:local'),
  EXECUTOR_DATA_DIR: z.string().min(1).default('/data'),
  EXECUTOR_REPOSITORIES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
    .pipe(z.array(z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/))),
  EXECUTOR_GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((value) => value || undefined)
});
export type Settings = z.infer<typeof envSchema>;
