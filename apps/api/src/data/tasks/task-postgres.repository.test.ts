import { FastifyInstance } from 'fastify';
import { CreateTaskInput, StartResponsibilityRunInput } from './task.repository';
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

const scheduled: StartResponsibilityRunInput = {
  responsibilityId: 'r1',
  projectId: 'p1',
  agentId: null,
  runKey: input.runKey,
  endeavorTitle: 'check-service',
  title: 'Check service',
  goal: 'Check the service',
  completionCriteria: 'Report',
  startedBy: { type: 'system', id: null },
  expectedNextRunAt: slot,
  expectedUpdatedAt: slot
};

describe('schedule run persistence', () => {
  it('rejects an invalidated slot without creating an endeavor', async () => {
    const { repository, query, release, outsideQuery } = setup();
    expect(await repository.startResponsibilityRun(scheduled)).toEqual({ reason: 'changed' });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(outsideQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('replays the existing endeavor without creating a new one', async () => {
    const { repository, query } = setup();
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ run_key: scheduled.runKey, conversation_id: 'c1', created_at: slot,
        task_id: null, state: 'waiting' }]
    });
    expect(await repository.startResponsibilityRun(scheduled)).toMatchObject({
      run: { runKey: scheduled.runKey, conversationId: 'c1', state: 'waiting' },
      created: false
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });

  function mockAvailableSchedule(query: jest.Mock) {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT created_by_human_id')) return { rows: [{ created_by_human_id: 'h1' }] };
      if (sql.includes('SELECT id FROM endeavor.responsibilities')) return { rowCount: 1 };
      if (sql.includes('SELECT 1 FROM endeavor.responsibility_run_history')) return { rowCount: 0 };
      if (sql.includes('FROM endeavor.projects')) return { rowCount: 1 };
      if (sql.includes('RETURNING created_at')) return { rows: [{ created_at: slot }] };
      return { rows: [] };
    });
  }

  it('creates an endeavor and a durable decision before committing an unpinned run', async () => {
    const { repository, query } = setup();
    mockAvailableSchedule(query);
    const result = await repository.startResponsibilityRun(scheduled);
    expect(result).toMatchObject({ run: { taskId: null, state: 'routing' }, created: true });
    const writes = query.mock.calls.filter(([sql]) => sql.includes('INSERT'));
    expect(writes.map(([sql]) => sql.match(/INSERT INTO endeavor\.(\w+)/)?.[1])).toEqual([
      'conversations', 'conversation_members', 'messages', 'responsibility_runs', 'routing_decisions'
    ]);
    expect(writes[0][1]).toEqual([
      expect.any(String), scheduled.endeavorTitle, scheduled.projectId, scheduled.goal,
      scheduled.completionCriteria, 'h1'
    ]);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rolls back the run if a catch-up slot expires before saving its answer', async () => {
    const { repository, query, release } = setup();
    mockAvailableSchedule(query);
    expect(await repository.startResponsibilityRun({
      ...scheduled, expectedNextRunAt: undefined, catchUpSlot: slot
    })).toEqual({ reason: 'changed' });
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back a failed catch-up answer before releasing its lock', async () => {
    const { repository, query, release } = setup();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO endeavor.catch_up_decisions')) throw new Error('Failure');
      return { rows: [] };
    });
    await expect(repository.waitForNextResponsibilityRun('r1', slot)).rejects.toThrow('Failure');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('saves the wait decision and clears the question in one statement', async () => {
    const { repository, query } = setup();
    query.mockResolvedValue({ rowCount: 1 });
    expect(await repository.waitForNextResponsibilityRun('r1', slot)).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO endeavor.catch_up_decisions[\s\S]*UPDATE endeavor.responsibilities/),
      ['r1', slot, 'wait', null]
    );
    expect(query).toHaveBeenLastCalledWith('COMMIT');
  });
});

describe('one open task per agent and endeavor', () => {
  it('recovers the winning open task after a concurrent insert conflict', async () => {
    const { repository, outsideQuery } = setup();
    outsideQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes('WHERE conversation_id')
        ? [{ id: 'winner', run_key: 'message:other', conversation_id: 'c1', owner_agent_id: 'a1' }]
        : []
    }));
    expect(
      await repository.create({ ...input, conversationId: 'c1', responsibilityId: null })
    ).toMatchObject({ task: { id: 'winner' }, created: false });
    expect(outsideQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("state IN ('working', 'waiting', 'blocked')"),
      ['c1', 'a1']
    );
  });

  it('returns a run-key replay before considering a different open task', async () => {
    const { repository, outsideQuery } = setup();
    outsideQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes('WHERE run_key') ? [{ id: 'original', run_key: input.runKey }] : []
    }));
    expect(await repository.create({ ...input, conversationId: 'c1' })).toMatchObject({
      task: { id: 'original' },
      created: false
    });
    expect(outsideQuery.mock.calls.some(([sql]) => sql.includes('WHERE conversation_id'))).toBe(
      false
    );
  });
});

describe('conversation agent costs', () => {
  it('maps every grouped agent total without limiting the result', async () => {
    const { repository, outsideQuery } = setup();
    outsideQuery.mockResolvedValue({
      rows: [
        { agent_id: 'a1', name: 'Researcher', cost: '0.04', tokens: '4000', unpriced: 1 },
        { agent_id: 'a2', name: 'Reviewer', cost: '0.03', tokens: '3000', unpriced: 0 }
      ]
    });

    await expect(repository.listAgentCosts({ conversationId: 'c1' })).resolves.toEqual([
      {
        agentId: 'a1',
        name: 'Researcher',
        costUsd: 0.04,
        tokens: 4000,
        unpricedCalls: 1
      },
      {
        agentId: 'a2',
        name: 'Reviewer',
        costUsd: 0.03,
        tokens: 3000,
        unpricedCalls: 0
      }
    ]);
    expect(outsideQuery).toHaveBeenCalledWith(
      expect.stringMatching(/GROUP BY t\.owner_agent_id[\s\S]*ORDER BY cost DESC/),
      ['c1']
    );
    expect(outsideQuery.mock.calls[0][0]).not.toContain('LIMIT');
  });
});
