import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockResponsibilityRepository,
  mockTaskRepository
} from '../../data/repositories.test-helper';
import { ResponsibilityLogger, TaskLogger } from '../../observability';
import { Human, Responsibility } from '../../shared/types';
import { ResponsibilityService } from './responsibility.service';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const CONV = '00000000-0000-4000-8000-0000000000f1';

const admin: Human = { id: ADMIN, name: 'Kim', role: 'admin', createdAt: new Date() };
const responsibility: Responsibility = {
  id: 'r1',
  agentId: AGENT,
  conversationId: CONV,
  title: 'Nightly QA',
  brief: 'Test checkout',
  completionCriteria: 'Report results',
  intervalMinutes: 60,
  missedRunPolicy: 'run_once',
  status: 'enabled',
  nextRunAt: new Date(Date.now() + 60_000),
  lastRunAt: null,
  createdByHumanId: ADMIN,
  createdAt: new Date(),
  updatedAt: new Date()
};

function setup() {
  const responsibilities = mockResponsibilityRepository();
  const tasks = mockTaskRepository();
  const agents = mockAgentRepository();
  const conversations = mockConversationRepository();
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(admin);
  agents.getById.mockResolvedValue({
    id: AGENT,
    name: 'QA',
    purpose: '',
    currentVersionId: 'v1',
    disabledAt: null,
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
  tasks.create.mockImplementation(async (input) => ({
    task: { id: 't1', ...input } as never,
    created: true
  }));
  const responsibilityLogger = {
    onResponsibilityCreated: jest.fn(),
    onResponsibilityStatusChanged: jest.fn()
  } as unknown as ResponsibilityLogger;
  const taskLogger = { onTaskCreated: jest.fn() } as unknown as TaskLogger;
  const service = new ResponsibilityService(
    responsibilities,
    tasks,
    agents,
    conversations,
    humans,
    responsibilityLogger,
    taskLogger
  );
  return { service, responsibilities, tasks, conversations, humans };
}

describe('ResponsibilityService', () => {
  it('needs the agent to be in the conversation it reports to', async () => {
    const { service, conversations } = setup();
    conversations.getMember.mockResolvedValue(null);

    await expect(
      service.create(ADMIN, {
        agentId: AGENT,
        conversationId: CONV,
        title: 't',
        brief: 'b',
        completionCriteria: 'c',
        intervalMinutes: 60
      })
    ).rejects.toMatchObject({ name: 'agentNotInConversation' });
  });

  it('defaults to running once for missed runs, starting now', async () => {
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
        missedRunPolicy: 'run_once',
        nextRunAt: expect.any(Date),
        conversationId: null
      })
    );
  });

  it('is admin only', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({ ...admin, role: 'member' });

    await expect(service.setStatus(ADMIN, 'r1', 'paused')).rejects.toMatchObject({
      name: 'forbidden'
    });
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
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runKey: 'manual:r1:event-42',
        responsibilityId: 'r1',
        conversationId: CONV,
        brief: 'Test checkout\n\nDeploy finished',
        requestedByType: 'human'
      })
    );
    expect(responsibilities.advance).not.toHaveBeenCalled();
    expect(responsibilities.update).not.toHaveBeenCalled();
  });
});
