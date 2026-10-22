import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockMessageRepository,
  mockTaskRepository
} from '../../data/repositories.test-helper';
import { ModelClient, ModelClientError, ModelTurnResult } from '../../integrations';
import { TaskLogger, TaskRunnerLogger } from '../../observability';
import {
  Agent,
  AgentVersion,
  ConversationMember,
  Message,
  Task,
  TaskEvent,
  TaskWait
} from '../../shared/types';
import { DEFAULT_RUNNER_OPTIONS, TaskRunnerService } from './task-runner.service';

const CONV = '00000000-0000-4000-8000-0000000000f1';
const HUMAN = '00000000-0000-4000-8000-000000000001';
const RESEARCHER = '00000000-0000-4000-8000-0000000000a1';
const REVIEWER = '00000000-0000-4000-8000-0000000000a2';
const TASK = '00000000-0000-4000-8000-0000000000c1';

const agents: Record<string, Agent> = {
  [RESEARCHER]: makeAgent(RESEARCHER, 'Researcher'),
  [REVIEWER]: makeAgent(REVIEWER, 'Reviewer')
};

function makeAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    purpose: `${name} things`,
    currentVersionId: `v-${id}`,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const version: AgentVersion = {
  id: `v-${RESEARCHER}`,
  agentId: RESEARCHER,
  version: 1,
  instructions: 'Research carefully.',
  provider: 'scripted',
  model: 'script',
  skillIds: [],
  connectionIds: [],
  createdByHumanId: HUMAN,
  createdAt: new Date()
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK,
    runKey: 'k',
    conversationId: CONV,
    ownerAgentId: RESEARCHER,
    agentVersionId: version.id,
    title: 'Respond to Kim',
    brief: 'Summarize the billing changes',
    completionCriteria: 'Respond',
    reviewRequired: false,
    state: 'working',
    stateReason: null,
    pausedAt: null,
    requestedByType: 'human',
    requestedById: HUMAN,
    requestMessageId: 'm-request',
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

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm-request',
    conversationId: CONV,
    authorType: 'human',
    authorId: HUMAN,
    body: 'Please summarize the billing changes',
    mentions: [{ type: 'agent', id: RESEARCHER }],
    inReplyToMessageId: null,
    taskId: null,
    createdAt: new Date(),
    ...overrides
  };
}

function member(type: 'human' | 'agent', id: string): ConversationMember {
  return {
    conversationId: CONV,
    participant: { type, id },
    addedByHumanId: HUMAN,
    historyFrom: null,
    addedAt: new Date()
  };
}

function event(id: number, type: string, data: Record<string, unknown>): TaskEvent {
  return {
    id,
    taskId: TASK,
    type,
    actor: { type: 'system', id: null },
    data,
    createdAt: new Date()
  };
}

function turn(result: Partial<ModelTurnResult>): ModelTurnResult {
  return {
    text: '',
    toolCalls: [],
    stopReason: 'end',
    raw: { turn: true },
    usage: { inputTokens: 1, outputTokens: 1 },
    servedModel: 'script',
    ...result
  };
}

