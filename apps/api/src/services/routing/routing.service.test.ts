import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockMessageRepository,
  mockTaskRepository
} from '../../data/repositories.test-helper';
import { RoutingRepository } from '../../data';
import { RoutingClient, RoutingDecision, StarterChoice } from '../../integrations';
import { RoutingLogger } from '../../observability';
import { RoutingRecord } from '../../shared/routing';
import { RoutingService } from './routing.service';
import { Agent, Conversation, Human, Message, Task } from '../../shared/types';

const now = new Date('2026-11-04T06:00:00Z');
const conversation = {
  id: 'c',
  goal: 'Write and review a brief',
  doneCriteria: 'Reviewed brief',
  state: 'open'
} as Conversation;
const agent = {
  id: 'a',
  name: 'Writer',
  purpose: 'Writes briefs',
  currentVersionId: 'v',
  disabledAt: null
} as Agent;
const message = {
  id: 'm',
  conversationId: 'c',
  authorType: 'human',
  authorId: 'h',
  body: 'Write a brief',
  mentions: [],
  inReplyToMessageId: null,
  createdAt: now
} as unknown as Message;
const job: RoutingRecord = {
  id: 'r',
  conversationId: 'c',
  messageId: 'm',
  taskId: null,
  kind: 'starter',
  status: 'pending',
  selectedAgentId: null,
  outcome: null,
  reason: '',
  confidence: 0,
  candidates: [],
  revision: 0,
  deliveryMessageId: null,
  createdAt: now
};
function decision<C extends StarterChoice>(choice: C, confidence = 0.9): RoutingDecision<C> {
  return {
    choice,
    confidence,
    ranked: [],
    usage: { inputTokens: 10, outputTokens: 0 },
    servedModel: 'test'
  };
}
function setup(overrides: Partial<RoutingRecord> = {}) {
  const repo: jest.Mocked<RoutingRepository> = {
    delivery: jest.fn(),
    discoverFinished: jest.fn(),
    claim: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    count: jest.fn(),
    taskMessages: jest.fn(),
    save: jest.fn()
  };
  const conversations = mockConversationRepository();
  const messages = mockMessageRepository();
  const agents = mockAgentRepository();
  const humans = mockHumanRepository();
  const tasks = mockTaskRepository();
  const client: jest.Mocked<RoutingClient> = {
    engine: 'test',
    chooseStarter: jest.fn(),
    chooseAfterTask: jest.fn()
  };
  const logger = { onDecision: jest.fn(), onFailure: jest.fn() } as unknown as RoutingLogger;
  repo.claim.mockResolvedValueOnce({ ...job, ...overrides }).mockResolvedValue(null);
  repo.get.mockResolvedValue({ ...job, ...overrides });
  repo.save.mockResolvedValue(true);
  repo.taskMessages.mockResolvedValue([]);
  conversations.getById.mockResolvedValue(conversation);
  conversations.getMember.mockResolvedValue({
    conversationId: 'c',
    participant: { type: 'human', id: 'h' },
    historyFrom: null,
    addedAt: now,
    addedByHumanId: 'h'
  });
  conversations.listMembers.mockResolvedValue([
    {
      conversationId: 'c',
      participant: { type: 'agent', id: 'a' },
      historyFrom: null,
      addedAt: now,
      addedByHumanId: 'h'
    }
  ]);
  messages.getById.mockResolvedValue(message);
  messages.listRecent.mockResolvedValue([message]);
  agents.getById.mockResolvedValue(agent);
  agents.getProfiles.mockResolvedValue([]);
  humans.getById.mockResolvedValue({ id: 'h', role: 'member' } as Human);
  client.chooseStarter.mockResolvedValue(decision({ kind: 'agent', agentId: 'a' }));
  const service = new RoutingService(
    repo,
    conversations,
    messages,
    agents,
    humans,
    tasks,
    client,
    logger
  );
  return { service, repo, conversations, messages, agents, humans, tasks, client };
}

