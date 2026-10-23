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
      return { rows: [] };
    });

    await expect(migrate(client as never, ['001_items.sql'])).rejects.toThrow(
      'Migration 001_items.sql failed: boom'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
