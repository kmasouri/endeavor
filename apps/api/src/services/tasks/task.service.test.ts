import { TaskRepository } from '../../data';
import {
  mockAgentRepository,
  mockApprovalRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockTaskRepository
} from '../../data/repositories.test-helper';
import { TaskLogger } from '../../observability';
import { Agent, Human, Task, TaskWait } from '../../shared/types';
import { TaskService } from './task.service';

const HUMAN_ID = '00000000-0000-4000-8000-000000000001';
const AGENT_ID = '00000000-0000-4000-8000-0000000000a1';
const VERSION_ID = '00000000-0000-4000-8000-0000000000b1';
const TASK_ID = '00000000-0000-4000-8000-0000000000c1';
const NEW_TASK_ID = '00000000-0000-4000-8000-0000000000c2';
const WAIT_ID = '00000000-0000-4000-8000-0000000000d1';

const human: Human = {
  id: HUMAN_ID,
  name: 'Kim',
  role: 'member',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const agentActor = { type: 'agent' as const, id: AGENT_ID };

const agent: Agent = {
  id: AGENT_ID,
  name: 'Researcher',
  purpose: 'Finds and summarizes sources',
  currentVersionId: VERSION_ID,
  disabledAt: null,
  monthlyBudgetUsd: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    runKey: 'human:1',
    conversationId: null,
    ownerAgentId: AGENT_ID,
    agentVersionId: VERSION_ID,
    title: 'Summarize sources',
    brief: 'Read the docs and summarize them',
    completionCriteria: 'A summary with citations',
    reviewRequired: false,
    state: 'working',
    stateReason: null,
    pausedAt: null,
    requestedByType: 'human',
    requestedById: HUMAN_ID,
    requestMessageId: null,
    parentTaskId: null,
    restartedFromTaskId: null,
    responsibilityId: null,
    criteriaCheck: null,
    review: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: null,
    ...overrides
  };
}

function makeWait(overrides: Partial<TaskWait> = {}): TaskWait {
  return {
    id: WAIT_ID,
    taskId: TASK_ID,
    kind: 'reply',
    targetId: '00000000-0000-4000-8000-0000000000e1',
    description: 'Reply from Reviewer',
    createdAt: new Date(),
    resolvedAt: null,
    resolution: null,
    ...overrides
  };
}

function setup() {
  const tasks = mockTaskRepository();
  // By default an update succeeds and returns the task with the changes applied.
  tasks.update.mockImplementation(async (_id, _expected, changes) =>
    makeTask(changes as Partial<Task>)
  );
  tasks.addWaits.mockImplementation(async (_id, waits) => waits.map((wait) => makeWait(wait)));
  tasks.resolveWait.mockResolvedValue(makeWait({ resolvedAt: new Date() }));
  tasks.countOutputs.mockResolvedValue(1);
  const agents = mockAgentRepository();
  agents.getById.mockResolvedValue(agent);
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(human);
  const logger = {
    onTaskCreated: jest.fn(),
    onTaskStateChanged: jest.fn(),
    onTaskPaused: jest.fn(),
    onTaskResumed: jest.fn(),
    onTaskRestarted: jest.fn(),
    onTaskVersionMigrated: jest.fn(),
    onApprovalApproved: jest.fn(),
    onApprovalRejected: jest.fn(),
    onTaskCompletionRejected: jest.fn()
  } as unknown as jest.Mocked<TaskLogger>;

  const conversations = mockConversationRepository();
  const approvals = mockApprovalRepository();
  const service = new TaskService(tasks, agents, humans, conversations, approvals, logger);
  return { service, tasks, agents, humans, conversations, approvals, logger };
}

function eventTypes(tasks: jest.Mocked<TaskRepository>): string[] {
  return tasks.addEvent.mock.calls.map(([, type]) => type);
}

