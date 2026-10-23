import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { config } from './config';

// Applies the SQL files in db/schema/ in filename order. Each file runs once, inside its own
// transaction, and is recorded in schema_migrations so it is skipped next time.
const SCHEMA_DIR = join(__dirname, '../db/schema');

export async function migrate(client: Pick<Client, 'query'>, files: string[]): Promise<string[]> {
  await client.query('CREATE SCHEMA IF NOT EXISTS bold_cedar_007');
  await client.query(
    `CREATE TABLE IF NOT EXISTS bold_cedar_007.schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const result = await client.query<{ filename: string }>(
    'SELECT filename FROM bold_cedar_007.schema_migrations'
  );
  const done = new Set(result.rows.map((row) => row.filename));
  const applied: string[] = [];

  for (const file of [...files].sort()) {
    if (done.has(file)) {
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(readFileSync(join(SCHEMA_DIR, file), 'utf8'));
      await client.query('INSERT INTO bold_cedar_007.schema_migrations (filename) VALUES ($1)', [
        file
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
    applied.push(file);
  }

  return applied;
}

async function main(): Promise<void> {
  const client = new Client(config.DATABASE);
  await client.connect();
  try {
    const files = readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.sql'));
    const applied = await migrate(client, files);
    console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Nothing to apply');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
