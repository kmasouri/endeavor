import { FastifyInstance } from 'fastify';
import { AgentPostgresRepository } from './agent-postgres.repository';

function setup() {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn()
  };
  const db = { connect: jest.fn().mockResolvedValue(client), query: jest.fn() };
  return {
    client,
    repository: new AgentPostgresRepository(db as unknown as FastifyInstance['pg'])
  };
}

describe('agent deletion transaction', () => {
  it('rolls back cancellation failures, keeping the identity and work together', async () => {
    const { client, repository } = setup();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE endeavor.agents')) return { rows: [{ id: 'a' }] };
      if (sql.includes('UPDATE endeavor.tasks')) throw new Error('write failed');
      return { rows: [] };
    });
    await expect(repository.delete('a', 'person')).rejects.toThrow('write failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('preserves history and records the cancellation of every affected run', async () => {
    const { client, repository } = setup();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE endeavor.agents')) return { rows: [{ id: 'a' }] };
      if (sql.includes('UPDATE endeavor.tasks'))
        return {
          rows: [
            { id: 't1', previous_state: 'working' },
            { id: 't2', previous_state: 'waiting' }
          ]
        };
      return { rows: [] };
    });
    await expect(repository.delete('a', 'person')).resolves.toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO endeavor.task_events'),
      [['t1', 't2'], 'person', ['working', 'waiting']]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE endeavor.task_waits'),
      [['t1', 't2']]
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.some(([sql]) => /DELETE FROM/.test(sql))).toBe(false);
  });

  it('releases the connection immediately when deletion owns the execution lock', async () => {
    const { client, repository } = setup();
    client.query.mockResolvedValue({ rows: [{ held: false }] });
    await expect(repository.acquireExecution('a')).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalled();
  });

  it('holds execution until the caller releases it and destroys a connection if unlock fails', async () => {
    const { client, repository } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [{ held: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'a' }] });
    const release = await repository.acquireExecution('a');
    expect(client.release).not.toHaveBeenCalled();
    client.query.mockRejectedValueOnce(new Error('connection lost'));
    await expect(release!()).rejects.toThrow('connection lost');
    expect(client.release).toHaveBeenCalledWith(true);
  });
});

it('saves and resets appearance independently without changing the configuration version', async () => {
  const row = {
    id: 'a',
    name: 'Researcher',
    purpose: 'Research',
    avatar_color: 'teal',
    avatar_icon: 'file',
    current_version_id: 'v1',
    monthly_budget_usd: null,
    disabled_at: null,
    deleted_at: null
  };
  const db = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
  const repository = new AgentPostgresRepository(db as unknown as FastifyInstance['pg']);
  const saved = await repository.update('a', { avatarColor: 'teal', avatarIcon: 'file' });
  expect(saved).toMatchObject({ avatarColor: 'teal', avatarIcon: 'file', currentVersionId: 'v1' });
  expect(db.query.mock.calls[0][1]).toEqual([
    'a',
    null,
    null,
    false,
    null,
    true,
    'teal',
    true,
    'file'
  ]);
  await repository.update('a', { avatarColor: null });
  expect(db.query.mock.calls[1][1]).toEqual([
    'a',
    null,
    null,
    false,
    null,
    true,
    null,
    false,
    null
  ]);
  await repository.update('a', { name: 'Renamed' });
  expect(db.query.mock.calls[2][1]).toEqual([
    'a',
    'Renamed',
    null,
    false,
    null,
    false,
    null,
    false,
    null
  ]);
});
