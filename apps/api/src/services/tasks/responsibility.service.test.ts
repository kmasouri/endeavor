import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockProjectRepository,
  mockResponsibilityRepository,
  mockTaskRepository
} from '../../data/repositories.test-helper';
import { ResponsibilityLogger, TaskLogger } from '../../observability';
import { Human, Responsibility, ResponsibilityRun, Task } from '../../shared/types';
import { ResponsibilityService } from './responsibility.service';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const CONV = '00000000-0000-4000-8000-0000000000f1';

const admin: Human = {
  id: ADMIN,
  name: 'Kim',
  role: 'admin',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const responsibility: Responsibility = {
  id: 'r1',
  projectId: 'p1',
  agentId: AGENT,
  conversationId: CONV,
  title: 'Nightly QA',
  brief: 'Test checkout',
  completionCriteria: 'Report results',
  intervalMinutes: 60,
  recurrence: null,
  missedRunPolicy: 'run_once',
  status: 'enabled',
  nextRunAt: new Date(Date.now() + 60_000),
  lastRunAt: null,
  catchUp: null,
  createdByHumanId: ADMIN,
  createdAt: new Date(),
  updatedAt: new Date()
};

const run: ResponsibilityRun = {
  runKey: 'manual:r1:event-42',
  conversationId: 'new-endeavor',
  state: 'working',
  taskId: 't1',
  createdAt: new Date()
};

function setup() {
  const responsibilities = mockResponsibilityRepository();
  const tasks = mockTaskRepository();
  const agents = mockAgentRepository();
  const conversations = mockConversationRepository();
  const humans = mockHumanRepository();
  const projects = mockProjectRepository();
  projects.getDefault.mockResolvedValue({ id: 'p1', archivedAt: null } as never);
  projects.getById.mockResolvedValue({ id: 'p1', archivedAt: null } as never);
  conversations.getById.mockResolvedValue({ id: CONV, projectId: 'p1' } as never);
  humans.getById.mockResolvedValue(admin);
  agents.getById.mockResolvedValue({
    id: AGENT,
    name: 'QA',
    purpose: '',
    currentVersionId: 'v1',
    disabledAt: null,
    monthlyBudgetUsd: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  conversations.getMember.mockResolvedValue({} as never);
  responsibilities.getById.mockResolvedValue(responsibility);
  responsibilities.create.mockImplementation(async (input) => ({ ...responsibility, ...input }));
  responsibilities.update.mockImplementation(async (_id, changes) => ({
    ...responsibility,
    ...changes
  }));
  tasks.startResponsibilityRun.mockImplementation(async (input) => ({
    run: { ...run, runKey: input.runKey },
    task: { id: 't1', ...input } as unknown as Task,
    created: true
  }));
  const responsibilityLogger = {
    onResponsibilityCreated: jest.fn(),
    onResponsibilityStatusChanged: jest.fn(),
    onCatchUpResolved: jest.fn()
  } as unknown as ResponsibilityLogger;
  const taskLogger = { onTaskCreated: jest.fn() } as unknown as TaskLogger;
  const service = new ResponsibilityService(
    responsibilities,
    tasks,
    agents,
    conversations,
    humans,
    responsibilityLogger,
    taskLogger,
    projects
  );
  return { service, responsibilities, tasks, conversations, humans, agents };
}

describe('ResponsibilityService', () => {
  it('uses the legacy endeavor to find the project and accepts an unpinned schedule', async () => {
    const { service, responsibilities } = setup();
    await service.create(ADMIN, {
      conversationId: CONV,
      title: 't',
      brief: 'b',
      completionCriteria: 'c',
      intervalMinutes: 60
    });
    expect(responsibilities.create).toHaveBeenCalledWith(expect.objectContaining({
      agentId: null, projectId: 'p1', conversationId: CONV
    }));
  });

  it('defaults to asking about missed runs, starting now', async () => {
    const { service, responsibilities } = setup();

    await service.create(ADMIN, {
      agentId: AGENT,
      title: 't',
      brief: 'b',
      completionCriteria: 'c',
      intervalMinutes: 60
    });

    expect(responsibilities.create).toHaveBeenCalledWith(
      expect.objectContaining({
        missedRunPolicy: 'ask',
        nextRunAt: expect.any(Date),
        conversationId: null
      })
    );
  });

  it('lets any person change responsibilities, since v1 has one role', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({ ...admin, role: 'member' });

    const outcome = await service.setStatus(ADMIN, 'r1', 'paused').catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({ name: 'forbidden' });
  });

  it('resumes from now, so paused time is not treated as missed runs', async () => {
    const { service, responsibilities } = setup();
    responsibilities.getById.mockResolvedValue({
      ...responsibility,
      status: 'paused',
      nextRunAt: new Date('2026-01-01T00:00:00Z')
    });

    await service.setStatus(ADMIN, 'r1', 'enabled');

    const [, changes] = responsibilities.update.mock.calls[0];
    expect(changes.status).toBe('enabled');
    expect(changes.nextRunAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('turns down a resume that loses a race with a cancel', async () => {
    const { service, responsibilities } = setup();
    responsibilities.getById.mockResolvedValue({ ...responsibility, status: 'paused' });
    // The repository won't change a cancelled row: someone cancelled it at the same moment.
    responsibilities.update.mockResolvedValue(null);

    await expect(service.setStatus(ADMIN, 'r1', 'enabled')).rejects.toMatchObject({
      name: 'responsibilityCancelled'
    });
  });

  it('applies a shorter interval at once', async () => {
    const { service, responsibilities } = setup();
    responsibilities.getById.mockResolvedValue({
      ...responsibility,
      intervalMinutes: 10_080,
      lastRunAt: new Date(Date.now() - 60 * 60_000),
      nextRunAt: new Date(Date.now() + 6 * 24 * 60 * 60_000)
    });

    await service.update(ADMIN, 'r1', { intervalMinutes: 5 });

    const [, changes] = responsibilities.update.mock.calls[0];
    expect(changes.nextRunAt!.getTime()).toBeLessThan(Date.now());
  });

  it('refuses a disabled agent', async () => {
    const { service } = setup();
    const agents = (service as unknown as { agentRepository: { getById: jest.Mock } })
      .agentRepository;
    agents.getById.mockResolvedValue({
      id: AGENT,
      name: 'QA',
      disabledAt: new Date(),
      currentVersionId: 'v1'
    });

    await expect(
      service.create(ADMIN, {
        agentId: AGENT,
        title: 't',
        brief: 'b',
        completionCriteria: 'c',
        intervalMinutes: 60
      })
    ).rejects.toMatchObject({ name: 'agentUnavailable' });
  });

  it('never revives a cancelled responsibility', async () => {
    const { service, responsibilities } = setup();
    responsibilities.getById.mockResolvedValue({ ...responsibility, status: 'cancelled' });

    await expect(service.setStatus(ADMIN, 'r1', 'enabled')).rejects.toMatchObject({
      name: 'responsibilityCancelled'
    });
    await expect(service.startRun(ADMIN, 'r1', {})).rejects.toMatchObject({
      name: 'responsibilityCancelled'
    });
  });

  it('starts a run by hand without changing the schedule', async () => {
    const { service, responsibilities, tasks } = setup();

    const { created } = await service.startRun(ADMIN, 'r1', {
      runKey: 'event-42',
      note: 'Deploy finished'
    });

    expect(created).toBe(true);
    expect(tasks.startResponsibilityRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runKey: 'manual:r1:event-42',
        responsibilityId: 'r1',
        projectId: 'p1',
        goal: 'Test checkout',
        note: 'Deploy finished',
        startedBy: { type: 'human', id: ADMIN }
      })
    );
    expect(responsibilities.advance).not.toHaveBeenCalled();
    expect(responsibilities.update).not.toHaveBeenCalled();
  });

  it('returns the same run for a repeated runKey, even while it is still going', async () => {
    const { service, tasks } = setup();
    tasks.startResponsibilityRun.mockResolvedValue({ run, task: null, created: false });

    const result = await service.startRun(ADMIN, 'r1', { runKey: 'event-42' });

    expect(result).toEqual({ run, created: false });
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('refuses a new run while the last one is still going', async () => {
    const { service, tasks } = setup();
    tasks.startResponsibilityRun.mockResolvedValue({ reason: 'open' });

    await expect(service.startRun(ADMIN, 'r1', { runKey: 'event-43' })).rejects.toMatchObject({
      name: 'responsibilityRunOpen'
    });
    expect(tasks.create).not.toHaveBeenCalled();
  });

  describe('resolveCatchUp', () => {
    const slot = new Date('2026-10-22T04:00:00Z');

    it('starts one run now when the person says run', async () => {
      const { service, responsibilities, tasks } = setup();
      responsibilities.getById.mockResolvedValue({
        ...responsibility,
        catchUp: { slot, missed: 4 }
      });

      const { run: started } = await service.resolveCatchUp(ADMIN, 'r1', 'run');

      expect(started).not.toBeNull();
      expect(tasks.startResponsibilityRun).toHaveBeenCalledWith(expect.objectContaining({
        responsibilityId: 'r1',
        agentId: AGENT,
        catchUpSlot: slot,
        runKey: 'catchup:r1:2026-10-22T04:00:00.000Z',
        note: expect.stringContaining('4 scheduled runs were missed'),
        startedBy: { type: 'human', id: ADMIN }
      }));
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('starts nothing when the person says wait', async () => {
      const { service, responsibilities, tasks } = setup();
      responsibilities.getById.mockResolvedValue({
        ...responsibility,
        catchUp: { slot, missed: 2 }
      });

      const result = await service.resolveCatchUp(ADMIN, 'r1', 'wait');

      expect(result.run).toBeNull();
      expect(result.responsibility.catchUp).toBeNull();
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('refuses an answer after the question lapsed or was already answered', async () => {
      const { service, responsibilities, tasks } = setup();
      responsibilities.getById.mockResolvedValue({
        ...responsibility,
        catchUp: { slot, missed: 2 }
      });
      tasks.startResponsibilityRun.mockResolvedValue({ reason: 'changed' });

      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).rejects.toMatchObject({
        name: 'catchUpNotPending'
      });
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('keeps a refused question available for retry after the agent becomes available', async () => {
      const { service, responsibilities, tasks } = setup();
      const pending = { ...responsibility, catchUp: { slot, missed: 2 } };
      responsibilities.getById.mockResolvedValue(pending);
      tasks.startResponsibilityRun.mockResolvedValueOnce({ reason: 'agent' });
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).rejects.toMatchObject({
        name: 'agentUnavailable'
      });
      expect(tasks.waitForNextResponsibilityRun).not.toHaveBeenCalled();
      expect(pending.catchUp).toEqual({ slot, missed: 2 });
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).resolves.toMatchObject({
        run: { taskId: 't1' }
      });
    });

    it('leaves an open-run refusal pending, including a competing insert', async () => {
      const { service, responsibilities, tasks } = setup();
      responsibilities.getById.mockResolvedValue({
        ...responsibility,
        catchUp: { slot, missed: 2 }
      });
      tasks.startResponsibilityRun.mockResolvedValue({ reason: 'open' });
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).rejects.toMatchObject({
        name: 'responsibilityRunOpen'
      });
      expect(responsibilities.getCatchUpDecision).not.toHaveBeenCalled();
    });

    it('retries an insert failure without clearing the question', async () => {
      const { service, responsibilities, tasks } = setup();
      responsibilities.getById.mockResolvedValue({
        ...responsibility,
        catchUp: { slot, missed: 2 }
      });
      tasks.startResponsibilityRun.mockRejectedValueOnce(new Error('Database failure'));
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).rejects.toThrow('Database failure');
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).resolves.toMatchObject({
        run: { taskId: 't1' }
      });
    });

    it.each([false, true])(
      'replays a committed run after response loss (stale pending=%s)',
      async (stale) => {
        const { service, responsibilities, tasks, agents } = setup();
        responsibilities.getById.mockResolvedValue({
          ...responsibility,
          catchUp: stale ? { slot, missed: 2 } : null
        });
        responsibilities.getCatchUpDecision.mockResolvedValue({
          slot,
          decision: 'run',
          taskId: 'original',
          runKey: null
        });
        tasks.getById.mockResolvedValue({ id: 'original', runKey: 'catchup:r1:slot' } as Task);
        tasks.getResponsibilityRun.mockResolvedValue({ ...run, taskId: 'original' });
        tasks.startResponsibilityRun.mockResolvedValue({ reason: 'changed' });
        const result = await service.resolveCatchUp(ADMIN, 'r1', 'run');
        expect(result.run?.taskId).toBe('original');
        expect(result.responsibility.catchUp).toBeNull();
        if (!stale) expect(agents.getById).not.toHaveBeenCalled();
      }
    );

    it('replays wait, while preserving the first answer against an opposing retry', async () => {
      const { service, responsibilities, tasks } = setup();
      responsibilities.getCatchUpDecision.mockResolvedValue({
        slot,
        decision: 'wait',
        taskId: null,
        runKey: null
      });
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'wait')).resolves.toMatchObject({
        run: null
      });
      await expect(service.resolveCatchUp(ADMIN, 'r1', 'run')).rejects.toMatchObject({
        name: 'catchUpNotPending'
      });
      expect(tasks.startResponsibilityRun).not.toHaveBeenCalled();
    });

    it('refuses when there is no question at all', async () => {
      const { service } = setup();

      await expect(service.resolveCatchUp(ADMIN, 'r1', 'wait')).rejects.toMatchObject({
        name: 'catchUpNotPending'
      });
    });
  });
});

describe('calendar schedule controls', () => {
  const rule = { frequency: 'daily' as const, time: '09:00', timeZone: 'America/New_York' };
  const paused = {
    ...responsibility,
    intervalMinutes: null,
    recurrence: rule,
    status: 'paused' as const,
    nextRunAt: new Date('2026-03-07T14:00:00Z')
  };
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-03-08T15:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('creates the first matching source-time slot in UTC', async () => {
    const { service, responsibilities } = setup();
    await service.create(ADMIN, {
      agentId: AGENT,
      title: 'Daily QA',
      brief: 'Test',
      completionCriteria: 'Report',
      recurrence: rule
    });
    expect(responsibilities.create).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMinutes: null,
        recurrence: rule,
        nextRunAt: new Date('2026-03-09T13:00:00Z')
      })
    );
  });
  it('resumes at the next matching slot, without running paused time', async () => {
    const { service, responsibilities, tasks } = setup();
    responsibilities.getById.mockResolvedValue(paused);
    await service.setStatus(ADMIN, 'r1', 'enabled');
    expect(responsibilities.update).toHaveBeenCalledWith('r1', {
      status: 'enabled',
      nextRunAt: new Date('2026-03-09T13:00:00Z')
    });
    expect(tasks.create).not.toHaveBeenCalled();
  });
  it('allows a manual run while paused and leaves the recurring slot untouched', async () => {
    const { service, responsibilities, tasks } = setup();
    responsibilities.getById.mockResolvedValue(paused);
    await service.startRun(ADMIN, 'r1', { runKey: 'manual-dst' });
    expect(tasks.startResponsibilityRun).toHaveBeenCalledWith(
      expect.objectContaining({ runKey: 'manual:r1:manual-dst' })
    );
    expect(responsibilities.advance).not.toHaveBeenCalled();
    expect(responsibilities.update).not.toHaveBeenCalled();
  });
  it('switches an interval to calendar recurrence without a synthetic interval', async () => {
    const { service, responsibilities } = setup();
    await service.update(ADMIN, 'r1', { recurrence: rule });
    expect(responsibilities.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        recurrence: rule,
        intervalMinutes: null,
        nextRunAt: new Date('2026-03-09T13:00:00Z')
      })
    );
  });
  it('switches back to a real interval and rejects arbitrary calendar slots', async () => {
    const { service, responsibilities } = setup();
    responsibilities.getById.mockResolvedValue(paused);
    await expect(service.update(ADMIN, 'r1', { nextRunAt: new Date() })).rejects.toMatchObject({
      name: 'validationError'
    });
    await service.update(ADMIN, 'r1', { intervalMinutes: 60 });
    expect(responsibilities.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        recurrence: null,
        intervalMinutes: 60,
        nextRunAt: new Date('2026-03-08T16:00:00Z')
      })
    );
  });
  it('reports an open run when a competing start wins the database constraint', async () => {
    const { service, tasks } = setup();
    tasks.startResponsibilityRun.mockResolvedValue({ reason: 'open' });
    await expect(service.startRun(ADMIN, 'r1', { runKey: 'manual-race' })).rejects.toMatchObject({
      name: 'responsibilityRunOpen'
    });
  });
});