describe('TaskService', () => {
  describe('createTask', () => {
    it("pins the agent's current version and records who asked", async () => {
      const { service, tasks } = setup();
      tasks.create.mockResolvedValue({ task: makeTask(), created: true });

      const result = await service.createTask(HUMAN_ID, {
        ownerAgentId: AGENT_ID,
        title: 'Summarize sources',
        brief: 'Read the docs',
        completionCriteria: 'A summary with citations'
      });

      expect(result.created).toBe(true);
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentVersionId: VERSION_ID,
          requestedByType: 'human',
          requestedById: HUMAN_ID,
          reviewRequired: false
        })
      );
      expect(eventTypes(tasks)).toEqual(['task.created']);
    });

    it('returns the existing task for a repeated runKey without recording it again', async () => {
      const { service, tasks } = setup();
      tasks.create.mockResolvedValue({ task: makeTask(), created: false });

      const result = await service.createTask(HUMAN_ID, {
        ownerAgentId: AGENT_ID,
        title: 't',
        brief: 'b',
        completionCriteria: 'c',
        runKey: 'abc'
      });

      expect(result.created).toBe(false);
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ runKey: `client:${HUMAN_ID}:${AGENT_ID}:abc` })
      );
      expect(tasks.addEvent).not.toHaveBeenCalled();
    });

    it('rejects an unknown person', async () => {
      const { service, humans } = setup();
      humans.getById.mockResolvedValue(null);

      await expect(
        service.createTask(HUMAN_ID, {
          ownerAgentId: AGENT_ID,
          title: 't',
          brief: 'b',
          completionCriteria: 'c'
        })
      ).rejects.toMatchObject({ name: 'actorNotFound' });
    });

    it('rejects a disabled agent', async () => {
      const { service, agents } = setup();
      agents.getById.mockResolvedValue({ ...agent, disabledAt: new Date() });

      await expect(
        service.createTask(HUMAN_ID, {
          ownerAgentId: AGENT_ID,
          title: 't',
          brief: 'b',
          completionCriteria: 'c'
        })
      ).rejects.toMatchObject({ name: 'agentUnavailable' });
    });
  });

  describe('who can see a task', () => {
    const OTHER = '00000000-0000-4000-8000-000000000009';

    it("shows a task to any person, even one who didn't ask for it", async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(
        makeTask({ requestedById: OTHER, conversationId: '00000000-0000-4000-8000-0000000000f1' })
      );

      await expect(service.getTask(HUMAN_ID, TASK_ID)).resolves.toMatchObject({ id: TASK_ID });
    });

    it('shows it to members of its conversation', async () => {
      const { service, tasks, conversations } = setup();
      tasks.getById.mockResolvedValue(
        makeTask({ requestedById: OTHER, conversationId: '00000000-0000-4000-8000-0000000000f1' })
      );
      conversations.getMember.mockResolvedValue({} as never);

      await expect(service.getTask(HUMAN_ID, TASK_ID)).resolves.toMatchObject({ id: TASK_ID });
    });

    it('shows everything to admins', async () => {
      const { service, tasks, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask({ requestedById: OTHER }));

      await expect(service.getTask(HUMAN_ID, TASK_ID)).resolves.toMatchObject({ id: TASK_ID });
    });

    it('shows every person all tasks, since v1 has one role', async () => {
      const { service, tasks } = setup();
      tasks.list.mockResolvedValue([]);
      tasks.count.mockResolvedValue(0);

      await service.listTasks(HUMAN_ID, { limit: 10, offset: 0 });

      expect(tasks.list.mock.calls[0][0]).not.toHaveProperty('visibleToHumanId');
    });
  });

  describe('approvals', () => {
    const pending = {
      id: 'ap1',
      taskId: TASK_ID,
      agentId: AGENT_ID,
      kind: 'connection_call' as const,
      request: {
        connectionId: 'c1',
        connectionName: 'Billing',
        method: 'POST' as const,
        path: '/refunds',
        body: null
      },
      status: 'pending' as const,
      decidedByHumanId: null,
      decidedAt: null,
      reason: null,
      executedAt: null,
      result: null,
      createdAt: new Date()
    };

    it('approves without waking the task: the runner makes the call first', async () => {
      const { service, tasks, approvals } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));
      approvals.getById.mockResolvedValue(pending);
      approvals.decide.mockResolvedValue({ ...pending, status: 'approved' });

      await service.approve(HUMAN_ID, 'ap1', 'Fine');

      expect(approvals.decide).toHaveBeenCalledWith({
        approvalId: 'ap1',
        status: 'approved',
        humanId: HUMAN_ID,
        reason: 'Fine'
      });
      expect(tasks.resolveWait).not.toHaveBeenCalled();
    });

    it('rejects, tells the agent why, and wakes the task', async () => {
      const { service, tasks, approvals } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));
      approvals.getById.mockResolvedValue(pending);
      approvals.decide.mockResolvedValue({ ...pending, status: 'rejected' });
      tasks.findOpenWaits.mockResolvedValue([makeWait({ kind: 'approval', targetId: 'ap1' })]);

      await service.reject(HUMAN_ID, 'ap1', 'Too large');

      expect(tasks.addEvent).toHaveBeenCalledWith(
        TASK_ID,
        'approval.rejected',
        expect.anything(),
        expect.objectContaining({ reason: 'Too large' })
      );
      expect(tasks.resolveWait).toHaveBeenCalledWith(WAIT_ID, {
        approvalId: 'ap1',
        approved: false
      });
    });

    it('refuses to approve when the task moved on, such as after a cancel', async () => {
      const { service, tasks, approvals } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'cancelled' }));
      approvals.getById.mockResolvedValue(pending);

      await expect(service.approve(HUMAN_ID, 'ap1')).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
      expect(approvals.decide).not.toHaveBeenCalled();
    });

    it('refuses a second decision and says what was decided', async () => {
      const { service, tasks, approvals } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));
      approvals.getById
        .mockResolvedValueOnce(pending)
        .mockResolvedValue({ ...pending, status: 'approved' });
      approvals.getById.mockResolvedValue(pending);
      approvals.decide.mockResolvedValue(null);

      await expect(service.approve(HUMAN_ID, 'ap1')).rejects.toMatchObject({
        name: 'approvalAlreadyDecided'
      });
    });

    it('lets any person decide approvals, even outside their conversations', async () => {
      const { service, tasks, approvals } = setup();
      tasks.getById.mockResolvedValue(
        makeTask({ requestedById: 'someone-else', conversationId: 'conv' })
      );
      approvals.getById.mockResolvedValue(pending);

      const outcome = await service.approve(HUMAN_ID, 'ap1').catch((error: unknown) => error);
      expect(outcome).not.toMatchObject({ name: 'approvalNotFound' });
    });
  });

  describe('pause and resume', () => {
    it('pauses without changing the state', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));

      await service.pauseTask(HUMAN_ID, TASK_ID, 'Hold on');

      const [, expected, changes] = tasks.update.mock.calls[0];
      expect(expected).toEqual({ state: 'waiting', paused: false, agentVersionId: VERSION_ID });
      expect(changes).toEqual({ pausedAt: expect.any(Date) });
      expect(eventTypes(tasks)).toEqual(['task.paused']);
    });

    it('does not pause a task that is already paused or finished', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValueOnce(makeTask({ pausedAt: new Date() }));
      await expect(service.pauseTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });

      tasks.getById.mockResolvedValueOnce(makeTask({ state: 'completed' }));
      await expect(service.pauseTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });

    it('resumes a paused task in its old state', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting', pausedAt: new Date() }));
      tasks.update.mockResolvedValue(makeTask({ state: 'waiting' }));

      const task = await service.resumeTask(HUMAN_ID, TASK_ID);

      expect(task.state).toBe('waiting');
      expect(tasks.update).toHaveBeenCalledTimes(1);
      expect(eventTypes(tasks)).toEqual(['task.resumed']);
    });

    it('sends a blocked task back to working', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'blocked', stateReason: 'No access' }));

      const task = await service.resumeTask(HUMAN_ID, TASK_ID, 'Access granted');

      expect(task.state).toBe('working');
      expect(eventTypes(tasks)).toEqual(['task.state.changed', 'task.resumed']);
    });

    it('clears the pause and unblocks in one write', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'blocked', pausedAt: new Date() }));

      await service.resumeTask(HUMAN_ID, TASK_ID);

      expect(tasks.update).toHaveBeenCalledTimes(1);
      expect(tasks.update.mock.calls[0][2]).toMatchObject({ state: 'working', pausedAt: null });
    });

    it('does not resume finished work', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'completed', pausedAt: new Date() }));

      await expect(service.resumeTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });

    it('refuses to resume a task that is neither paused nor blocked', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask());

      await expect(service.resumeTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });

    it('reports a conflict when the task changed at the same time', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask());
      tasks.update.mockResolvedValue(null);

      await expect(service.pauseTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });
  });

  describe('cancelTask', () => {
    it('cancels, clears the pause, and closes open waits', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting', pausedAt: new Date() }));

      const task = await service.cancelTask(HUMAN_ID, TASK_ID, 'Not needed');

      expect(task.state).toBe('cancelled');
      expect(tasks.update.mock.calls[0][2]).toMatchObject({
        state: 'cancelled',
        stateReason: 'Not needed',
        pausedAt: null,
        finishedAt: expect.any(Date)
      });
      expect(tasks.resolveOpenWaits).toHaveBeenCalledWith(TASK_ID, { cancelled: true });
    });

    it('does not cancel finished work', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'completed' }));

      await expect(service.cancelTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });
  });

  describe('migrateTaskVersion', () => {
    const v2 = {
      id: 'v2',
      agentId: AGENT_ID,
      version: 2,
      instructions: 'New',
      provider: 'scripted' as const,
      model: 'm',
      skillVersionIds: [],
      connectionIds: [],
      limits: {},
      createdByHumanId: HUMAN_ID,
      createdAt: new Date()
    };

    it("moves a waiting task to the agent's current version and records it", async () => {
      const { service, tasks, agents, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));
      agents.getById.mockResolvedValue({ ...agent, currentVersionId: 'v2' });
      agents.getVersion.mockResolvedValue(v2);

      await service.migrateTaskVersion(HUMAN_ID, TASK_ID, { reason: 'New instructions' });

      expect(tasks.update.mock.calls[0][2]).toEqual({ agentVersionId: 'v2' });
      expect(tasks.addEvent).toHaveBeenCalledWith(
        TASK_ID,
        'task.version.migrated',
        { type: 'human', id: HUMAN_ID },
        { fromVersionId: VERSION_ID, toVersionId: 'v2', toVersion: 2, reason: 'New instructions' }
      );
    });

    it('lets any person move a task to a new version, since v1 has one role', async () => {
      const { service } = setup();

      const outcome = await service
        .migrateTaskVersion(HUMAN_ID, TASK_ID, {})
        .catch((error: unknown) => error);
      expect(outcome).not.toMatchObject({ name: 'forbidden' });
    });

    it("refuses another agent's version", async () => {
      const { service, tasks, agents, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask());
      agents.getVersion.mockResolvedValue({ ...v2, agentId: 'someone-else' });

      await expect(
        service.migrateTaskVersion(HUMAN_ID, TASK_ID, { versionId: 'v2' })
      ).rejects.toMatchObject({ name: 'agentVersionNotFound' });
    });

    it('changes nothing when the task is already on that version', async () => {
      const { service, tasks, agents, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask({ agentVersionId: 'v2' }));
      agents.getVersion.mockResolvedValue(v2);

      await service.migrateTaskVersion(HUMAN_ID, TASK_ID, { versionId: 'v2' });

      expect(tasks.update).not.toHaveBeenCalled();
      expect(tasks.addEvent).not.toHaveBeenCalled();
    });

    it('says the agent is unavailable when it has no current version', async () => {
      const { service, tasks, agents, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask());
      agents.getById.mockResolvedValue(null);

      await expect(service.migrateTaskVersion(HUMAN_ID, TASK_ID, {})).rejects.toMatchObject({
        name: 'agentUnavailable'
      });
    });

    it('rejects a version that does not exist', async () => {
      const { service, tasks, agents, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask());
      agents.getVersion.mockResolvedValue(null);

      await expect(
        service.migrateTaskVersion(HUMAN_ID, TASK_ID, { versionId: 'missing' })
      ).rejects.toMatchObject({ name: 'agentVersionNotFound' });
    });

    it('does not migrate finished work', async () => {
      const { service, tasks, humans } = setup();
      humans.getById.mockResolvedValue({ ...human, role: 'admin' });
      tasks.getById.mockResolvedValue(makeTask({ state: 'completed' }));

      await expect(service.migrateTaskVersion(HUMAN_ID, TASK_ID, {})).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });
  });

  describe('restartTask', () => {
    it('creates a new linked task and leaves the old one alone', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'completed' }));
      tasks.create.mockResolvedValue({
        task: makeTask({ id: NEW_TASK_ID, restartedFromTaskId: TASK_ID }),
        created: true
      });

      const { task, created } = await service.restartTask(HUMAN_ID, TASK_ID);

      expect(created).toBe(true);
      expect(task.restartedFromTaskId).toBe(TASK_ID);
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ runKey: `restart:${TASK_ID}`, restartedFromTaskId: TASK_ID })
      );
      expect(tasks.update).not.toHaveBeenCalled();
      expect(tasks.addEvent).toHaveBeenCalledWith(TASK_ID, 'task.restarted', expect.anything(), {
        newTaskId: NEW_TASK_ID,
        reason: null
      });
    });

    it('turns a restart with a reason into a revision request with the previous result', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'completed' }));
      tasks.listOutputs.mockResolvedValue([
        {
          id: 'o1',
          taskId: TASK_ID,
          kind: 'text',
          title: 'Result',
          content: 'First draft',
          uri: null,
          metadata: {},
          createdAt: new Date()
        }
      ]);
      tasks.create.mockResolvedValue({ task: makeTask({ id: NEW_TASK_ID }), created: true });

      await service.restartTask(HUMAN_ID, TASK_ID, 'Add sources for each claim');

      const brief = tasks.create.mock.calls[0][0].brief;
      expect(brief).toContain('Changes requested: Add sources for each claim');
      expect(brief).toContain('Previous result:\nFirst draft');
    });

    it('returns the earlier restart without checking the agent again', async () => {
      const { service, tasks, agents } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'completed' }));
      tasks.getByRunKey.mockResolvedValue(makeTask({ id: NEW_TASK_ID }));
      agents.getById.mockResolvedValue({ ...agent, disabledAt: new Date() });

      const { task, created } = await service.restartTask(HUMAN_ID, TASK_ID);

      expect(created).toBe(false);
      expect(task.id).toBe(NEW_TASK_ID);
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('only restarts finished work', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));

      await expect(service.restartTask(HUMAN_ID, TASK_ID)).rejects.toMatchObject({
        name: 'taskStateConflict'
      });
    });
  });

  describe('waits', () => {
    it('moves a working task to waiting with its waits', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask());

      const task = await service.waitFor(TASK_ID, agentActor, [
        { kind: 'reply', targetId: 'm1', description: 'Reply from Reviewer' }
      ]);

      expect(task.state).toBe('waiting');
      expect(task.waits).toHaveLength(1);
      expect(tasks.update.mock.calls[0][2]).toMatchObject({
        state: 'waiting',
        stateReason: 'Reply from Reviewer'
      });
    });

    it('closes the new waits again if the state change loses a race', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask());
      tasks.update.mockResolvedValue(null);

      await expect(
        service.waitFor(TASK_ID, agentActor, [
          { kind: 'external', targetId: null, description: 'x' }
        ])
      ).rejects.toMatchObject({ name: 'taskStateConflict' });
      expect(tasks.resolveWait).toHaveBeenCalledWith(WAIT_ID, { abandoned: true });
    });

    it('goes back to working when the last wait resolves', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));
      tasks.listWaits.mockResolvedValue([]);

      const task = await service.resolveWait(WAIT_ID, agentActor, { messageId: 'm2' });

      expect(task.state).toBe('working');
      expect(eventTypes(tasks)).toEqual(['task.wait.resolved', 'task.state.changed']);
    });

    it('keeps waiting while other waits are open', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));
      tasks.listWaits.mockResolvedValue([makeWait({ id: 'other' })]);

      const task = await service.resolveWait(WAIT_ID, agentActor, {});

      expect(task.state).toBe('waiting');
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it('stays paused when a wait resolves on a paused task', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting', pausedAt: new Date() }));

      await service.resolveWait(WAIT_ID, agentActor, {});

      const [, expected, changes] = tasks.update.mock.calls[0];
      expect(expected).toEqual({ state: 'waiting', paused: true, agentVersionId: VERSION_ID });
      expect(changes).not.toHaveProperty('pausedAt');
    });

    it('tries again when a pause lands at the same moment', async () => {
      const { service, tasks } = setup();
      tasks.getById
        .mockResolvedValueOnce(makeTask({ state: 'waiting' }))
        .mockResolvedValueOnce(makeTask({ state: 'waiting', pausedAt: new Date() }));
      tasks.update.mockResolvedValueOnce(null);

      const task = await service.resolveWait(WAIT_ID, agentActor, {});

      expect(task.state).toBe('working');
      expect(tasks.update.mock.calls[1][1]).toEqual({
        state: 'waiting',
        paused: true,
        agentVersionId: VERSION_ID
      });
    });

    it('reports a wait that is already resolved', async () => {
      const { service, tasks } = setup();
      tasks.resolveWait.mockResolvedValue(null);

      await expect(service.resolveWait(WAIT_ID, agentActor, {})).rejects.toMatchObject({
        name: 'taskWaitNotFound'
      });
    });
  });

  describe('completeTask', () => {
    it('completes with an output and a passing criteria check', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask());

      const task = await service.completeTask(TASK_ID, agentActor, {
        met: true,
        summary: 'Summary cites all three sources'
      });

      expect(task.state).toBe('completed');
      expect(tasks.update.mock.calls[0][2]).toMatchObject({
        state: 'completed',
        criteriaCheck: { met: true, checkedBy: agentActor },
        finishedAt: expect.any(Date)
      });
    });

    it('refuses to complete without an output', async () => {
      const { service, tasks, logger } = setup();
      tasks.getById.mockResolvedValue(makeTask());
      tasks.countOutputs.mockResolvedValue(0);

      await expect(
        service.completeTask(TASK_ID, agentActor, { met: true, summary: 'Done' })
      ).rejects.toMatchObject({ name: 'taskCompletionRejected' });
      expect(logger.onTaskCompletionRejected).toHaveBeenCalled();
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it('refuses to complete when the criteria are not met', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask());

      await expect(
        service.completeTask(TASK_ID, agentActor, { met: false, summary: 'One source missing' })
      ).rejects.toMatchObject({ name: 'taskCompletionRejected' });
    });

    it('refuses to complete a paused task', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ pausedAt: new Date() }));

      await expect(
        service.completeTask(TASK_ID, agentActor, { met: true, summary: 'Done' })
      ).rejects.toMatchObject({ name: 'taskStateConflict' });
    });

    it('waits for a human review when the task needs one', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ reviewRequired: true }));

      await service.completeTask(TASK_ID, agentActor, { met: true, summary: 'Done' });

      expect(tasks.addWaits).toHaveBeenCalledWith(TASK_ID, [
        expect.objectContaining({ kind: 'approval', targetId: TASK_ID })
      ]);
      const states = tasks.update.mock.calls.map(([, , changes]) => changes.state);
      expect(states).not.toContain('completed');
      expect(states).toContain('waiting');
    });
  });

  describe('reviewTask', () => {
    const reviewWait = makeWait({ kind: 'approval', targetId: TASK_ID });

    it('completes the task when the review approves', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting', reviewRequired: true }));
      tasks.findOpenWaits.mockResolvedValue([reviewWait]);

      const task = await service.reviewTask(HUMAN_ID, TASK_ID, { approved: true });

      expect(task.state).toBe('completed');
      expect(tasks.resolveWait).toHaveBeenCalledWith(WAIT_ID, expect.anything());
    });

    it('sends the task back to working with the notes when changes are asked', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting', reviewRequired: true }));
      tasks.findOpenWaits.mockResolvedValue([reviewWait]);

      const task = await service.reviewTask(HUMAN_ID, TASK_ID, {
        approved: false,
        notes: 'Add a source for the second claim'
      });

      expect(task.state).toBe('working');
      expect(tasks.update.mock.calls[0][2]).toMatchObject({
        stateReason: 'Review asked for changes: Add a source for the second claim'
      });
    });

    it('changes nothing else when the state change loses a race', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting', reviewRequired: true }));
      tasks.findOpenWaits.mockResolvedValue([reviewWait]);
      tasks.update.mockResolvedValue(null);

      await expect(service.reviewTask(HUMAN_ID, TASK_ID, { approved: true })).rejects.toMatchObject(
        { name: 'taskStateConflict' }
      );
      expect(tasks.resolveWait).not.toHaveBeenCalled();
      expect(tasks.addEvent).not.toHaveBeenCalled();
    });

    it('refuses when the task is not waiting for review', async () => {
      const { service, tasks } = setup();
      tasks.getById.mockResolvedValue(makeTask({ state: 'waiting' }));

      await expect(service.reviewTask(HUMAN_ID, TASK_ID, { approved: true })).rejects.toMatchObject(
        { name: 'taskStateConflict' }
      );
    });
  });

  it('blocks with a reason', async () => {
    const { service, tasks } = setup();
    tasks.getById.mockResolvedValue(makeTask());

    const task = await service.blockTask(TASK_ID, agentActor, 'Needs access to the billing docs');

    expect(task.state).toBe('blocked');
    expect(task.stateReason).toBe('Needs access to the billing docs');
  });

  describe('listConversationOutputs', () => {
    it('lists outputs from every task in the conversation', async () => {
      const { service, tasks } = setup();
      tasks.countConversationOutputs.mockResolvedValue(2);

      const { total } = await service.listConversationOutputs(HUMAN_ID, 'conv-1', {
        limit: 10,
        offset: 0
      });

      expect(total).toBe(2);
      expect(tasks.listConversationOutputs).toHaveBeenCalledWith('conv-1', {
        limit: 10,
        offset: 0
      });
    });
  });

  describe('agentCosts', () => {
    it("reports the agent's spending next to its monthly budget", async () => {
      const { service, tasks, agents } = setup();
      agents.getById.mockResolvedValue({ ...agent, monthlyBudgetUsd: 20 });
      tasks.sumCost
        .mockResolvedValueOnce({ costUsd: 12, tokens: 9000, unpricedCalls: 0 })
        .mockResolvedValueOnce({ costUsd: 3, tokens: 2000, unpricedCalls: 1 });

      const report = await service.agentCosts(HUMAN_ID, agent.id);

      expect(report).toMatchObject({
        total: { costUsd: 12 },
        thisMonth: { costUsd: 3, unpricedCalls: 1 },
        budgetUsd: 20
      });
      expect(tasks.sumCost).toHaveBeenCalledWith({ agentId: agent.id, since: expect.any(Date) });
    });
  });
});