function setup(options: { client?: ModelClient | null } = {}) {
  const tasks = mockTaskRepository();
  const messages = mockMessageRepository();
  const conversations = mockConversationRepository();
  const agentRepo = mockAgentRepository();
  const humans = mockHumanRepository();
  const client: jest.Mocked<ModelClient> = {
    provider: 'scripted',
    complete: jest.fn().mockResolvedValue(turn({}))
  };

  let current = makeTask();
  tasks.getById.mockImplementation(async () => current);
  tasks.update.mockImplementation(async (_id, _expected, changes) => {
    current = { ...current, ...changes } as Task;
    return current;
  });
  tasks.addWaits.mockImplementation(async (taskId, waits) =>
    waits.map((wait, index) => ({
      id: `w${index}`,
      taskId,
      createdAt: new Date(),
      resolvedAt: null,
      resolution: null,
      ...wait
    }))
  );
  tasks.addOutput.mockImplementation(async (taskId, input) => ({
    id: 'o1',
    taskId,
    createdAt: new Date(),
    ...input
  }));
  tasks.countOutputs.mockResolvedValue(1);
  agentRepo.getById.mockImplementation(async (id) => agents[id] ?? null);
  agentRepo.getVersion.mockImplementation(async (id) => (id === version.id ? version : null));
  humans.getById.mockResolvedValue({
    id: HUMAN,
    name: 'Kim',
    role: 'admin',
    createdAt: new Date()
  });
  conversations.listMembers.mockResolvedValue([
    member('human', HUMAN),
    member('agent', RESEARCHER),
    member('agent', REVIEWER)
  ]);
  messages.getById.mockImplementation(async (id) => makeMessage({ id }));
  messages.create.mockImplementation(async (input) => ({
    message: makeMessage({ ...input, id: `posted-${messages.create.mock.calls.length}` }),
    created: true
  }));

  const runner = new TaskRunnerService(
    tasks,
    messages,
    conversations,
    agentRepo,
    humans,
    options.client === null ? {} : { scripted: options.client ?? client },
    {
      onTaskCreated: jest.fn(),
      onTaskStateChanged: jest.fn(),
      onTaskCompletionRejected: jest.fn()
    } as unknown as TaskLogger,
    {
      onMessageDelivered: jest.fn(),
      onDeliveryFailed: jest.fn(),
      onModelTurn: jest.fn(),
      onModelFailed: jest.fn(),
      onTaskRunFailed: jest.fn(),
      onRequestChainTooDeep: jest.fn(),
      onTickFailed: jest.fn()
    } as unknown as TaskRunnerLogger,
    { ...DEFAULT_RUNNER_OPTIONS, workerId: 'test' }
  );
  return {
    runner,
    tasks,
    messages,
    client,
    current: () => current,
    setCurrent: (task: Task) => (current = task)
  };
}

function eventTypes(tasks: ReturnType<typeof setup>['tasks']): string[] {
  return tasks.addEvent.mock.calls.map(([, type]) => type);
}