describe('RoutingService', () => {
  it('routes a confident request using the original human message and saves a visible reason', async () => {
    const s = setup();
    await s.service.tick();
    expect(s.client.chooseStarter).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: conversation.goal,
        message: message.body,
        agents: [expect.objectContaining({ id: 'a' })]
      })
    );
    expect(s.repo.save).toHaveBeenCalledWith(
      'r',
      0,
      expect.objectContaining({ status: 'resolved', selectedAgentId: 'a', confidence: 0.9 }),
      expect.objectContaining({
        deliveryMessageId: 'm',
        message: expect.objectContaining({ authorType: 'system', deliverToAgentIds: [] })
      })
    );
  });
  it.each([0.59, 0, NaN])('waits without delivery when confidence is %s', async (confidence) => {
    const s = setup();
    s.client.chooseStarter.mockResolvedValue(decision({ kind: 'agent', agentId: 'a' }, confidence));
    await s.service.tick();
    expect(s.repo.save.mock.calls[0][2]).toMatchObject({
      status: 'waiting',
      selectedAgentId: null
    });
    expect(s.repo.save.mock.calls[0][3].deliveryMessageId).toBeNull();
  });
  it('uses the agreed 0.6 boundary', async () => {
    const s = setup();
    s.client.chooseStarter.mockResolvedValue(decision({ kind: 'agent', agentId: 'a' }, 0.6));
    await s.service.tick();
    expect(s.repo.save.mock.calls[0][2].selectedAgentId).toBe('a');
  });
  it('does not start work for thanks', async () => {
    const s = setup();
    s.client.chooseStarter.mockResolvedValue(decision({ kind: 'none' }));
    await s.service.tick();
    expect(s.repo.save.mock.calls[0][2]).toMatchObject({ outcome: 'none', selectedAgentId: null });
  });
  it.each([{ mentions: [{ type: 'human', id: 'h' }] }, { inReplyToMessageId: 'other' }])(
    'bypasses explicit tags and replies',
    async (override) => {
      const s = setup();
      s.messages.getById.mockResolvedValue({ ...message, ...override } as Message);
      await s.service.tick();
      expect(s.client.chooseStarter).not.toHaveBeenCalled();
      expect(s.repo.save.mock.calls[0][2].status).toBe('skipped');
    }
  );
  it('cannot act on a model pick outside the membership', async () => {
    const s = setup();
    s.client.chooseStarter.mockResolvedValue(decision({ kind: 'agent', agentId: 'outsider' }));
    await s.service.tick();
    expect(s.repo.save.mock.calls[0][2]).toMatchObject({
      status: 'waiting',
      selectedAgentId: null
    });
  });
  it('turns a provider failure into a durable question without retrying/spending again', async () => {
    const s = setup();
    s.client.chooseStarter.mockRejectedValue(new Error('offline'));
    await s.service.tick();
    expect(s.client.chooseStarter).toHaveBeenCalledTimes(1);
    expect(s.repo.save.mock.calls[0][2].status).toBe('waiting');
  });
  it('excludes disabled agents and members unable to see the source', async () => {
    const s = setup();
    s.agents.getById.mockResolvedValue({ ...agent, disabledAt: now });
    await s.service.tick();
    expect(s.client.chooseStarter).not.toHaveBeenCalled();
    expect(s.repo.save.mock.calls[0][2].selectedAgentId).toBeNull();
  });
  it('does not give the model history hidden by any member boundary', async () => {
    const s = setup();
    const since = new Date(now.getTime() - 1000);
    s.conversations.listMembers.mockResolvedValue([
      {
        conversationId: 'c',
        participant: { type: 'agent', id: 'a' },
        historyFrom: since,
        addedAt: since,
        addedByHumanId: 'h'
      }
    ]);
    await s.service.tick();
    expect(s.messages.listRecent).toHaveBeenCalledWith('c', { since, limit: 20 });
  });
  it('does not route a closed endeavor', async () => {
    const s = setup();
    s.conversations.getById.mockResolvedValue({ ...conversation, state: 'closed' });
    await s.service.tick();
    expect(s.client.chooseStarter).not.toHaveBeenCalled();
    expect(s.repo.save).not.toHaveBeenCalled();
  });
  it('never cancels or delivers work from a stale human choice', async () => {
    const s = setup({ status: 'waiting', revision: 2 });
    await expect(
      s.service.choose('h', 'c', 'r', { agentId: 'a', revision: 1 })
    ).rejects.toMatchObject({ name: 'routingConflict' });
    expect(s.repo.save).not.toHaveBeenCalled();
  });
  it('only members can resolve choices', async () => {
    const s = setup({ status: 'waiting' });
    s.conversations.getMember.mockResolvedValue(null);
    await expect(
      s.service.choose('h', 'c', 'r', { agentId: 'a', revision: 0 })
    ).rejects.toMatchObject({ name: 'notConversationMember' });
  });
  it('lets No one resolve an unanswered choice without delivering anything', async () => {
    const s = setup({ status: 'waiting' });
    await s.service.choose('h', 'c', 'r', { agentId: null, revision: 0 });
    expect(s.repo.save.mock.calls[0][2]).toMatchObject({
      status: 'resolved',
      outcome: 'none',
      selectedAgentId: null
    });
    expect(s.repo.save.mock.calls[0][3].message?.deliverToAgentIds).toEqual([]);
  });
  it('posts a visible tagged handoff when a completed task needs the next member', async () => {
    const s = setup({ kind: 'handoff', taskId: 't', messageId: null });
    s.tasks.getById.mockResolvedValue({
      id: 't',
      conversationId: 'c',
      ownerAgentId: 'finished',
      brief: 'brief',
      parentTaskId: null,
      createdAt: now
    } as Task);
    s.tasks.listOutputs.mockResolvedValue([]);
    s.client.chooseAfterTask.mockResolvedValue({ ...decision({ kind: 'agent', agentId: 'a' }) });
    await s.service.tick();
    expect(s.client.chooseAfterTask).toHaveBeenCalled();
    expect(s.repo.save.mock.calls[0][3].message).toMatchObject({
      authorType: 'agent',
      authorId: 'finished',
      taskId: 't',
      mentions: [{ type: 'agent', id: 'a' }],
      deliverToAgentIds: ['a']
    });
  });
  it('bypasses completion routing when an agent already handed off', async () => {
    const s = setup({ kind: 'handoff', taskId: 't', messageId: null });
    s.tasks.getById.mockResolvedValue({
      id: 't',
      ownerAgentId: 'finished',
      createdAt: now
    } as Task);
    s.repo.taskMessages.mockResolvedValue([{ messageId: 'handoff', delivered: true }]);
    await s.service.tick();
    expect(s.client.chooseAfterTask).not.toHaveBeenCalled();
    expect(s.repo.save.mock.calls[0][2].status).toBe('skipped');
  });
  it('does not offer an agent whose history starts after the request', async () => {
    const s = setup();
    s.conversations.listMembers.mockResolvedValue([
      {
        conversationId: 'c',
        participant: { type: 'agent', id: 'a' },
        historyFrom: new Date(now.getTime() + 1000),
        addedAt: now,
        addedByHumanId: 'h'
      }
    ]);
    await s.service.tick();
    expect(s.client.chooseStarter).not.toHaveBeenCalled();
    expect(s.repo.save.mock.calls[0][2].candidates).toEqual([]);
  });
  it.each(['done', 'ask'] as const)(
    'handles a completed task with outcome %s without delivering more work',
    async (kind) => {
      const s = setup({ kind: 'handoff', taskId: 't', messageId: null });
      s.tasks.getById.mockResolvedValue({
        id: 't',
        ownerAgentId: 'finished',
        createdAt: now,
        parentTaskId: null
      } as Task);
      s.tasks.listOutputs.mockResolvedValue([]);
      s.client.chooseAfterTask.mockResolvedValue({
        choice: { kind },
        confidence: 0.9,
        ranked: [],
        servedModel: 'test',
        usage: { inputTokens: 10, outputTokens: 0 }
      });
      await s.service.tick();
      expect(s.repo.save.mock.calls[0][2]).toMatchObject({
        status: kind === 'ask' ? 'waiting' : 'resolved',
        outcome: kind,
        selectedAgentId: null
      });
      expect(s.repo.save.mock.calls[0][3].message?.deliverToAgentIds).toEqual([]);
    }
  );
  it('bounds automatic handoff chains before another model call', async () => {
    const s = setup({ kind: 'handoff', taskId: 't', messageId: null });
    s.tasks.getById.mockResolvedValue({
      id: 't',
      ownerAgentId: 'finished',
      createdAt: now,
      parentTaskId: 'parent'
    } as Task);
    await s.service.tick();
    expect(s.client.chooseAfterTask).not.toHaveBeenCalled();
    expect(s.repo.save.mock.calls[0][2].reason).toContain('limit');
  });
  it('does not reroute work after shutdown while a model call is pending', async () => {
    const s = setup();
    let finish!: () => void;
    s.client.chooseStarter.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return decision({ kind: 'agent', agentId: 'a' });
    });
    const tick = s.service.tick();
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
    s.service.stop();
    finish();
    await tick;
    expect(s.repo.save).not.toHaveBeenCalled();
  });
});
