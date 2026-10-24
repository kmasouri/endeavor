import { join } from 'node:path';
import { z } from 'zod';

// .env sits at the repo root, two folders above this app (from src/ or dist/ alike).
if (process.env.ENVIRONMENT === 'local') {
  try {
    process.loadEnvFile(join(__dirname, '../../../.env'));
  } catch (error) {
    if (!isMissingEnvFileError(error)) {
      throw error;
    }
  }
}

function isMissingEnvFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

const priceTableSchema = z.record(
  z.string(),
  z.strictObject({
    inputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative()
  })
);

// Every environment variable the service reads is declared here. Parsing fails fast at startup
// with a readable message instead of letting a bad value (such as PORT=abc) become NaN later.
const envSchema = z.object({
  ENVIRONMENT: z.string().min(1).default('production'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_HOST: z.string().min(1).default('localhost'),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DATABASE_NAME: z.string().min(1).default('endeavor'),
  DATABASE_USER: z.string().min(1).default('endeavor'),
  DATABASE_PASSWORD: z.string().default('endeavor'),
  LOGGER_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  REQUEST_ID_HEADER: z.string().min(1).default('x-request-id'),
  WEBHOOK_URL: z.url().optional(),
  // Model providers. A provider is ready only when its key is set.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  // The runner delivers messages and runs agents' work. Tests turn it off.
  RUNNER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
  RUNNER_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  // Model prices in US dollars per million tokens, as JSON, such as
  // {"some-model":{"inputPerMillion":0.15,"outputPerMillion":0.6}}. Models not listed have an
  // unknown cost: their tokens are still counted, but dollar budgets can't count them.
  MODEL_PRICES: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) {
        return {};
      }
      const parsed = priceTableSchema.safeParse(safeJson(value));
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          message:
            'MODEL_PRICES must be JSON like {"model":{"inputPerMillion":1,"outputPerMillion":2}}'
        });
        return z.NEVER;
      }
      return parsed.data;
    }),
  // The most one task may spend, in US dollars, unless its agent's configuration sets its own.
  TASK_BUDGET_USD: z.coerce.number().positive().default(1),
  // A separate model call checks each result against its criteria before a task completes.
  // Off unless set to true: people and other agents review results instead (Kayvan's answer).
  COMPLETION_CHECK: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  // Where each task's files go: one folder per task. Relative paths start from where the app runs.
  WORKSPACES_DIR: z.string().min(1).default('workspaces'),
  // 32 random bytes, as base64 or hex. Encrypts connection credentials at rest.
  CREDENTIALS_KEY: z.string().min(1).optional()
});

export type Env = z.infer<typeof envSchema>;

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

const env = parseEnv(process.env);

export const config = {
  ENVIRONMENT: env.ENVIRONMENT,
  HOST: env.HOST,
  PORT: env.PORT,
  DATABASE: getDatabaseConfig(env),
  LOGGER_LEVEL: env.LOGGER_LEVEL,
  REQUEST_ID_HEADER: env.REQUEST_ID_HEADER,
  WEBHOOK_URL: env.WEBHOOK_URL,
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  OPENAI_BASE_URL: env.OPENAI_BASE_URL,
  // Never runs in tests, so they need no database.
  RUNNER_ENABLED: env.RUNNER_ENABLED && env.ENVIRONMENT !== 'test',
  RUNNER_INTERVAL_MS: env.RUNNER_INTERVAL_MS,
  COMPLETION_CHECK: env.COMPLETION_CHECK,
  MODEL_PRICES: env.MODEL_PRICES,
  TASK_BUDGET_USD: env.TASK_BUDGET_USD,
  WORKSPACES_DIR: env.WORKSPACES_DIR,
  CREDENTIALS_KEY: env.CREDENTIALS_KEY
};

function getDatabaseConfig(env: Env) {
  if (env.DATABASE_URL) {
    return {
      connectionString: env.DATABASE_URL
    };
  }

  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD
  };
}