describe('TaskRunnerService', () => {
  describe('delivery', () => {
    it('starts a new task for an addressed agent with no open task', async () => {
      const { runner, tasks, messages } = setup();
      messages.claimDeliveries.mockResolvedValue([
        { messageId: 'm-request', agentId: RESEARCHER, createdAt: new Date() }
      ]);
      tasks.create.mockResolvedValue({ task: makeTask(), created: true });

      await runner.processDeliveries();

      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runKey: `message:m-request:${RESEARCHER}`,
          conversationId: CONV,
          requestMessageId: 'm-request',
          agentVersionId: version.id,
          title: 'Respond to Kim: Please summarize the billing changes'
        })
      );
      expect(messages.markDelivered).toHaveBeenCalledWith('m-request', RESEARCHER, TASK);
    });

    it('adds the message to an open task instead of starting a competing one', async () => {
      const { runner, tasks, messages } = setup();
      messages.claimDeliveries.mockResolvedValue([
        { messageId: 'm-update', agentId: RESEARCHER, createdAt: new Date() }
      ]);
      tasks.findOpenTask.mockResolvedValue(makeTask());

      await runner.processDeliveries();

      expect(tasks.create).not.toHaveBeenCalled();
      expect(tasks.addEvent).toHaveBeenCalledWith(TASK, 'message.received', expect.anything(), {
        messageId: 'm-update'
      });
    });

    it('wakes an asker when the asked participant answers, even with a question back', async () => {
      const { runner, tasks, messages, current } = setup();
      const asking = makeTask({ state: 'waiting' });
      tasks.findOpenTask.mockResolvedValue(asking);
      tasks.getById.mockResolvedValue(asking);
      const wait: TaskWait = {
        id: 'w1',
        taskId: TASK,
        kind: 'reply',
        targetId: 'm-question',
        description: 'Reply from Reviewer',
        createdAt: new Date(),
        resolvedAt: null,
        resolution: null
      };
      tasks.listWaits.mockResolvedValueOnce([wait]).mockResolvedValue([]);
      tasks.resolveWait.mockResolvedValue({ ...wait, resolvedAt: new Date() });
      messages.getById.mockImplementation(async (id) =>
        id === 'm-question'
          ? makeMessage({
              id,
              authorType: 'agent',
              authorId: RESEARCHER,
              mentions: [{ type: 'agent', id: REVIEWER }]
            })
          : makeMessage({ id, authorType: 'agent', authorId: REVIEWER, body: 'v1 or v2?' })
      );
      messages.claimDeliveries.mockResolvedValue([
        { messageId: 'm-clarify', agentId: RESEARCHER, createdAt: new Date() }
      ]);

      await runner.processDeliveries();

      expect(tasks.resolveWait).toHaveBeenCalledWith('w1', { messageId: 'm-clarify' });
      expect(tasks.update).toHaveBeenCalledWith(
        TASK,
        { state: 'waiting', paused: false },
        expect.objectContaining({ state: 'working' })
      );
      void current;
    });

    it('sends a blocked task back to working when a person writes to the agent', async () => {
      const { runner, tasks, messages } = setup();
      const blocked = makeTask({ state: 'blocked', stateReason: 'Need access' });
      tasks.findOpenTask.mockResolvedValue(blocked);
      messages.claimDeliveries.mockResolvedValue([
        { messageId: 'm-help', agentId: RESEARCHER, createdAt: new Date() }
      ]);

      await runner.processDeliveries();

      expect(tasks.update).toHaveBeenCalledWith(
        TASK,
        { state: 'blocked', paused: false },
        expect.objectContaining({ state: 'working' })
      );
    });

    it('keeps going when one delivery fails', async () => {
      const { runner, messages, tasks } = setup();
      messages.claimDeliveries.mockResolvedValue([
        { messageId: 'bad', agentId: RESEARCHER, createdAt: new Date() },
        { messageId: 'good', agentId: REVIEWER, createdAt: new Date() }
      ]);
      messages.getById.mockRejectedValueOnce(new Error('boom'));
      tasks.create.mockResolvedValue({ task: makeTask({ ownerAgentId: REVIEWER }), created: true });

      await runner.processDeliveries();

      expect(messages.markDelivered).toHaveBeenCalledTimes(1);
      expect(messages.markDelivered).toHaveBeenCalledWith('good', REVIEWER, TASK);
      expect(messages.recordDeliveryFailure).toHaveBeenCalledWith('bad', RESEARCHER, 'boom', 5);
    });

    it('stops starting tasks when agents keep asking each other for work', async () => {
      const { runner, tasks, messages } = setup();
      // Every task in the chain was asked for by an agent.
      tasks.getById.mockImplementation(async (id) =>
        makeTask({ id, requestedByType: 'agent', parentTaskId: `${id}-parent` })
      );
      messages.getById.mockResolvedValue(
        makeMessage({ id: 'm-agent', authorType: 'agent', authorId: REVIEWER, taskId: 't-deep' })
      );
      messages.claimDeliveries.mockResolvedValue([
        { messageId: 'm-agent', agentId: RESEARCHER, createdAt: new Date() }
      ]);

      await runner.processDeliveries();

      expect(tasks.create).not.toHaveBeenCalled();
      expect(messages.markDelivered).toHaveBeenCalledWith('m-agent', RESEARCHER, null);
    });
  });

  describe('running a task', () => {
    it('blocks and says so when the provider is not ready', async () => {
      const { runner, tasks, messages, current } = setup({ client: null });

      await runner.runTask(makeTask());

      expect(current().state).toBe('blocked');
      expect(current().stateReason).toContain('scripted provider is not ready');
      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("I can't proceed"),
          inReplyToMessageId: 'm-request'
        })
      );
      void tasks;
    });

    it('asks a peer: posts the question to them and waits for the reply', async () => {
      const { runner, tasks, messages, client, current } = setup();
      client.complete.mockResolvedValue(
        turn({
          stopReason: 'tool_use',
          toolCalls: [
            { id: 'call-1', name: 'ask', input: { to: 'reviewer', question: 'Which source?' } }
          ]
        })
      );
      tasks.listEvents.mockResolvedValueOnce([]).mockResolvedValue([
        event(1, 'model.turn', {
          raw: {},
          toolCalls: [
            { id: 'call-1', name: 'ask', input: { to: 'reviewer', question: 'Which source?' } }
          ]
        })
      ]);

      await runner.runTask(makeTask());

      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Which source?',
          mentions: [{ type: 'agent', id: REVIEWER }],
          deliverToAgentIds: [REVIEWER],
          clientKey: `tool:${TASK}:call-1`
        })
      );
      expect(tasks.addWaits).toHaveBeenCalledWith(TASK, [
        expect.objectContaining({ kind: 'reply', targetId: 'posted-1' })
      ]);
      expect(current().state).toBe('waiting');
      expect(eventTypes(tasks)).toContain('tool.results');
    });

    it('completes with the result as an output and posts it to whoever asked', async () => {
      const { runner, tasks, messages, current } = setup();
      const call = {
        id: 'call-2',
        name: 'complete_task',
        input: { result: 'Here is the summary', criteria_check: 'Answered', criteria_met: true }
      };
      tasks.listEvents.mockResolvedValue([event(1, 'model.turn', { raw: {}, toolCalls: [call] })]);

      await runner.runTask(makeTask());

      expect(tasks.addOutput).toHaveBeenCalledWith(
        TASK,
        expect.objectContaining({ title: 'Result', content: 'Here is the summary' })
      );
      expect(current().state).toBe('completed');
      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Here is the summary',
          inReplyToMessageId: 'm-request',
          mentions: [{ type: 'human', id: HUMAN }]
        })
      );
    });

    it('does not address an agent requester that has no open work, so agents never ping-pong', async () => {
      const { runner, tasks, messages } = setup();
      messages.getById.mockImplementation(async (id) =>
        makeMessage({ id, authorType: 'agent', authorId: REVIEWER })
      );
      const call = {
        id: 'call-4',
        name: 'complete_task',
        input: { result: 'Done', criteria_check: 'ok', criteria_met: true }
      };
      tasks.listEvents.mockResolvedValue([event(1, 'model.turn', { raw: {}, toolCalls: [call] })]);

      await runner.runTask(makeTask());

      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Done', mentions: [], deliverToAgentIds: [REVIEWER] })
      );
    });

    it('keeps an unreviewed result off the conversation', async () => {
      const { runner, tasks, messages, setCurrent } = setup();
      setCurrent(makeTask({ reviewRequired: true }));
      const call = {
        id: 'call-5',
        name: 'complete_task',
        input: { result: 'Secret draft', criteria_check: 'ok', criteria_met: true }
      };
      tasks.listEvents.mockResolvedValue([event(1, 'model.turn', { raw: {}, toolCalls: [call] })]);

      await runner.runTask(makeTask({ reviewRequired: true }));

      const bodies = messages.create.mock.calls.map(([input]) => input.body);
      expect(bodies).toEqual(['My result is ready for review.']);
    });

    it('posts approved results later', async () => {
      const { runner, tasks, messages } = setup();
      tasks.listFinishedWithoutEvent.mockResolvedValue([makeTask({ state: 'completed' })]);
      tasks.listOutputs.mockResolvedValue([
        {
          id: 'o1',
          taskId: TASK,
          kind: 'text',
          title: 'Result',
          content: 'Approved answer',
          uri: null,
          metadata: {},
          createdAt: new Date()
        }
      ]);

      await runner.tick();

      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Approved answer', inReplyToMessageId: 'm-request' })
      );
      expect(tasks.addEvent).toHaveBeenCalledWith(TASK, 'result.posted', expect.anything(), {
        outputId: 'o1'
      });
    });

    it('does not add a second wait when an ask runs again after a crash', async () => {
      const { runner, tasks } = setup();
      const call = { id: 'call-6', name: 'ask', input: { to: 'Reviewer', question: 'Which?' } };
      tasks.listEvents.mockResolvedValue([event(1, 'model.turn', { raw: {}, toolCalls: [call] })]);
      tasks.listWaits.mockResolvedValue([
        {
          id: 'w-old',
          taskId: TASK,
          kind: 'reply',
          targetId: 'posted-1',
          description: 'Reply from Reviewer',
          createdAt: new Date(),
          resolvedAt: new Date(),
          resolution: {}
        }
      ]);

      await runner.runTask(makeTask());

      expect(tasks.addWaits).not.toHaveBeenCalled();
    });

    it('stops when another worker took the lease', async () => {
      const { runner, tasks, client } = setup();
      tasks.renewLease.mockResolvedValue(false);

      await runner.runTask(makeTask());

      expect(client.complete).not.toHaveBeenCalled();
    });

    it('only counts model failures since the last good turn', async () => {
      const { runner, client, tasks, current } = setup();
      client.complete.mockRejectedValue(new ModelClientError('busy', 'scripted', true));
      tasks.listEvents.mockResolvedValue([
        event(1, 'model.failed', {}),
        event(2, 'model.failed', {}),
        event(3, 'model.turn', { raw: {}, toolCalls: [] }),
        event(4, 'runner.nudge', { text: 'go' })
      ]);

      const delay = await runner.runTask(makeTask());

      expect(delay).toBe(5_000);
      expect(current().state).toBe('working');
    });

    it('refuses completion the agent says does not meet the criteria', async () => {
      const { runner, tasks, current } = setup();
      const call = {
        id: 'call-3',
        name: 'complete_task',
        input: { result: 'Partial', criteria_check: 'Missing a source', criteria_met: false }
      };
      tasks.listEvents
        .mockResolvedValueOnce([event(1, 'model.turn', { raw: {}, toolCalls: [call] })])
        .mockResolvedValue([]);

      await runner.runTask(makeTask());

      const results = tasks.addEvent.mock.calls.find(([, type]) => type === 'tool.results')?.[3];
      expect(results).toEqual({
        results: [expect.objectContaining({ callId: 'call-3', isError: true })]
      });
      expect(current().state).toBe('working');
    });

    it('waits and tries again later when the provider is busy', async () => {
      const { runner, client, tasks } = setup();
      client.complete.mockRejectedValue(new ModelClientError('rate limited', 'scripted', true));

      const delay = await runner.runTask(makeTask());

      expect(delay).toBe(5_000);
      expect(eventTypes(tasks)).toEqual(['model.failed']);
    });

    it('blocks after repeated provider failures', async () => {
      const { runner, client, tasks, current } = setup();
      client.complete.mockRejectedValue(new ModelClientError('rate limited', 'scripted', true));
      tasks.listEvents.mockResolvedValue([
        event(1, 'model.failed', {}),
        event(2, 'model.failed', {})
      ]);

      await runner.runTask(makeTask());

      expect(current().state).toBe('blocked');
      expect(current().stateReason).toContain('rate limited');
    });

    it('blocks when the model declines', async () => {
      const { runner, client, current } = setup();
      client.complete.mockResolvedValue(turn({ stopReason: 'refusal' }));

      await runner.runTask(makeTask());

      expect(current().state).toBe('blocked');
    });

    it("runs on the task's pinned version, not the agent's newer one", async () => {
      const { runner, client } = setup();
      agents[RESEARCHER] = { ...agents[RESEARCHER], currentVersionId: 'v-newer' };
      try {
        await runner.runTask(makeTask({ agentVersionId: version.id }));
      } finally {
        agents[RESEARCHER] = makeAgent(RESEARCHER, 'Researcher');
      }

      expect(client.complete).toHaveBeenCalledWith(
        expect.objectContaining({ system: expect.stringContaining('Research carefully.') })
      );
    });

    it('stops when a person pauses the task', async () => {
      const { runner, client, setCurrent } = setup();
      setCurrent(makeTask({ pausedAt: new Date() }));

      await runner.runTask(makeTask());

      expect(client.complete).not.toHaveBeenCalled();
    });

    it('blocks at the model turn limit', async () => {
      const { runner, client, tasks, current } = setup();
      tasks.listEvents.mockResolvedValue(
        Array.from({ length: DEFAULT_RUNNER_OPTIONS.maxTurnsPerTask }, (_, i) =>
          event(i + 1, 'model.turn', { raw: {}, toolCalls: [] })
        ).concat([event(999, 'tool.results', { results: [] })])
      );

      await runner.runTask(makeTask());

      expect(client.complete).not.toHaveBeenCalled();
      expect(current().state).toBe('blocked');
    });
  });

  describe('rebuildTranscript', () => {
    it('shows a message delivered twice only once', async () => {
      const { runner } = setup();

      const { transcript } = await runner.rebuildTranscript('Task prompt', [
        event(1, 'message.received', { messageId: 'm1' }),
        event(2, 'message.received', { messageId: 'm1' })
      ]);

      expect(transcript).toHaveLength(2);
    });

    it('holds back messages that arrive between a tool call and its results', async () => {
      const { runner } = setup();
      const call = { id: 'c1', name: 'ask', input: {} };

      const { transcript, pendingCalls } = await runner.rebuildTranscript('Task prompt', [
        event(1, 'model.turn', { raw: 'assistant-1', toolCalls: [call] }),
        event(2, 'message.received', { messageId: 'm-late' }),
        event(3, 'tool.results', { results: [{ callId: 'c1', content: 'ok', isError: false }] })
      ]);

      expect(transcript.map((entry) => entry.role)).toEqual([
        'user',
        'assistant',
        'tool_results',
        'user'
      ]);
      expect(pendingCalls).toEqual([]);
    });

    it('reports tool calls that never got results, such as after a crash', async () => {
      const { runner } = setup();
      const call = { id: 'c1', name: 'send_message', input: { body: 'hi' } };

      const { pendingCalls } = await runner.rebuildTranscript('Task prompt', [
        event(1, 'model.turn', { raw: 'assistant-1', toolCalls: [call] })
      ]);

      expect(pendingCalls).toEqual([call]);
    });
  });
});
