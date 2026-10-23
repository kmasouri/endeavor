import { z } from 'zod';

if (process.env.ENVIRONMENT === 'local') {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (!isMissingEnvFileError(error)) {
      throw error;
    }
  }
}

function isMissingEnvFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

// Every environment variable the service reads is declared here. Parsing fails fast at startup
// with a readable message instead of letting a bad value (such as PORT=abc) become NaN later.
const envSchema = z.object({
  ENVIRONMENT: z.string().min(1).default('production'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_HOST: z.string().min(1).default('localhost'),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DATABASE_NAME: z.string().min(1).default('bold_cedar_007'),
  DATABASE_USER: z.string().min(1).default('bold_cedar_007'),
  DATABASE_PASSWORD: z.string().default('bold_cedar_007'),
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
  // Where each task's files go: one folder per task. Relative paths start from where the app runs.
  WORKSPACES_DIR: z.string().min(1).default('workspaces'),
  // 32 random bytes, as base64 or hex. Encrypts connection credentials at rest.
  CREDENTIALS_KEY: z.string().min(1).optional()
});

export type Env = z.infer<typeof envSchema>;

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
