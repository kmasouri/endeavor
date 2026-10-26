import { migrate } from './migrate';

function fakeClient(applied: string[]) {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT filename')) {
      return { rows: applied.map((filename) => ({ filename })) };
    }
    return { rows: [] };
  });
  return { query };
}

describe('migrate', () => {
  it('creates the schema and ledger before reading it', async () => {
    const client = fakeClient([]);

    await migrate(client as never, []);

    expect(client.query.mock.calls.map(([sql]) => sql.split('\n')[0])).toEqual([
      'CREATE SCHEMA IF NOT EXISTS endeavor',
      'CREATE TABLE IF NOT EXISTS endeavor.schema_migrations (',
      'SELECT filename FROM endeavor.schema_migrations'
    ]);
  });

  it('applies new files in filename order and records each one', async () => {
    const client = fakeClient([]);

    const applied = await migrate(client as never, ['001_items.sql', '000_schema.sql']);

    expect(applied).toEqual(['000_schema.sql', '001_items.sql']);
    const inserts = client.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(inserts.map((call) => (call as unknown[])[1])).toEqual([
      ['000_schema.sql'],
      ['001_items.sql']
    ]);
    expect(inserts[0][0]).toBe('INSERT INTO endeavor.schema_migrations (filename) VALUES ($1)');
  });

  it('skips files that already ran', async () => {
    const client = fakeClient(['000_schema.sql']);

    const applied = await migrate(client as never, ['000_schema.sql', '001_items.sql']);

    expect(applied).toEqual(['001_items.sql']);
  });

  it('refuses a database built from schema files that no longer exist', async () => {
    const client = fakeClient(['000_schema.sql', '033_endeavor_schema.sql']);

    await expect(migrate(client as never, ['000_schema.sql', '001_items.sql'])).rejects.toThrow(
      'schema files that no longer exist (033_endeavor_schema.sql)'
    );
    expect(client.query).not.toHaveBeenCalledWith('BEGIN');
  });

  it('rolls back and names the file when one fails', async () => {
    const client = fakeClient([]);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CREATE TABLE endeavor.items')) {
        throw new Error('boom');
      }
      return { rows: [] };
    });

    await expect(migrate(client as never, ['001_items.sql'])).rejects.toThrow(
      'Migration 001_items.sql failed: boom'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });
});
