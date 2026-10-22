import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  MessageRepository,
  TaskRepository
} from '../../data';
import {
  ModelClient,
  ModelClientError,
  ModelToolCall,
  ModelToolResult,
  ModelTranscriptEntry
} from '../../integrations';
import { TaskLogger, TaskRunnerLogger } from '../../observability';
import { addressedAgentIds } from '../../shared/addressing';
import { AppError } from '../../shared/errors';
import {
  Actor,
  Agent,
  AgentVersion,
  Message,
  ModelProvider,
  ParticipantRef,
  Task,
  TaskEvent
} from '../../shared/types';
import {
  buildSystemPrompt,
  buildTaskPrompt,
  ContextParticipant,
  DEFAULT_RESPONSE_CRITERIA,
  formatMessage,
  oneLine
} from './agent-context';
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOLS, STOPPING_TOOLS } from './agent-tools';
import { TaskLifecycle } from './task-lifecycle';

export interface TaskRunnerOptions {
  workerId: string;
  // How long a claimed task stays leased. A crash lets it be claimed again after this.
  leaseMs: number;
  // How many tasks one tick works on at once.
  concurrency: number;
  // Model turns per claim, so one task can't hold a worker forever.
  turnsPerClaim: number;
  // Model turns over the whole task before it is blocked. A stand-in until CA-5 adds budgets.
  maxTurnsPerTask: number;
  maxTokens: number;
  historyLimit: number;
}

export const DEFAULT_RUNNER_OPTIONS: Omit<TaskRunnerOptions, 'workerId'> = {
  leaseMs: 120_000,
  concurrency: 4,
  turnsPerClaim: 8,
  maxTurnsPerTask: 40,
  maxTokens: 16_000,
  historyLimit: 30
};

const MAX_MODEL_FAILURES = 3;
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LEASE_MS = 60_000;
// How many agent-to-agent requests can chain before the runner stops starting new tasks. This
// keeps two agents from asking each other for work forever.
const MAX_REQUEST_DEPTH = 5;
// How many directory agents the prompt lists. suggest_participant can name any agent in the
// directory, listed or not.
const DIRECTORY_IN_PROMPT = 30;
const MAX_NUDGES = 2;
const NUDGE =
  'You ended your turn without finishing. Use complete_task, ask, or report_blocked to finish, or send_message to post an update.';
const SYSTEM: Actor = { type: 'system', id: null };

// Event types the runner writes. The transcript is rebuilt from these, oldest first.
const EVENTS = {
  modelTurn: 'model.turn',
  toolResults: 'tool.results',
  modelFailed: 'model.failed',
  messageReceived: 'message.received',
  nudge: 'runner.nudge',
  participantSuggested: 'participant.suggested',
  resultPosted: 'result.posted'
} as const;

