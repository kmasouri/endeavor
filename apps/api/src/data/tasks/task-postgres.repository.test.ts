import { FastifyInstance } from 'fastify';
import { CreateTaskInput } from './task.repository';
import { TaskPostgresRepository } from './task-postgres.repository';

const slot = new Date('2026-10-29T12:00:00Z');
const input: CreateTaskInput = {
  runKey: 'schedule:r1:2026-10-29T12:00:00.000Z',
  ownerAgentId: 'a1',
  agentVersionId: 'v1',
  responsibilityId: 'r1',
  title: 'Check',
  brief: 'Check the service',
  completionCriteria: 'Report',
  conversationId: null,
  reviewRequired: false,
  requestedByType: 'schedule',
  requestedById: null,
  requestMessageId: null,
  parentTaskId: null,
  restartedFromTaskId: null
};

function setup() {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const release = jest.fn();
  const client = { query, release };
  const outsideQuery = jest.fn();
  const repository = new TaskPostgresRepository({
    query: outsideQuery,
    connect: jest.fn().mockResolvedValue(client)
  } as unknown as FastifyInstance['pg']);
  return { repository, query, release, outsideQuery };
}

describe('scheduled task persistence', () => {
  it('rejects an invalidated slot without inserting a task and releases its connection', async () => {
    const { repository, query, release, outsideQuery } = setup();
    expect(await repository.createScheduled(input, slot)).toBeNull();
    expect(query.mock.calls[2]).toEqual([
      expect.stringMatching(/status = 'enabled' AND next_run_at = \$3\s+FOR SHARE/),
      ['r1', 'a1', slot]
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(outsideQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('recovers a conflicting run on the locked connection before committing', async () => {
    const { repository, query, release, outsideQuery } = setup();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM endeavor.responsibilities')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('WHERE run_key')) return { rows: [{ id: 't1', run_key: input.runKey }] };
      return { rows: [] };
    });
    expect(await repository.createScheduled(input, slot)).toMatchObject({
      task: { id: 't1', runKey: input.runKey },
      created: false
    });
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(outsideQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back a failed insert before releasing the schedule lock', async () => {
    const { repository, query, release } = setup();
    const failure = new Error('Insert failed');
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM endeavor.responsibilities')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('INSERT')) throw failure;
      return { rows: [] };
    });
    await expect(repository.createScheduled(input, slot)).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
