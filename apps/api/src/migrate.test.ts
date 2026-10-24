import { migrate } from './migrate';

function fakeClient(applied: string[], renamed = false, legacy = false) {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT to_regnamespace')) return { rows: [{ renamed, legacy }] };
    if (sql.includes('ALTER SCHEMA bold_cedar_007 RENAME TO endeavor')) {
      renamed = true;
      legacy = false;
    }
    if (sql.startsWith('SELECT filename')) {
      return { rows: applied.map((filename) => ({ filename })) };
    }
    return { rows: [] };
  });
  return { query };
}

describe('migrate', () => {
  it('moves the existing ledger with the schema and records the rename in endeavor', async () => {
    const client = fakeClient(['000_schema.sql', '001_items.sql'], false, true);
    expect(
      await migrate(client as never, ['000_schema.sql', '001_items.sql', '033_endeavor_schema.sql'])
    ).toEqual(['033_endeavor_schema.sql']);
    expect(client.query).toHaveBeenCalledWith(
      'INSERT INTO endeavor.schema_migrations (filename) VALUES ($1)',
      ['033_endeavor_schema.sql']
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('reuses the renamed ledger without creating a second legacy schema on restart', async () => {
    const client = fakeClient(['000_schema.sql', '001_items.sql', '033_endeavor_schema.sql'], true);
    expect(
      await migrate(client as never, ['000_schema.sql', '001_items.sql', '033_endeavor_schema.sql'])
    ).toEqual([]);
    expect(client.query).not.toHaveBeenCalledWith('CREATE SCHEMA IF NOT EXISTS bold_cedar_007');
    expect(client.query).toHaveBeenCalledWith('SELECT filename FROM endeavor.schema_migrations');
  });

  it('refuses ambiguous installations before changing either schema', async () => {
    const client = fakeClient([], true, true);
    await expect(migrate(client as never, [])).rejects.toThrow(
      'Both endeavor and the legacy schema exist'
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('rolls back the schema rename if recording it fails', async () => {
    const client = fakeClient([], false, true);
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT INTO endeavor.')) throw new Error('ledger unavailable');
      return query(sql);
    });
    await expect(migrate(client as never, ['033_endeavor_schema.sql'])).rejects.toThrow(
      'ledger unavailable'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
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
  });

  it('skips files that already ran', async () => {
    const client = fakeClient(['000_schema.sql']);

    const applied = await migrate(client as never, ['000_schema.sql', '001_items.sql']);

    expect(applied).toEqual(['001_items.sql']);
  });

  it('rolls back and names the file when one fails', async () => {
    const client = fakeClient([]);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS bold_cedar_007.items')) {
        throw new Error('boom');
      }
      if (sql.startsWith('SELECT to_regnamespace'))
        return { rows: [{ renamed: false, legacy: false }] };
      return { rows: [] };
    });

    await expect(migrate(client as never, ['001_items.sql'])).rejects.toThrow(
      'Migration 001_items.sql failed: boom'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