// The runner. It is not an agent and makes no decisions about the work: it delivers messages,
// runs agents' model turns, carries out their tool calls, and records everything. All state is
// in the database, so a restart picks up where it stopped.
export class TaskRunnerService {
  private readonly lifecycle: TaskLifecycle;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly modelClients: Partial<Record<ModelProvider, ModelClient>>,
    taskLogger: TaskLogger,
    private readonly runnerLogger: TaskRunnerLogger,
    private readonly options: TaskRunnerOptions
  ) {
    this.lifecycle = new TaskLifecycle(taskRepository, taskLogger);
  }

  // One pass: deliver new messages, wake tasks whose waits are done, then run claimed tasks.
  async tick(): Promise<void> {
    await this.processDeliveries();
    await this.repairWaitingTasks();
    await this.postPendingResults();
    const tasks = await this.taskRepository.claimRunnable(
      this.options.workerId,
      this.options.leaseMs,
      this.options.concurrency
    );
    await Promise.all(tasks.map((task) => this.runClaimed(task)));
  }

  // Delivery

  async processDeliveries(): Promise<void> {
    const deliveries = await this.messageRepository.claimDeliveries(50, DELIVERY_LEASE_MS);
    for (const delivery of deliveries) {
      // A bad delivery is retried on later ticks, then marked failed. It never blocks others.
      try {
        const message = await this.messageRepository.getById(delivery.messageId);
        const agent = await this.agentRepository.getById(delivery.agentId);
        const taskId = message && agent ? await this.deliver(message, agent) : null;
        await this.messageRepository.markDelivered(delivery.messageId, delivery.agentId, taskId);
      } catch (error) {
        this.runnerLogger.onDeliveryFailed(delivery.messageId, delivery.agentId, error);
        await this.messageRepository.recordDeliveryFailure(
          delivery.messageId,
          delivery.agentId,
          (error as Error).message ?? String(error),
          MAX_DELIVERY_ATTEMPTS
        );
      }
    }
  }

  // A message to an agent with an open task in the conversation updates that task, so it never
  // starts a second, competing run. Otherwise it starts a new task. Running this twice for the
  // same message finds the same task, so a crash mid-delivery doesn't duplicate work.
  private async deliver(message: Message, agent: Agent): Promise<string | null> {
    const author = authorActor(message);
    const open = await this.taskRepository.findOpenTask(message.conversationId, agent.id);
    if (open) {
      await this.taskRepository.addEvent(open.id, EVENTS.messageReceived, author, {
        messageId: message.id
      });
      await this.resolveReplyWaits(open, message, author);
      // A blocked task needs a person. A person writing to the agent is that attention.
      if (open.state === 'blocked' && !open.pausedAt && message.authorType === 'human') {
        await this.lifecycle
          .transition(open, 'working', author, { reason: null })
          .catch(ignoreStateConflict);
      }
      this.runnerLogger.onMessageDelivered(message.id, agent.id, open.id, 'update');
      return open.id;
    }

    if (agent.disabledAt || !agent.currentVersionId) {
      return null;
    }
    if (
      message.authorType === 'agent' &&
      (await this.requestDepth(message.taskId)) >= MAX_REQUEST_DEPTH
    ) {
      this.runnerLogger.onRequestChainTooDeep(message.id, agent.id);
      return null;
    }
    const authorName = await this.participantName(authorRef(message));
    const { task, created } = await this.taskRepository.create({
      runKey: `message:${message.id}:${agent.id}`,
      conversationId: message.conversationId,
      ownerAgentId: agent.id,
      agentVersionId: agent.currentVersionId,
      title: `Respond to ${authorName}: ${excerpt(message.body)}`,
      brief: message.body,
      completionCriteria: DEFAULT_RESPONSE_CRITERIA,
      reviewRequired: false,
      requestedByType: message.authorType === 'system' ? 'schedule' : message.authorType,
      requestedById: message.authorId,
      requestMessageId: message.id,
      parentTaskId: message.authorType === 'agent' ? message.taskId : null,
      restartedFromTaskId: null,
      responsibilityId: null
    });
    if (created) {
      await this.lifecycle.recordCreated(task, author);
    }
    this.runnerLogger.onMessageDelivered(message.id, agent.id, task.id, 'new_task');
    return task.id;
  }

  // A reply wait is answered by any message from the asked participant to the asker: an
  // answer, a clarifying question, or a statement that they can't help. An explicit reply to
  // the question counts too, whoever sends it.
  private async resolveReplyWaits(task: Task, message: Message, author: Actor): Promise<void> {
    const waits = (await this.taskRepository.listWaits(task.id, { openOnly: true })).filter(
      (wait) => wait.kind === 'reply' && wait.targetId
    );
    for (const wait of waits) {
      const question = await this.messageRepository.getById(wait.targetId as string);
      const fromAsked = question?.mentions.some(
        (ref) => ref.type === message.authorType && ref.id === message.authorId
      );
      if (message.inReplyToMessageId === wait.targetId || fromAsked) {
        await this.lifecycle
          .resolveWait(wait.id, author, { messageId: message.id })
          .catch(ignoreWaitAlreadyResolved);
      }
    }
  }

  // How many agent requests led to this task: 0 for work a person or schedule started.
  private async requestDepth(taskId: string | null): Promise<number> {
    let depth = 0;
    for (let id = taskId; id && depth <= MAX_REQUEST_DEPTH; depth++) {
      const task = await this.taskRepository.getById(id);
      if (!task || task.requestedByType !== 'agent') {
        return depth;
      }
      id = task.parentTaskId;
    }
    return depth;
  }

  // Posts results that weren't posted yet: results a person just approved in review, and
  // results lost to a crash between completing and posting.
  private async postPendingResults(): Promise<void> {
    for (const task of await this.taskRepository.listFinishedWithoutEvent(
      EVENTS.resultPosted,
      20
    )) {
      const agent = await this.agentRepository.getById(task.ownerAgentId);
      const result = (await this.taskRepository.listOutputs(task.id))
        .filter((output) => output.title === 'Result')
        .pop();
      if (agent && result?.content) {
        await this.answerRequester(task, agent, 'result', result.content);
      }
      await this.taskRepository.addEvent(task.id, EVENTS.resultPosted, SYSTEM, {
        outputId: result?.id ?? null
      });
    }
  }

  private async repairWaitingTasks(): Promise<void> {
    for (const task of await this.taskRepository.listWaitingWithoutOpenWaits(20)) {
      await this.lifecycle.wakeIfReady(task.id, SYSTEM).catch(ignoreStateConflict);
    }
  }

  // Running

  private async runClaimed(task: Task): Promise<void> {
    let retryDelayMs = 0;
    try {
      retryDelayMs = await this.runTask(task);
    } catch (error) {
      this.runnerLogger.onTaskRunFailed(task.id, error);
    } finally {
      await this.taskRepository.releaseLease(task.id, this.options.workerId, retryDelayMs);
    }
  }

  // Runs model turns until the task stops working or the turn budget for this claim is used.
  // Returns how long to wait before the task may be claimed again.
  async runTask(claimed: Task): Promise<number> {
    const agent = await this.agentRepository.getById(claimed.ownerAgentId);
    const version = await this.agentRepository.getVersion(claimed.agentVersionId);
    if (!agent || !version) {
      await this.block(claimed, 'The agent or its configuration no longer exists.');
      return 0;
    }
    const client = this.modelClients[version.provider];
    if (!client) {
      await this.block(
        claimed,
        `The ${version.provider} provider is not ready. Set its API key and resume the task.`
      );
      return 0;
    }

    const system = buildSystemPrompt(agent, version);
    const prompt = await this.buildPrompt(claimed, agent);

    for (let turn = 0; turn < this.options.turnsPerClaim; turn++) {
      const task = await this.taskRepository.getById(claimed.id);
      if (!task || task.state !== 'working' || task.pausedAt) {
        return 0;
      }
      // A person moved the task to another configuration version. Stop, so the next claim loads
      // the new instructions, provider, and model.
      if (task.agentVersionId !== version.id) {
        return 0;
      }
      // Another worker took over after our lease ran out. Stop, so the task never runs twice.
      if (
        !(await this.taskRepository.renewLease(
          task.id,
          this.options.workerId,
          this.options.leaseMs
        ))
      ) {
        return 0;
      }

      const events = await this.loadEvents(task.id);
      const { transcript, pendingCalls } = await this.rebuildTranscript(
        prompt,
        events,
        version.provider
      );

      // A tool call that was asked for but never run, such as after a crash, runs first.
      if (pendingCalls.length > 0) {
        const stopped = await this.runTools(task, agent, pendingCalls);
        if (stopped) {
          return 0;
        }
        continue;
      }

      if (countType(events, EVENTS.modelTurn) >= this.options.maxTurnsPerTask) {
        await this.block(task, `Reached the limit of ${this.options.maxTurnsPerTask} model turns.`);
        return 0;
      }

      if (transcript[transcript.length - 1]?.role === 'assistant') {
        if (countType(events, EVENTS.nudge) >= MAX_NUDGES) {
          await this.block(task, 'The agent kept stopping without finishing its task.');
          return 0;
        }
        await this.taskRepository.addEvent(task.id, EVENTS.nudge, SYSTEM, { text: NUDGE });
        continue;
      }

      const outcome = await this.callModel(
        task,
        agent,
        version,
        client,
        system,
        transcript,
        events
      );
      if (outcome !== 'continue') {
        return outcome === 'stop' ? 0 : outcome;
      }
    }
    return 0;
  }

  // Returns 'continue', 'stop', or a retry delay in milliseconds.
  private async callModel(
    task: Task,
    agent: Agent,
    version: AgentVersion,
    client: ModelClient,
    system: string,
    transcript: ModelTranscriptEntry[],
    events: TaskEvent[]
  ): Promise<'continue' | 'stop' | number> {
    const agentActor: Actor = { type: 'agent', id: agent.id };
    // Model calls can be slow. Keep the lease alive while waiting, and drop the result if the
    // lease was lost anyway, because another worker may be running the task by now.
    let leaseHeld = true;
    const heartbeat = setInterval(() => {
      this.taskRepository
        .renewLease(task.id, this.options.workerId, this.options.leaseMs)
        .then((held) => (leaseHeld = leaseHeld && held))
        .catch(() => (leaseHeld = false));
    }, this.options.leaseMs / 3);
    try {
      const result = await client.complete({
        model: version.model,
        system,
        transcript,
        tools: AGENT_TOOL_DEFINITIONS,
        maxTokens: this.options.maxTokens
      });
      clearInterval(heartbeat);
      if (
        !leaseHeld ||
        !(await this.taskRepository.renewLease(
          task.id,
          this.options.workerId,
          this.options.leaseMs
        ))
      ) {
        return 'stop';
      }
      await this.taskRepository.addEvent(task.id, EVENTS.modelTurn, agentActor, {
        raw: result.raw,
        provider: version.provider,
        text: result.text,
        toolCalls: result.toolCalls,
        stopReason: result.stopReason,
        usage: result.usage,
        servedModel: result.servedModel
      });
      this.runnerLogger.onModelTurn(task.id, version.provider, result.servedModel, result.usage);

      if (result.stopReason === 'refusal') {
        await this.block(task, `The ${version.provider} model declined this request.`);
        return 'stop';
      }
      return 'continue';
    } catch (error) {
      clearInterval(heartbeat);
      if (!(error instanceof ModelClientError)) {
        throw error;
      }
      // Only failures since the last successful turn count, so a long task can survive
      // occasional errors.
      const failures = countSinceLast(events, EVENTS.modelFailed, EVENTS.modelTurn) + 1;
      await this.taskRepository.addEvent(task.id, EVENTS.modelFailed, SYSTEM, {
        provider: error.provider,
        retryable: error.retryable,
        message: error.message
      });
      this.runnerLogger.onModelFailed(task.id, error.provider, error.retryable, error.message);
      if (error.retryable && failures < MAX_MODEL_FAILURES) {
        return 5_000 * 2 ** (failures - 1);
      }
      await this.block(task, `The model call failed: ${error.message}`);
      return 'stop';
    }
  }

  // Runs the agent's tool calls and records all results together. Returns true when one of
  // them ended the run (the task waits, completes, or is blocked).
  private async runTools(task: Task, agent: Agent, calls: ModelToolCall[]): Promise<boolean> {
    const results: ModelToolResult[] = [];
    let stopped = false;
    for (const call of calls) {
      if (stopped) {
        results.push({
          callId: call.id,
          content: 'Skipped: an earlier tool call in this turn already ended your turn.',
          isError: true
        });
        continue;
      }
      try {
        const content = await this.runTool(task, agent, call);
        results.push({ callId: call.id, content, isError: false });
        stopped = STOPPING_TOOLS.has(call.name);
      } catch (error) {
        const message = error instanceof AppError ? error.message : (error as Error).message;
        results.push({ callId: call.id, content: message, isError: true });
      }
    }
    await this.taskRepository.addEvent(task.id, EVENTS.toolResults, SYSTEM, { results });
    return stopped;
  }

  private async runTool(task: Task, agent: Agent, call: ModelToolCall): Promise<string> {
    const input = (call.input ?? {}) as Record<string, unknown>;
    const agentActor: Actor = { type: 'agent', id: agent.id };

    switch (call.name) {
      case AGENT_TOOLS.sendMessage: {
        const { message } = await this.postAsAgent(task, agent, call.id, {
          body: requireString(input, 'body'),
          to: optionalStrings(input, 'to'),
          inReplyToMessageId: optionalString(input, 'reply_to_message_id')
        });
        return `Posted message ${message.id}.`;
      }

      case AGENT_TOOLS.ask: {
        const to = requireString(input, 'to');
        const { message } = await this.postAsAgent(task, agent, call.id, {
          body: requireString(input, 'question'),
          to: [to],
          inReplyToMessageId: null
        });
        // After a crash this call can run again. If it already made a wait for this question,
        // even one that has since been answered, don't make another.
        const waits = await this.taskRepository.listWaits(task.id, { openOnly: false });
        const fresh = await this.lifecycle.requireTask(task.id);
        if (fresh.state === 'working' && !waits.some((wait) => wait.targetId === message.id)) {
          await this.lifecycle.waitFor(task.id, agentActor, [
            { kind: 'reply', targetId: message.id, description: `Reply from ${to}` }
          ]);
        }
        return `Asked ${to} (message ${message.id}). Your work is paused until they reply.`;
      }

      case AGENT_TOOLS.saveOutput: {
        const output = await this.saveOutputOnce(task, agentActor, call.id, {
          title: requireString(input, 'title'),
          content: requireString(input, 'content'),
          kind: (optionalString(input, 'kind') ?? 'text') as 'text' | 'link' | 'data' | 'log',
          uri: optionalString(input, 'uri')
        });
        return `Saved output ${output}.`;
      }

      case AGENT_TOOLS.completeTask: {
        const result = requireString(input, 'result');
        const check = {
          met: input.criteria_met === true,
          summary: requireString(input, 'criteria_check')
        };
        if (!check.met) {
          throw new AppError(
            'taskCompletionRejected',
            `You said the criteria are not met: ${check.summary}. Keep working, ask for help, or report blocked.`
          );
        }
        await this.saveOutputOnce(task, agentActor, call.id, {
          title: 'Result',
          content: result,
          kind: 'text',
          uri: null
        });
        const done = await this.lifecycle.completeTask(task.id, agentActor, check);
        if (done.state !== 'completed') {
          // Unreviewed results stay off the conversation. The result is posted once approved.
          await this.answerRequester(
            task,
            agent,
            `${call.id}:review`,
            'My result is ready for review.'
          );
          return 'Result submitted. A person will review it before the task completes.';
        }
        await this.answerRequester(task, agent, `${call.id}:answer`, result);
        await this.taskRepository.addEvent(task.id, EVENTS.resultPosted, agentActor, {});
        return 'Task completed. Your result was posted.';
      }

      case AGENT_TOOLS.reportBlocked: {
        const reason = requireString(input, 'reason');
        await this.lifecycle.blockTask(task.id, agentActor, reason);
        await this.answerRequester(task, agent, `${call.id}:answer`, `I can't proceed: ${reason}`);
        return 'Task blocked. A person will look at it.';
      }

      case AGENT_TOOLS.suggestParticipant: {
        if (!task.conversationId) {
          throw new AppError('validationError', 'This task has no conversation to suggest for.');
        }
        const name = requireString(input, 'name');
        const participants = await this.loadParticipants(task.conversationId);
        const suggested = await this.agentRepository.getByName(name.trim());
        if (suggested && participants.some((p) => p.type === 'agent' && p.id === suggested.id)) {
          // Also what a replay sees if a person added the agent after the first run.
          return `${suggested.name} is already in this conversation. Ask them directly.`;
        }
        if (!suggested || suggested.disabledAt || !suggested.currentVersionId) {
          throw new AppError(
            'suggestionNotAvailable',
            `No available agent named "${name}" in the directory. Pick one from the directory list.`
          );
        }
        // Addressed to the people here by ID, never by name, so no agent is woken: people get
        // no deliveries, and the suggested agent is never contacted.
        const humans = participants
          .filter((p) => p.type === 'human')
          .map((p): ParticipantRef => ({ type: 'human', id: p.id }));
        const { message, created } = await this.postAsAgent(
          task,
          agent,
          call.id,
          {
            body: `Suggestion: add ${suggested.name} (${oneLine(suggested.purpose)}) to this conversation. ${requireString(input, 'reason')}`,
            to: [],
            mentionRefs: humans,
            inReplyToMessageId: null
          },
          participants
        );
        if (created) {
          await this.taskRepository.addEvent(task.id, EVENTS.participantSuggested, agentActor, {
            agentId: suggested.id,
            messageId: message.id
          });
          this.runnerLogger.onParticipantSuggested(task.id, suggested.id);
        }
        return `Suggested ${suggested.name} to the people here. A person decides whether to add them.`;
      }

      default:
        throw new AppError('validationError', `Unknown tool ${call.name}.`);
    }
  }

  // Posts the result or reason in reply to the message that asked for the work.
  private async answerRequester(
    task: Task,
    agent: Agent,
    key: string,
    body: string
  ): Promise<void> {
    if (!task.conversationId) {
      return;
    }
    const request = task.requestMessageId
      ? await this.messageRepository.getById(task.requestMessageId)
      : null;
    const requester = request ? authorRef(request) : null;
    // An agent that asked is only addressed while it still has open work here, such as a task
    // waiting for this answer. Addressing a finished agent would start new work for it, and
    // two agents could keep starting work for each other.
    const addressRequester =
      requester?.type === 'human' ||
      (requester?.type === 'agent' &&
        (await this.taskRepository.findOpenTask(task.conversationId, requester.id)) !== null);
    await this.postAsAgent(task, agent, key, {
      body,
      to: [],
      mentionRefs: requester && addressRequester ? [requester] : [],
      inReplyToMessageId: request?.id ?? null
    });
  }

  private async postAsAgent(
    task: Task,
    agent: Agent,
    key: string,
    input: {
      body: string;
      to: string[];
      mentionRefs?: ParticipantRef[];
      inReplyToMessageId: string | null;
    },
    loaded?: ContextParticipant[]
  ): Promise<{ message: Message; created: boolean }> {
    if (!task.conversationId) {
      throw new AppError('validationError', 'This task has no conversation to post in.');
    }
    const participants = loaded ?? (await this.loadParticipants(task.conversationId));
    const named = input.to.map((name) => resolveParticipant(participants, name));
    const mentions = dedupeRefs([...named, ...(input.mentionRefs ?? [])]).filter((ref) =>
      participants.some((p) => p.type === ref.type && p.id === ref.id)
    );

    let repliedToAuthor: ParticipantRef | null = null;
    if (input.inReplyToMessageId) {
      const repliedTo = await this.messageRepository.getById(input.inReplyToMessageId);
      if (!repliedTo || repliedTo.conversationId !== task.conversationId) {
        throw new AppError(
          'messageNotFound',
          `Message ${input.inReplyToMessageId} is not in this conversation.`
        );
      }
      repliedToAuthor = authorRef(repliedTo);
    }

    return this.messageRepository.create({
      conversationId: task.conversationId,
      authorType: 'agent',
      authorId: agent.id,
      body: input.body,
      mentions,
      inReplyToMessageId: input.inReplyToMessageId,
      taskId: task.id,
      deliverToAgentIds: addressedAgentIds({
        mentions,
        repliedToAuthor,
        memberAgentIds: new Set(participants.filter((p) => p.type === 'agent').map((p) => p.id)),
        authorAgentId: agent.id
      }),
      clientKey: `tool:${task.id}:${key}`
    });
  }

  private async saveOutputOnce(
    task: Task,
    actor: Actor,
    callId: string,
    input: {
      title: string;
      content: string;
      kind: 'text' | 'link' | 'data' | 'log';
      uri: string | null;
    }
  ): Promise<string> {
    const existing = (await this.taskRepository.listOutputs(task.id)).find(
      (output) => output.metadata.toolCallId === callId
    );
    if (existing) {
      return existing.id;
    }
    const output = await this.lifecycle.addOutput(task.id, actor, {
      ...input,
      metadata: { toolCallId: callId }
    });
    return output.id;
  }

  // Blocks the task for a platform reason, like a missing API key, and says so in the
  // conversation, so the person who asked isn't left waiting with no answer.
  private async block(task: Task, reason: string): Promise<void> {
    try {
      await this.lifecycle.blockTask(task.id, SYSTEM, reason);
    } catch (error) {
      ignoreStateConflict(error);
      return;
    }
    const agent = await this.agentRepository.getById(task.ownerAgentId);
    const blockCount = await this.taskRepository.countEvents(task.id, 'task.state.changed');
    if (agent) {
      await this.answerRequester(
        task,
        agent,
        `blocked:${blockCount}`,
        `I can't proceed: ${reason}`
      );
    }
  }

  // Context

  private async buildPrompt(task: Task, agent: Agent): Promise<string> {
    const request = task.requestMessageId
      ? await this.messageRepository.getById(task.requestMessageId)
      : null;
    const requesterName = request
      ? await this.participantName(authorRef(request))
      : task.requestedById && task.requestedByType !== 'schedule'
        ? await this.participantName({ type: task.requestedByType, id: task.requestedById })
        : 'a schedule';

    if (!task.conversationId) {
      return buildTaskPrompt({
        task,
        requesterName,
        participants: [],
        history: [],
        nameOf: () => ''
      });
    }

    const participants = await this.loadParticipants(task.conversationId);
    const membership = await this.conversationRepository.getMember(task.conversationId, {
      type: 'agent',
      id: agent.id
    });
    // Only history this agent may see: nothing from before it joined, if it joined that way.
    const history = await this.messageRepository.listRecent(task.conversationId, {
      since: membership?.historyFrom ?? null,
      limit: this.options.historyLimit
    });
    const names = new Map(participants.map((p) => [`${p.type}:${p.id}`, p.name]));
    const directory = (await this.directoryOutside(participants)).map(({ name, purpose }) => ({
      name,
      purpose
    }));
    return buildTaskPrompt({
      task,
      requesterName,
      participants,
      directory,
      history,
      nameOf: (message) => names.get(`${message.authorType}:${message.authorId}`) ?? 'Someone'
    });
  }

  // Enabled agents with a configuration that aren't members. Only name and purpose are shown.
  private async directoryOutside(participants: ContextParticipant[]): Promise<Agent[]> {
    return this.agentRepository.listDirectory({
      excludeIds: participants.filter((p) => p.type === 'agent').map((p) => p.id),
      limit: DIRECTORY_IN_PROMPT,
      offset: 0
    });
  }

  private async loadParticipants(conversationId: string): Promise<ContextParticipant[]> {
    const members = await this.conversationRepository.listMembers(conversationId);
    return Promise.all(
      members.map(async (member) => {
        if (member.participant.type === 'agent') {
          const agent = await this.agentRepository.getById(member.participant.id);
          return {
            ...member.participant,
            name: agent?.name ?? 'Unknown agent',
            purpose: agent?.purpose ?? null
          };
        }
        return {
          ...member.participant,
          name: await this.participantName(member.participant),
          purpose: null
        };
      })
    );
  }

  private async participantName(ref: ParticipantRef | null): Promise<string> {
    if (!ref) {
      return 'the platform';
    }
    if (ref.type === 'agent') {
      return (await this.agentRepository.getById(ref.id))?.name ?? 'an agent';
    }
    return (await this.humanRepository.getById(ref.id))?.name ?? 'a person';
  }

  // Transcript

  private async loadEvents(taskId: string): Promise<TaskEvent[]> {
    const events: TaskEvent[] = [];
    for (let afterId = 0; ;) {
      const page = await this.taskRepository.listEvents(taskId, { afterId, limit: 500 });
      events.push(...page);
      if (page.length < 500) {
        return events;
      }
      afterId = page[page.length - 1].id;
    }
  }

  // Turns the event history into a model transcript. Messages that arrive while a tool call is
  // still waiting for its results are held back until after the results, because providers
  // need results right after the call. Returns the calls that still need results.
  //
  // Turns from another provider, such as before a version change, can't be sent back in their
  // own format. They are shown as text instead.
  async rebuildTranscript(
    prompt: string,
    events: TaskEvent[],
    provider: ModelProvider
  ): Promise<{ transcript: ModelTranscriptEntry[]; pendingCalls: ModelToolCall[] }> {
    const transcript: ModelTranscriptEntry[] = [{ role: 'user', text: prompt }];
    let pendingCalls: ModelToolCall[] = [];
    let pendingIsForeign = false;
    let heldBack: string[] = [];
    // A crash during delivery can record the same message twice. Show it once.
    const seenMessages = new Set<string>();
    const say = (text: string) => {
      if (pendingCalls.length > 0) {
        heldBack.push(text);
      } else {
        transcript.push({ role: 'user', text });
      }
    };

    for (const event of events) {
      switch (event.type) {
        case EVENTS.modelTurn: {
          const calls = (event.data.toolCalls as ModelToolCall[] | undefined) ?? [];
          const turnProvider = event.data.provider as ModelProvider | undefined;
          pendingIsForeign = turnProvider !== undefined && turnProvider !== provider;
          if (pendingIsForeign) {
            const callText = calls.map((call) => `${call.name}(${JSON.stringify(call.input)})`);
            transcript.push({
              role: 'user',
              text: [
                'Earlier in this task, under a previous configuration, you wrote:',
                (event.data.text as string) || '(no text)',
                ...(callText.length > 0 ? [`and called: ${callText.join(', ')}`] : [])
              ].join('\n')
            });
          } else {
            transcript.push({ role: 'assistant', raw: event.data.raw });
          }
          pendingCalls = calls;
          break;
        }
        case EVENTS.toolResults: {
          const results = event.data.results as ModelToolResult[];
          if (pendingIsForeign) {
            transcript.push({
              role: 'user',
              text: `Those calls returned: ${results.map((result) => result.content).join(' | ')}`
            });
          } else {
            transcript.push({ role: 'tool_results', results });
          }
          pendingIsForeign = false;
          pendingCalls = [];
          for (const text of heldBack) {
            transcript.push({ role: 'user', text });
          }
          heldBack = [];
          break;
        }
        case EVENTS.messageReceived: {
          const messageId = event.data.messageId as string;
          if (seenMessages.has(messageId)) {
            break;
          }
          seenMessages.add(messageId);
          const message = await this.messageRepository.getById(messageId);
          if (message) {
            const name = await this.participantName(authorRef(message));
            say(`New message in the conversation:\n${formatMessage(message, name)}`);
          }
          break;
        }
        case EVENTS.nudge: {
          say(event.data.text as string);
          break;
        }
        case 'task.state.changed': {
          // A person sending the task back with a reason, such as review notes.
          if (event.data.to === 'working' && event.data.reason && event.actor.type === 'human') {
            say(`Update from a person: ${event.data.reason as string}`);
          }
          break;
        }
      }
    }
    return { transcript, pendingCalls };
  }
}

