import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { config } from './config';

// Applies the SQL files in db/schema/ in filename order. Each file runs once, inside its own
// transaction, and is recorded in schema_migrations so it is skipped next time.
const SCHEMA_DIR = join(__dirname, '../db/schema');

export async function migrate(client: Pick<Client, 'query'>, files: string[]): Promise<string[]> {
  const namespaces = await client.query<{ renamed: boolean; legacy: boolean }>(
    "SELECT to_regnamespace('endeavor') IS NOT NULL AS renamed, to_regnamespace('bold_cedar_007') IS NOT NULL AS legacy"
  );
  const existing = namespaces.rows[0];
  if (existing.renamed && existing.legacy) {
    throw new Error(
      'Both endeavor and the legacy schema exist. Resolve the duplicate before migrating.'
    );
  }
  // Immutable early migrations use the original schema. Migration 033 renames it and its ledger.
  let schema = existing.renamed ? 'endeavor' : 'bold_cedar_007';
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const result = await client.query<{ filename: string }>(
    `SELECT filename FROM ${schema}.schema_migrations`
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
      const renamed = await client.query<{ renamed: boolean }>(
        "SELECT to_regnamespace('endeavor') IS NOT NULL AS renamed"
      );
      if (renamed.rows[0].renamed) schema = 'endeavor';
      await client.query(`INSERT INTO ${schema}.schema_migrations (filename) VALUES ($1)`, [file]);
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
