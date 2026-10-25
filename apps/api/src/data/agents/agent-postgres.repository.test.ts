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