function authorRef(message: Message): ParticipantRef | null {
  return message.authorType !== 'system' && message.authorId
    ? { type: message.authorType, id: message.authorId }
    : null;
}

function authorActor(message: Message): Actor {
  return { type: message.authorType, id: message.authorId };
}

function resolveParticipant(participants: ContextParticipant[], name: string): ParticipantRef {
  const wanted = name.trim().toLowerCase();
  const match = participants.find(
    (p) => p.name.toLowerCase() === wanted || p.id.toLowerCase() === wanted
  );
  if (!match) {
    throw new AppError(
      'mentionNotMember',
      `No participant named "${name}". Participants: ${participants.map((p) => p.name).join(', ')}.`
    );
  }
  return { type: match.type, id: match.id };
}

function dedupeRefs(refs: ParticipantRef[]): ParticipantRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function countType(events: TaskEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

function countSinceLast(events: TaskEvent[], type: string, resetType: string): number {
  let count = 0;
  for (const event of events) {
    if (event.type === resetType) {
      count = 0;
    } else if (event.type === type) {
      count++;
    }
  }
  return count;
}

function excerpt(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('validationError', `The ${field} field is required and must be text.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function optionalStrings(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function ignoreStateConflict(error: unknown): void {
  if (!(error instanceof AppError) || error.name !== 'taskStateConflict') {
    throw error;
  }
}

function ignoreWaitAlreadyResolved(error: unknown): void {
  if (
    !(error instanceof AppError) ||
    !['taskWaitNotFound', 'taskStateConflict'].includes(error.name)
  ) {
    throw error;
  }
}
