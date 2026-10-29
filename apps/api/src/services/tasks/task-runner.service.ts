import { createHash } from 'node:crypto';
import {
  AgentRepository,
  ApprovalRepository,
  CatalogRepository,
  ConnectionOAuthRepository,
  ConversationRepository,
  DocumentRepository,
  HumanRepository,
  MessageRepository,
  NoteRepository,
  ResponsibilityRepository,
  TaskCapabilityRepository,
  TaskRepository,
  StoredHttpCall
} from '../../data';
import {
  ConnectionClient,
  ConnectionOAuthClient,
  McpAuthenticationError,
  McpClient,
  ModelClient,
  ModelClientError,
  ModelToolCall,
  ModelToolDefinition,
  ModelToolResult,
  ModelTranscriptEntry,
  ModelTurnRequest,
  ModelTurnResult,
  WorkspaceClient
} from '../../integrations';
import { TaskLogger, TaskRunnerLogger } from '../../observability';
import { addressedAgentIds } from '../conversations/addressing.rules';
import { connectionCallDenied } from '../connections/connection-access.rules';
import { AppError } from '../../shared/errors';
import {
  ACCESS_DURATIONS,
  AccessDuration,
  Actor,
  Agent,
  AgentVersion,
  Approval,
  ApprovalRequest,
  ApprovalResult,
  CapabilityAccessRequest,
  Connection,
  ConnectionCallRequest,
  GrantTargetType,
  isAccessRequest,
  McpConnectionCallRequest,
  HTTP_METHODS,
  HttpMethod,
  Message,
  ModelProvider,
  ParticipantRef,
  Responsibility,
  Skill,
  SkillVersion,
  Task,
  TaskEvent
} from '../../shared/types';
import {
  buildSystemPrompt,
  buildTaskPrompt,
  ContextParticipant,
  DEFAULT_RESPONSE_CRITERIA,
  formatMessage,
  MAX_DOCUMENT_CHARS,
  oneLine
} from './agent-context';
import {
  AGENT_TOOL_DEFINITIONS,
  AGENT_TOOLS,
  HTTP_REQUEST_TOOL,
  STOPPING_TOOLS
} from './agent-tools';
import {
  addOngoingAccess,
  describeScope,
  isEmptyScope,
  limitConnection,
  narrowScope,
  scopeOf
} from './capability-access';
import { buildMcpToolName, isMcpToolName, parseMcpConnectionId } from './mcp-tool-names';
import { callTaskModel, ModelCallStoppedError } from './model-call';
import { calculateCostUsd, formatDollars, PriceTable, startOfMonth } from './pricing';
import { planRun } from './schedule';
import { startResponsibilityRun } from './scheduled-runs';
import { countEventsOfType, countEventsSinceLast, findBudgetOverrun } from './task-budget';
import { TASK_EVENTS } from './task-events';
import { ignoreStateConflict, ignoreWaitAlreadyResolved, TaskLifecycle } from './task-lifecycle';
import { readOptionalString, readRequiredString, readStringList, ToolInput } from './tool-input';

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
  modelTimeoutMs: number;
  historyLimit: number;
  // Before a task completes, a separate model call checks the result against its criteria, so
  // the agent's own word isn't enough. Skipped for the scripted test provider.
  completionCheck: boolean;
  // Model prices, to turn token usage into dollars. Models not listed have an unknown cost.
  prices: PriceTable;
  // The most one task may spend, unless its agent's configuration sets maxCostUsd.
  taskBudgetUsd: number;
}

export const DEFAULT_RUNNER_OPTIONS: Omit<TaskRunnerOptions, 'workerId'> = {
  leaseMs: 120_000,
  concurrency: 4,
  turnsPerClaim: 8,
  maxTurnsPerTask: 40,
  maxTokens: 16_000,
  modelTimeoutMs: 120_000,
  historyLimit: 30,
  completionCheck: true,
  prices: {},
  taskBudgetUsd: 1
};

// After this many failed completion checks, the task is blocked for a person instead of
// letting the agent keep trying.
const MAX_COMPLETION_REJECTIONS = 2;

const MAX_MODEL_FAILURES = 3;

const COMPLETION_CHECK_PROMPT = `You check whether a task's result meets its completion criteria. You did not do the work, and you don't have to be kind. Judge only from the request, the criteria, the outputs, and the result below.

Reply with one line. Start with "MET:" if every criterion is met, or "NOT MET:" if any is not. Then say briefly why. For NOT MET, name each unmet criterion and what is missing.`;
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LEASE_MS = 60_000;
// How many agent-to-agent requests can chain before the runner stops starting new tasks. This
// keeps two agents from asking each other for work forever.
const MAX_REQUEST_DEPTH = 5;
// How many directory agents the prompt lists. suggest_participant can name any agent in the
// directory, listed or not.
const DIRECTORY_AGENTS_IN_PROMPT = 30;
const NOTES_IN_PROMPT = 20;
const MAX_NUDGES = 2;
const NUDGE_TEXT =
  'You ended your turn without finishing. Use complete_task, ask, or report_blocked to finish, or send_message to post an update.';
const SYSTEM_ACTOR: Actor = { type: 'system', id: null };
const MAX_NOTE_CHARS = 2000;
// How many discoverable skills, and connections, find_capabilities and request_access look at.
const MAX_DISCOVERABLE = 200;

// What a tool call gives back: the text the agent sees, or that text plus a flag saying the
// call ended the agent's turn (such as a call that now waits for approval).
type ToolOutcome = string | { content: string; stop: boolean };

// The runner. It is not an agent and makes no decisions about the work: it delivers messages,
// runs agents' model turns, carries out their tool calls, and records everything. All state is
// in the database, so a restart picks up where it stopped.
export class TaskRunnerService {
  private readonly lifecycle: TaskLifecycle;
  private readonly shutdownController = new AbortController();
  private readonly runningTasks = new Map<string, Promise<void>>();
  private polling = false;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly approvalRepository: ApprovalRepository,
    private readonly taskCapabilityRepository: TaskCapabilityRepository,
    private readonly noteRepository: NoteRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly responsibilityRepository: ResponsibilityRepository,
    private readonly connectionClient: ConnectionClient,
    private readonly workspaceClient: WorkspaceClient,
    private readonly modelClients: Partial<Record<ModelProvider, ModelClient>>,
    taskLogger: TaskLogger,
    private readonly runnerLogger: TaskRunnerLogger,
    private readonly options: TaskRunnerOptions,
    private readonly mcpClient?: McpClient,
    private readonly oauthRepository?: ConnectionOAuthRepository,
    private readonly oauthClient?: ConnectionOAuthClient
  ) {
    this.lifecycle = new TaskLifecycle(taskRepository, taskLogger);
  }

  // Control work stays responsive while claimed tasks wait on providers. Callers can await
  // newly started tasks for deterministic tests; the server polls without waiting for them.
  async tick({ waitForTasks = true }: { waitForTasks?: boolean } = {}): Promise<void> {
    if (this.shutdownController.signal.aborted || this.polling) return;
    this.polling = true;
    const started: Promise<void>[] = [];
    try {
      await this.startDueRuns();
      await this.processDeliveries();
      await this.repairWaitingTasks();
      await this.postPendingResults();
      await this.executeApprovedCalls();
      const capacity = this.options.concurrency - this.runningTasks.size;
      if (!this.shutdownController.signal.aborted && capacity > 0) {
        const tasks = await this.taskRepository.claimRunnable(
          this.options.workerId,
          this.options.leaseMs,
          capacity
        );
        for (const task of tasks) {
          if (this.runningTasks.has(task.id)) continue;
          const job = this.runClaimedTask(task)
            .catch((error) => this.runnerLogger.onTaskRunFailed(task.id, error))
            .finally(() => {
              this.runningTasks.delete(task.id);
            });
          this.runningTasks.set(task.id, job);
          started.push(job);
        }
      }
    } finally {
      this.polling = false;
    }
    if (waitForTasks) await Promise.all(started);
  }

  stop(): void {
    this.shutdownController.abort();
  }

  async drain(): Promise<void> {
    await Promise.all(this.runningTasks.values());
  }

  // Scheduling

  // Starts runs for responsibilities that are due. Only one runner advances each slot.
  // The run's key is its time slot, so a slot never runs twice. Slots
  // missed while the service was down follow each responsibility's missed-run policy.
  async startDueRuns(now: Date = new Date()): Promise<void> {
    for (const responsibility of await this.responsibilityRepository.listDue(now, 20)) {
      // One bad responsibility is logged and tried again next tick; it never stops the rest
      // of the tick.
      try {
        await this.startDueRun(responsibility, now);
      } catch (error) {
        this.runnerLogger.onScheduledRunFailed(responsibility.id, error);
      }
    }
  }

  // The run is created first, then the schedule moves on. A crash between the two leaves the
  // slot due, and the next tick finds the same run by its slot key and moves the schedule on.
  // A crash before the run is created leaves the slot due too, so it isn't lost.
  private async startDueRun(responsibility: Responsibility, now: Date): Promise<void> {
    const plan = planRun(responsibility, now);
    if (!plan) {
      return;
    }
    let started = false;
    if (plan.start) {
      const result = await startResponsibilityRun(
        {
          taskRepository: this.taskRepository,
          agentRepository: this.agentRepository,
          conversationRepository: this.conversationRepository,
          lifecycle: this.lifecycle
        },
        responsibility,
        {
          runKey: `schedule:${responsibility.id}:${plan.slot.toISOString()}`,
          expectedNextRunAt: responsibility.nextRunAt,
          startedBy: SYSTEM_ACTOR,
          note:
            plan.skipped > 0
              ? `(${plan.skipped} earlier scheduled run${plan.skipped === 1 ? ' was' : 's were'} missed while the platform was off.)`
              : undefined
        }
      );
      if ('skippedReason' in result) {
        this.runnerLogger.onScheduledRunSkipped(responsibility.id, result.skippedReason);
      } else {
        started = true;
        this.runnerLogger.onScheduledRun(responsibility.id, result.task.id, plan.skipped);
      }
    } else if (plan.ask) {
      await this.askToCatchUp(responsibility, plan.slot, plan.skipped, plan.nextRunAt);
    } else {
      this.runnerLogger.onScheduledRun(responsibility.id, null, plan.skipped);
    }
    // Only one runner moves a slot on. lastRunAt only moves when a run really started.
    await this.responsibilityRepository.advance(responsibility.id, responsibility.nextRunAt, {
      nextRunAt: plan.nextRunAt,
      lastRunAt: started ? now : null,
      catchUp: plan.ask ? { slot: plan.slot, missed: plan.skipped } : null
    });
  }

  // Asks the people in the schedule's conversation whether to run now or wait. The answer
  // comes through the API (or the Schedules page), so no agent is woken by this message. The
  // message key is the slot, so a retry after a crash doesn't post twice.
  private async askToCatchUp(
    responsibility: Responsibility,
    slot: Date,
    missed: number,
    nextRunAt: Date
  ): Promise<void> {
    this.runnerLogger.onCatchUpAsked(responsibility.id, missed);
    if (!responsibility.conversationId) {
      return;
    }
    const people = (await this.conversationRepository.listMembers(responsibility.conversationId))
      .filter((member) => member.participant.type === 'human')
      .map((member) => member.participant);
    const runs = missed === 1 ? 'A scheduled run' : `${missed} scheduled runs`;
    await this.messageRepository.create({
      conversationId: responsibility.conversationId,
      authorType: 'system',
      authorId: null,
      body: `${runs} of "${responsibility.title}" ${missed === 1 ? 'was' : 'were'} missed while the platform was off. Run it now, or wait for the next one at ${nextRunAt.toISOString().slice(0, 16).replace('T', ' ')} UTC? Answer on the Schedules page. If nobody answers, the next run happens as usual.`,
      mentions: people,
      inReplyToMessageId: null,
      taskId: null,
      deliverToAgentIds: [],
      clientKey: `catchup:${responsibility.id}:${slot.toISOString()}`
    });
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
    const author = getAuthorActor(message);
    const openTask = await this.taskRepository.findOpenTask(message.conversationId, agent.id);
    if (openTask) {
      await this.taskRepository.addEvent(openTask.id, TASK_EVENTS.messageReceived, author, {
        messageId: message.id
      });
      await this.resolveReplyWaits(openTask, message, author);
      // A blocked task needs a person. A person writing to the agent is that attention.
      if (openTask.state === 'blocked' && !openTask.pausedAt && message.authorType === 'human') {
        await this.lifecycle
          .transition(openTask, 'working', author, { reason: null })
          .catch(ignoreStateConflict);
      }
      this.runnerLogger.onMessageDelivered(message.id, agent.id, openTask.id, 'update');
      return openTask.id;
    }

    if (agent.disabledAt || !agent.currentVersionId) {
      return null;
    }
    if (
      message.authorType === 'agent' &&
      (await this.measureRequestDepth(message.taskId)) >= MAX_REQUEST_DEPTH
    ) {
      this.runnerLogger.onRequestChainTooDeep(message.id, agent.id);
      return null;
    }
    const authorName = await this.lookupParticipantName(getAuthorRef(message));
    const { task, created } = await this.taskRepository.create({
      runKey: `message:${message.id}:${agent.id}`,
      conversationId: message.conversationId,
      ownerAgentId: agent.id,
      agentVersionId: agent.currentVersionId,
      title: `Respond to ${authorName}: ${shortenForTitle(message.body)}`,
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
  private async measureRequestDepth(taskId: string | null): Promise<number> {
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
      TASK_EVENTS.resultPosted,
      20
    )) {
      const agent = await this.agentRepository.getById(task.ownerAgentId);
      const result = (await this.taskRepository.listOutputs(task.id))
        .filter((output) => output.title === 'Result')
        .pop();
      if (agent && result?.content) {
        await this.answerRequester(task, agent, 'result', result.content);
      }
      await this.taskRepository.addEvent(task.id, TASK_EVENTS.resultPosted, SYSTEM_ACTOR, {
        outputId: result?.id ?? null
      });
    }
  }

  private async repairWaitingTasks(): Promise<void> {
    for (const task of await this.taskRepository.listWaitingWithoutOpenWaits(20)) {
      await this.lifecycle.wakeIfReady(task.id, SYSTEM_ACTOR).catch(ignoreStateConflict);
    }
  }

  // Running

  private async runClaimedTask(task: Task): Promise<void> {
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
    if (this.shutdownController.signal.aborted) return 0;
    const agent = await this.agentRepository.getById(claimed.ownerAgentId);
    if (agent?.deletedAt) return 0;
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

    // Only skills and connections that are still granted and enabled. A revoke takes effect on
    // the next claim for instructions, and on the very next call for http_request.
    const { skills, connections } = await this.loadUsableCatalog(agent.id, version, claimed.id);
    const system = buildSystemPrompt(agent, version, { skills, connections });
    const tools = [
      ...AGENT_TOOL_DEFINITIONS,
      ...(connections.some((connection) => connection.kind !== 'mcp') ? [HTTP_REQUEST_TOOL] : []),
      ...(await this.discoverMcpTools(claimed, connections))
    ];
    const prompt = await this.buildPrompt(claimed, agent);

    for (let turn = 0; turn < this.options.turnsPerClaim; turn++) {
      if (this.shutdownController.signal.aborted) return 0;
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
        version.provider,
        client.transcriptFormat
      );

      // A tool call that was asked for but never run, such as after a crash, runs first.
      if (pendingCalls.length > 0) {
        let stopped;
        try {
          const latestTurn = events.filter((event) => event.type === TASK_EVENTS.modelTurn).at(-1);
          const contextEventId =
            typeof latestTurn?.data.contextEventId === 'number'
              ? latestTurn.data.contextEventId
              : (latestTurn?.id ?? 0);
          stopped = await this.runToolCalls(task, agent, pendingCalls, contextEventId);
        } catch (error) {
          if (error instanceof ModelCallStoppedError) return 0;
          throw error;
        }
        if (typeof stopped === 'number') return stopped;
        if (stopped) {
          return 0;
        }
        continue;
      }

      const overBudget = findBudgetOverrun(
        task,
        version,
        events,
        this.options.maxTurnsPerTask,
        new Date(),
        this.options.taskBudgetUsd
      );
      if (overBudget) {
        await this.block(
          task,
          `${overBudget} A person can raise the agent's limits and move this task to the new version.`
        );
        return 0;
      }
      const overSpending = await this.checkSpendingBudgets(task);
      if (overSpending) {
        await this.block(task, overSpending);
        return 0;
      }

      if (transcript[transcript.length - 1]?.role === 'assistant') {
        if (countEventsOfType(events, TASK_EVENTS.nudge) >= MAX_NUDGES) {
          await this.block(task, 'The agent kept stopping without finishing its task.');
          return 0;
        }
        await this.taskRepository.addEvent(task.id, TASK_EVENTS.nudge, SYSTEM_ACTOR, {
          text: NUDGE_TEXT
        });
        continue;
      }

      const outcome = await this.callModel(
        task,
        agent,
        version,
        tools,
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

  // All provider calls share the same deadline and task-control checks.
  private requestModel(
    task: Task,
    version: AgentVersion,
    events: TaskEvent[],
    client: ModelClient,
    request: ModelTurnRequest
  ): Promise<ModelTurnResult> {
    return callTaskModel({
      repository: this.taskRepository,
      task,
      version,
      events,
      client,
      request,
      workerId: this.options.workerId,
      leaseMs: this.options.leaseMs,
      timeoutMs: this.options.modelTimeoutMs,
      shutdownSignal: this.shutdownController.signal
    });
  }

  // Returns 'continue', 'stop', or a retry delay in milliseconds.
  private async callModel(
    task: Task,
    agent: Agent,
    version: AgentVersion,
    tools: ModelToolDefinition[],
    client: ModelClient,
    system: string,
    transcript: ModelTranscriptEntry[],
    events: TaskEvent[]
  ): Promise<'continue' | 'stop' | number> {
    const release = await this.agentRepository.acquireExecution(agent.id);
    if (!release) return 'stop';
    const agentActor: Actor = toAgentActor(agent);
    try {
      await this.taskRepository.addEvent(task.id, TASK_EVENTS.modelStarted, agentActor, {});
      const result = await this.requestModel(task, version, events, client, {
        model: version.model,
        system,
        transcript,
        tools,
        maxTokens: this.options.maxTokens
      });
      await this.taskRepository.addEvent(task.id, TASK_EVENTS.modelTurn, agentActor, {
        raw: result.raw,
        contextEventId: events.at(-1)?.id ?? 0,
        provider: version.provider,
        format: client.transcriptFormat,
        text: result.text,
        toolCalls: result.toolCalls,
        stopReason: result.stopReason,
        usage: result.usage,
        costUsd: calculateCostUsd(this.options.prices, version.model, result.usage),
        servedModel: result.servedModel
      });
      this.runnerLogger.onModelTurn(task.id, version.provider, result.servedModel, result.usage);

      if (result.stopReason === 'refusal') {
        await this.block(task, `The ${version.provider} model declined this request.`);
        return 'stop';
      }
      return 'continue';
    } catch (error) {
      if (error instanceof ModelCallStoppedError) return 'stop';
      if (!(error instanceof ModelClientError)) {
        throw error;
      }
      // Only failures since the last successful turn count, so a long task can survive
      // occasional errors.
      const failures =
        countEventsSinceLast(events, TASK_EVENTS.modelFailed, TASK_EVENTS.modelTurn) + 1;
      await this.taskRepository.addEvent(task.id, TASK_EVENTS.modelFailed, SYSTEM_ACTOR, {
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
    } finally {
      await release();
    }
  }

  // Rechecks human controls and the lease before each tool. An already issued action can
  // finish, but the rest of its batch must not start after control changes.
  private async runToolCalls(
    task: Task,
    agent: Agent,
    calls: ModelToolCall[],
    contextEventId: number
  ): Promise<boolean | number> {
    let leaseHeld = true;
    const heartbeat = setInterval(() => {
      this.taskRepository
        .renewLease(task.id, this.options.workerId, this.options.leaseMs)
        .then((held) => (leaseHeld = leaseHeld && held))
        .catch(() => (leaseHeld = false));
    }, this.options.leaseMs / 3);
    try {
      return await this.runToolBatch(task, agent, calls, contextEventId, () => leaseHeld);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async runToolBatch(
    task: Task,
    agent: Agent,
    calls: ModelToolCall[],
    contextEventId: number,
    holdsLease: () => boolean
  ): Promise<boolean | number> {
    const results: ModelToolResult[] = [];
    let stopped = false;
    let skippedReason = 'an earlier tool call in this turn already ended your turn.';
    for (const call of calls) {
      if (this.shutdownController.signal.aborted) return true;
      if (stopped) {
        results.push({
          callId: call.id,
          content: `Skipped: ${skippedReason}`,
          isError: true
        });
        continue;
      }
      try {
        const release = await this.agentRepository.acquireExecution(agent.id);
        if (!release) return true;
        let outcome;
        try {
          // Store only the fields used by the status line; never duplicate tool secrets here.
          const input =
            call.input && typeof call.input === 'object'
              ? (call.input as Record<string, unknown>)
              : {};
          const detailInput = ['read_file', 'write_file'].includes(call.name)
            ? { path: input.path }
            : call.name === 'save_output'
              ? { title: input.title }
              : {};
          await this.taskRepository.addEvent(
            task.id,
            TASK_EVENTS.toolStarted,
            toAgentActor(agent),
            {
              name: call.name,
              input: detailInput
            }
          );
          if (await this.hasNewTaskMessage(task.id, contextEventId)) {
            stopped = true;
            skippedReason = 'a new message arrived; read the update before taking further actions.';
            results.push({ callId: call.id, content: `Skipped: ${skippedReason}`, isError: true });
            continue;
          }
          const renewed =
            holdsLease() &&
            (await this.taskRepository.renewLease(
              task.id,
              this.options.workerId,
              this.options.leaseMs
            ));
          // Pause and cancellation release ownership, so inspect controls even if renewal
          // failed. This lets us save skipped results for stopped work.
          const current = await this.taskRepository.getById(task.id);
          if (
            !current ||
            current.state !== 'working' ||
            current.pausedAt ||
            current.agentVersionId !== task.agentVersionId
          ) {
            stopped = true;
            skippedReason = 'the task stopped working, was paused, or changed configuration.';
            results.push({ callId: call.id, content: `Skipped: ${skippedReason}`, isError: true });
            continue;
          }
          if (!renewed || !holdsLease()) return true;
          outcome = await this.runToolCall(task, agent, call);
        } finally {
          await release();
        }
        const content = typeof outcome === 'string' ? outcome : outcome.content;
        results.push({ callId: call.id, content, isError: false });
        stopped = STOPPING_TOOLS.has(call.name) || (typeof outcome !== 'string' && outcome.stop);
      } catch (error) {
        if (error instanceof ModelCallStoppedError) throw error;
        if (error instanceof ModelClientError) {
          return this.handleCompletionFailure(task, call.id, error);
        }
        if (error instanceof AppError && error.name === 'connectionCallOutcomeUnknown') {
          // A model could retry an error under a fresh call ID. Block before saving batch
          // results. If blocking fails, leave the calls pending for safe recovery instead.
          await this.block(task, error.message);
          stopped = true;
          skippedReason = 'an HTTP call needs human reconciliation before work can continue.';
        }
        results.push({ callId: call.id, content: (error as Error).message, isError: true });
      }
    }
    // Pause/cancel and stopping tools release the lease. The repository checks ownership
    // atomically, allowing results for stopped work but never another worker's batch.
    if (!holdsLease() && !stopped) return true;
    const recorded = await this.taskRepository.recordToolResults(task.id, this.options.workerId, {
      results
    });
    return stopped || !recorded;
  }

  private async runToolCall(task: Task, agent: Agent, call: ModelToolCall): Promise<ToolOutcome> {
    const input = (call.input ?? {}) as ToolInput;
    if (isMcpToolName(call.name)) {
      return this.runMcpTool(task, agent, call);
    }
    switch (call.name) {
      case AGENT_TOOLS.sendMessage:
        return this.runSendMessageTool(task, agent, call.id, input);
      case AGENT_TOOLS.ask:
        return this.runAskTool(task, agent, call.id, input);
      case AGENT_TOOLS.saveOutput:
        return this.runSaveOutputTool(task, agent, call.id, input);
      case AGENT_TOOLS.completeTask:
        return this.runCompleteTaskTool(task, agent, call.id, input);
      case AGENT_TOOLS.reportBlocked:
        return this.runReportBlockedTool(task, agent, call.id, input);
      case AGENT_TOOLS.suggestParticipant:
        return this.runSuggestParticipantTool(task, agent, call.id, input);
      case AGENT_TOOLS.saveNote:
        return this.runSaveNoteTool(task, agent, call.id, input);
      case AGENT_TOOLS.httpRequest:
        return this.runHttpRequestTool(task, agent, call.id, input);
      case AGENT_TOOLS.findCapabilities:
        return this.runFindCapabilitiesTool(task, agent, input);
      case AGENT_TOOLS.requestAccess:
        return this.runRequestAccessTool(task, agent, call.id, input);
      // Files live in the task's own folder, so these need no grant. Writing the same file
      // again after a crash gives the same result.
      case AGENT_TOOLS.listFiles:
        return this.runListFilesTool(task, input);
      case AGENT_TOOLS.readFile:
        return this.runReadFileTool(task, input);
      case AGENT_TOOLS.writeFile:
        return this.runWriteFileTool(task, input);
      default:
        throw new AppError('validationError', `Unknown tool ${call.name}.`);
    }
  }

  private async runSendMessageTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const { message } = await this.postAsAgent(task, agent, callId, {
      body: readRequiredString(input, 'body'),
      to: readStringList(input, 'to'),
      inReplyToMessageId: readOptionalString(input, 'reply_to_message_id')
    });
    return `Posted message ${message.id}.`;
  }

  private async runAskTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const askedName = readRequiredString(input, 'to');
    const { message: question } = await this.postAsAgent(task, agent, callId, {
      body: readRequiredString(input, 'question'),
      to: [askedName],
      inReplyToMessageId: null
    });
    // After a crash this call can run again. If it already made a wait for this question,
    // even one that has since been answered, don't make another.
    const waits = await this.taskRepository.listWaits(task.id, { openOnly: false });
    const currentTask = await this.lifecycle.requireTask(task.id);
    if (currentTask.state === 'working' && !waits.some((wait) => wait.targetId === question.id)) {
      await this.lifecycle.waitFor(task.id, toAgentActor(agent), [
        { kind: 'reply', targetId: question.id, description: `Reply from ${askedName}` }
      ]);
    }
    return `Asked ${askedName} (message ${question.id}). Your work is paused until they reply.`;
  }

  private async runSaveOutputTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    // A file from the workspace is copied into the output, so it stays inspectable even if
    // the workspace changes later.
    const path = readOptionalString(input, 'path');
    if (path) {
      const file = await this.workspaceClient.read(task.id, path);
      const outputId = await this.saveOutputOnce(task, toAgentActor(agent), callId, {
        title: readOptionalString(input, 'title') ?? path,
        content: formatFileForAgent(file),
        kind: 'file',
        uri: `workspace:${path}`
      });
      return `Saved ${path} as output ${outputId}.`;
    }
    const outputId = await this.saveOutputOnce(task, toAgentActor(agent), callId, {
      title: readRequiredString(input, 'title'),
      content: readRequiredString(input, 'content'),
      kind: (readOptionalString(input, 'kind') ?? 'text') as 'text' | 'link' | 'data' | 'log',
      uri: readOptionalString(input, 'uri')
    });
    return `Saved output ${outputId}.`;
  }

  private async runCompleteTaskTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const agentActor = toAgentActor(agent);
    const result = readRequiredString(input, 'result');
    const criteriaCheck = {
      met: input.criteria_met === true,
      summary: readRequiredString(input, 'criteria_check')
    };
    if (!criteriaCheck.met) {
      throw new AppError(
        'taskCompletionRejected',
        `You said the criteria are not met: ${criteriaCheck.summary}. Keep working, ask for help, or report blocked.`
      );
    }
    const verdict = await this.checkCompletion(task, callId, result);
    if (verdict && !verdict.met) {
      if (verdict.failures >= MAX_COMPLETION_REJECTIONS) {
        const reason = `The result failed the completion check ${verdict.failures} times. Last gaps: ${verdict.summary}`;
        await this.lifecycle.blockTask(task.id, SYSTEM_ACTOR, reason);
        await this.answerRequester(
          task,
          agent,
          `${callId}:answer`,
          `I couldn't get my result to meet the criteria, so a person needs to look. ${verdict.summary}`
        );
        return { content: `Task blocked: ${reason}`, stop: true };
      }
      throw new AppError(
        'taskCompletionRejected',
        `An independent check says the result doesn't meet the criteria yet: ${verdict.summary} Fix this, then call complete_task again.`
      );
    }
    if (verdict) {
      criteriaCheck.summary = `${criteriaCheck.summary}\nIndependent check: ${verdict.summary}`;
    }
    await this.saveOutputOnce(task, agentActor, callId, {
      title: 'Result',
      content: result,
      kind: 'text',
      uri: null
    });
    const updatedTask = await this.lifecycle.completeTask(task.id, agentActor, criteriaCheck);
    if (updatedTask.state !== 'completed') {
      // Unreviewed results stay off the conversation. The result is posted once approved.
      await this.answerRequester(task, agent, `${callId}:review`, 'My result is ready for review.');
      return 'Result submitted. A person will review it before the task completes.';
    }
    await this.answerRequester(task, agent, `${callId}:answer`, result);
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.resultPosted, agentActor, {});
    return 'Task completed. Your result was posted.';
  }

  private async runReportBlockedTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const reason = readRequiredString(input, 'reason');
    await this.lifecycle.blockTask(task.id, toAgentActor(agent), reason);
    await this.answerRequester(task, agent, `${callId}:answer`, `I can't proceed: ${reason}`);
    return 'Task blocked. A person will look at it.';
  }

  private async runSuggestParticipantTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    if (!task.conversationId) {
      throw new AppError('validationError', 'This task has no conversation to suggest for.');
    }
    const name = readRequiredString(input, 'name');
    const participants = await this.loadParticipants(task.conversationId);
    const suggested = await this.agentRepository.getByName(name.trim());
    const isAlreadyMember =
      suggested !== null &&
      participants.some(
        (participant) => participant.type === 'agent' && participant.id === suggested.id
      );
    if (suggested && isAlreadyMember) {
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
    const people = participants
      .filter((participant) => participant.type === 'human')
      .map((participant): ParticipantRef => ({ type: 'human', id: participant.id }));
    const { message, created } = await this.postAsAgent(
      task,
      agent,
      callId,
      {
        body: `Suggestion: add ${suggested.name} (${oneLine(suggested.purpose)}) to this conversation. ${readRequiredString(input, 'reason')}`,
        to: [],
        mentionRefs: people,
        inReplyToMessageId: null
      },
      participants
    );
    if (created) {
      await this.taskRepository.addEvent(
        task.id,
        TASK_EVENTS.participantSuggested,
        toAgentActor(agent),
        { agentId: suggested.id, messageId: message.id }
      );
      this.runnerLogger.onParticipantSuggested(task.id, suggested.id);
    }
    return `Suggested ${suggested.name} to the people here. A person decides whether to add them.`;
  }

  private async runSaveNoteTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const agentActor = toAgentActor(agent);
    const text = readRequiredString(input, 'note');
    if (text.length > MAX_NOTE_CHARS) {
      throw new AppError('validationError', 'Keep notes under 2,000 characters.');
    }
    // Saved for this conversation only, so it can't carry its details into another. The
    // tool call is the note's key, so a replay after a crash finds the first save.
    const note = await this.noteRepository.create({
      clientKey: `tool:${task.id}:${callId}`,
      agentId: agent.id,
      body: text,
      sourceTaskId: task.id,
      sourceConversationId: task.conversationId,
      scope: task.conversationId ? 'conversation' : 'agent',
      createdBy: agentActor
    });
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.noteSaved, agentActor, {
      callId,
      noteId: note.id
    });
    return 'Note saved.';
  }

  private async runListFilesTool(task: Task, input: ToolInput): Promise<ToolOutcome> {
    const { entries, truncated } = await this.workspaceClient.list(
      task.id,
      readOptionalString(input, 'folder') ?? ''
    );
    if (entries.length === 0) {
      return 'Your workspace has no files here yet.';
    }
    const lines = entries.map((entry) =>
      entry.type === 'folder' ? `${entry.path}/` : `${entry.path} (${entry.bytes} bytes)`
    );
    return `${lines.join('\n')}${truncated ? '\n(More files not shown.)' : ''}`;
  }

  private async runReadFileTool(task: Task, input: ToolInput): Promise<ToolOutcome> {
    const file = await this.workspaceClient.read(task.id, readRequiredString(input, 'path'));
    return formatFileForAgent(file);
  }

  private async runWriteFileTool(task: Task, input: ToolInput): Promise<ToolOutcome> {
    const path = readRequiredString(input, 'path');
    if (typeof input.content !== 'string') {
      throw new AppError('validationError', 'content must be a string.');
    }
    const { bytes } = await this.workspaceClient.write(task.id, path, input.content);
    return `Wrote ${path} (${bytes} bytes).`;
  }

  // Every call is checked now, not when the task started: the connection must be chosen in the
  // task's explicit configuration, still granted, enabled, and allow
  // the method and path. Methods the connection marks for approval wait for a person.
  private async runHttpRequestTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const name = readRequiredString(input, 'connection');
    const method = readRequiredString(input, 'method').toUpperCase() as HttpMethod;
    const path = readRequiredString(input, 'path');
    if (!HTTP_METHODS.includes(method)) {
      throw new AppError('validationError', `Unknown method ${method}.`);
    }
    const body = typeof input.body === 'string' ? input.body : null;
    const connection = await this.checkHttpCall(task, agent, { name, method, path, callId });
    const clientKey = `tool:${task.id}:${callId}`;
    const existing = await this.approvalRepository.getByClientKey(clientKey);
    // A saved human decision belongs to this exact call, regardless of later policy edits.
    if (existing) {
      const request = existing.request;
      if (
        isAccessRequest(request) ||
        request.kind === 'mcp' ||
        request.connectionId !== connection.id ||
        request.method !== method ||
        request.path !== path ||
        request.body !== body
      ) {
        throw new AppError(
          'toolAccessDenied',
          'This HTTP call does not match its saved approval. Request a new approval for a different action.'
        );
      }
      if (existing.status === 'rejected') {
        throw new AppError(
          'toolAccessDenied',
          `A person rejected this call: ${existing.reason ?? 'No reason given.'}`
        );
      }
      if (existing.executedAt) {
        const result = existing.result;
        if (!result || (result.status === null && !result.error && !result.isError)) {
          throw new AppError('connectionCallOutcomeUnknown');
        }
        if (result.error || result.isError) {
          throw new AppError('validationError', result.error ?? result.body);
        }
        return `HTTP ${result.status}${result.truncated ? ' (cut off at 20,000 characters)' : ''}\n${result.body}`;
      }
    }

    // A previously sent unattended call must recover its own result, even if the current
    // policy now requires approval. Creating a fresh approval could repeat the same action.
    const previous = await this.taskRepository.getHttpCall(task.id, callId);
    const needsNewApproval = !previous && connection.approvalMethods.includes(method);
    const legacyCall =
      needsNewApproval &&
      (await this.loadEvents(task.id)).some(
        (event) => event.type === TASK_EVENTS.connectionCalled && event.data.callId === callId
      );
    if (existing || (needsNewApproval && !legacyCall)) {
      const approval = await this.requestApproval(task, agent, {
        clientKey,
        existing,
        request: {
          connectionId: connection.id,
          connectionName: connection.name,
          method,
          path,
          body
        },
        description: `A person approves ${method} ${path} on ${connection.name}`
      });
      return {
        content: `${method} ${path} on ${connection.name} needs a person's approval (approval ${approval.id}). Your work is paused until they decide; you'll get the result or their reason.`,
        stop: true
      };
    }

    const response = await this.performHttpCall(task, agent.id, connection, {
      method,
      path,
      body,
      callId
    });
    return `HTTP ${response.status}${response.truncated ? ' (cut off at 20,000 characters)' : ''}\n${response.body}`;
  }

  // Stable tool names include the connection ID and a hash of the server tool name.
  private async discoverMcpTools(
    task: Task,
    connections: Connection[]
  ): Promise<ModelToolDefinition[]> {
    const tools: ModelToolDefinition[] = [];
    for (const connection of connections.filter((candidate) => candidate.kind === 'mcp')) {
      let authorization: string | undefined;
      try {
        if (!this.mcpClient) throw new Error('The MCP client is unavailable.');
        const headers = await this.loadConnectionHeaders(connection);
        authorization = headers.Authorization;
        const discovered = await this.mcpClient.listTools({
          url: connection.baseUrl,
          headers: { ...headers, 'X-Endeavor-Task-Id': task.id }
        });
        for (const tool of discovered) {
          if (!(connection.allowedTools ?? []).includes(tool.name)) continue;
          tools.push({
            name: buildMcpToolName(connection.id, tool.name),
            description: `${connection.name}: ${tool.description}`,
            inputSchema: tool.inputSchema
          });
        }
      } catch (error) {
        if (error instanceof McpAuthenticationError)
          await this.requireReconnect(connection.id, authorization);
        await this.taskRepository.addEvent(
          task.id,
          TASK_EVENTS.connectionDiscoveryFailed,
          SYSTEM_ACTOR,
          {
            connectionId: connection.id,
            reason:
              'MCP discovery failed. Check sign-in in Catalogs, the endpoint, and supported schemas.'
          }
        );
      }
    }
    return tools;
  }

  private async runMcpTool(task: Task, agent: Agent, call: ModelToolCall): Promise<ToolOutcome> {
    const connectionId = parseMcpConnectionId(call.name);
    if (!connectionId) {
      throw new AppError('toolAccessDenied', 'Unknown MCP tool.');
    }
    const storedConnection = await this.catalogRepository.getConnection(connectionId);
    const tool = (storedConnection?.allowedTools ?? []).find(
      (name) => buildMcpToolName(connectionId, name) === call.name
    );
    if (!tool) {
      const reason = 'Unknown or disallowed MCP tool.';
      await this.taskRepository.addEvent(
        task.id,
        TASK_EVENTS.connectionDenied,
        toAgentActor(agent),
        {
          callId: call.id,
          connectionId,
          tool: call.name,
          reason
        }
      );
      this.runnerLogger.onConnectionDenied(task.id, connectionId, 'MCP', call.name, reason);
      throw new AppError('toolAccessDenied', reason);
    }
    const input = call.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AppError('validationError', 'MCP tool arguments must be an object.');
    }
    const connection = await this.checkMcpCall(task, agent, { connectionId, tool }, call.id);
    const request: McpConnectionCallRequest = {
      kind: 'mcp',
      connectionId,
      connectionName: connection.name,
      tool,
      arguments: input as Record<string, unknown>,
      baseUrl: connection.baseUrl,
      authHeader: connection.authHeader
    };
    const clientKey = `tool:${task.id}:${call.id}`;
    const existing = await this.approvalRepository.getByClientKey(clientKey);
    // Once requested, an approval survives a crash even if the policy later becomes looser.
    if (existing?.status === 'rejected') {
      throw new AppError(
        'toolAccessDenied',
        `A person rejected this call: ${existing.reason ?? 'No reason given.'}`
      );
    }
    if (existing?.result && existing.executedAt) {
      if (existing.result.error || existing.result.isError) {
        throw new AppError('validationError', existing.result.error ?? existing.result.body);
      }
      return existing.result.body;
    }
    const needsApproval = (connection.approvalTools ?? connection.allowedTools ?? []).includes(
      tool
    );
    if (existing || needsApproval) {
      const approval = await this.requestApproval(task, agent, {
        clientKey,
        request,
        existing,
        description: `A person approves ${tool} on ${connection.name}`
      });
      return {
        content: `${tool} on ${connection.name} needs a person's approval (approval ${approval.id}). Your work is paused until they decide.`,
        stop: true
      };
    }
    const result = await this.performMcpCall(task, agent.id, connection, request, call.id);
    if (result.isError) {
      throw new AppError('validationError', `MCP tool failed: ${result.body}`);
    }
    return `${result.truncated ? '(cut off at 20,000 characters)\n' : ''}${result.body}`;
  }

  // Creates the approval (or reuses one from before a crash) and makes the task wait for it.
  // The task is checked first, so a paused or moved-on task never leaves an approval with no
  // wait. A replay after a crash already has its wait, so it skips that check.
  private async requestApproval(
    task: Task,
    agent: Agent,
    input: {
      clientKey: string;
      request: ApprovalRequest;
      description: string;
      existing?: Approval | null;
    }
  ): Promise<Approval> {
    const taskBefore = await this.lifecycle.requireTask(task.id);
    const waitsBefore = await this.taskRepository.listWaits(task.id, { openOnly: false });
    const isReplay = waitsBefore.some((wait) => wait.kind === 'approval');
    if (!isReplay && (taskBefore.state !== 'working' || taskBefore.pausedAt)) {
      throw new AppError('taskStateConflict', 'The task is paused or no longer working.');
    }
    const approval =
      input.existing ??
      (
        await this.approvalRepository.create({
          clientKey: input.clientKey,
          taskId: task.id,
          agentId: agent.id,
          kind: isAccessRequest(input.request) ? 'capability_access' : 'connection_call',
          request: input.request
        })
      ).approval;
    const currentTask = await this.lifecycle.requireTask(task.id);
    const waits = await this.taskRepository.listWaits(task.id, { openOnly: false });
    if (currentTask.state === 'working') {
      const openWait = waits.find(
        (wait) => wait.kind === 'approval' && wait.targetId === approval.id && !wait.resolvedAt
      );
      if (openWait) {
        // A crash after saving the wait can leave the task working. Reuse that wait and
        // finish its state transition instead of letting the next claim bypass approval.
        await this.lifecycle.transition(currentTask, 'waiting', toAgentActor(agent), {
          reason: openWait.description
        });
      } else {
        await this.lifecycle.waitFor(task.id, toAgentActor(agent), [
          { kind: 'approval', targetId: approval.id, description: input.description }
        ]);
      }
    }
    this.runnerLogger.onApprovalRequested(task.id, approval.id);
    return approval;
  }

  private async checkMcpCall(
    task: Task,
    agent: Agent,
    request: { connectionId: string; tool: string; baseUrl?: string; authHeader?: string },
    callId: string
  ): Promise<Connection> {
    const version = await this.agentRepository.getVersion(task.agentVersionId);
    const usable = version
      ? (await this.loadUsableCatalog(agent.id, version, task.id)).connections
      : [];
    const connection = usable.find(
      (candidate) => candidate.id === request.connectionId && candidate.kind === 'mcp'
    );
    const reason = !connection
      ? 'The MCP connection is not selected, granted, or enabled.'
      : !(connection.allowedTools ?? []).includes(request.tool)
        ? 'This MCP tool is not allowed.'
        : request.baseUrl &&
            (request.baseUrl !== connection.baseUrl || request.authHeader !== connection.authHeader)
          ? 'The MCP endpoint changed after approval was requested. Request a new approval.'
          : null;
    if (reason || !connection) {
      await this.taskRepository.addEvent(
        task.id,
        TASK_EVENTS.connectionDenied,
        toAgentActor(agent),
        {
          callId,
          connectionId: request.connectionId,
          tool: request.tool,
          reason
        }
      );
      this.runnerLogger.onConnectionDenied(
        task.id,
        request.connectionId,
        'MCP',
        request.tool,
        reason ?? 'Denied'
      );
      throw new AppError('toolAccessDenied', reason ?? 'MCP access denied.');
    }
    return connection;
  }

  private async performMcpCall(
    task: Task,
    agentId: string,
    connection: Connection,
    request: McpConnectionCallRequest,
    callId: string
  ): Promise<ApprovalResult> {
    if (!this.mcpClient) throw new AppError('validationError', 'The MCP client is unavailable.');
    const events = await this.loadEvents(task.id);
    const previous = events.find(
      (event) => event.type === TASK_EVENTS.mcpCallResult && event.data.callId === callId
    );
    if (previous) return previous.data.result as unknown as ApprovalResult;
    if (
      events.some(
        (event) => event.type === TASK_EVENTS.mcpCallStarted && event.data.callId === callId
      )
    ) {
      throw new AppError(
        'validationError',
        'The previous MCP attempt has an unknown outcome. Check the external service before requesting a new call. It will not be retried automatically.'
      );
    }
    const headers = await this.loadConnectionHeaders(connection);
    // Claim before contacting the service. A crash must not repeat an unattended action.
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.mcpCallStarted, SYSTEM_ACTOR, {
      callId,
      connectionId: connection.id,
      tool: request.tool
    });
    let result;
    try {
      result = await this.mcpClient.callTool(
        { url: connection.baseUrl, headers: { ...headers, 'X-Endeavor-Task-Id': task.id } },
        request.tool,
        request.arguments
      );
    } catch (error) {
      if (error instanceof McpAuthenticationError) {
        await this.requireReconnect(connection.id, headers.Authorization);
        throw new AppError('connectionSignInRequired');
      }
      // Transport errors can contain credentials or full request headers. Keep them private.
      throw new AppError(
        'validationError',
        'The MCP call failed. Check the endpoint, credentials, arguments, and server availability.'
      );
    }
    await this.taskRepository.addEvent(
      task.id,
      TASK_EVENTS.connectionCalled,
      { type: 'agent', id: agentId },
      {
        callId,
        connectionId: connection.id,
        tool: request.tool,
        arguments: request.arguments,
        isError: result.isError,
        truncated: result.truncated
      }
    );
    const recorded: ApprovalResult = { ...result, status: null, error: null };
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.mcpCallResult, SYSTEM_ACTOR, {
      callId,
      result: recorded
    });
    return recorded;
  }

  // Returns the connection if the agent may make this call right now, or records the refusal
  // and throws.
  private async checkHttpCall(
    task: Task,
    agent: Agent,
    call: { name: string; connectionId?: string; method: HttpMethod; path: string; callId: string }
  ): Promise<Connection> {
    const version = await this.agentRepository.getVersion(task.agentVersionId);
    const usable = version
      ? (await this.loadUsableCatalog(agent.id, version, task.id)).connections
      : [];
    // An approved call is matched by ID, so it can only go to the connection a person approved.
    const connection = call.connectionId
      ? usable.find((candidate) => candidate.id === call.connectionId)
      : usable.find((candidate) => candidate.name.toLowerCase() === call.name.trim().toLowerCase());
    const denied = connection
      ? connectionCallDenied(connection, call.method, call.path)
      : `You can't use a connection named "${call.name}". Usable: ${usable.map((candidate) => candidate.name).join(', ') || 'none'}.`;
    if (denied || !connection) {
      // Refused calls are recorded too, so admins can see attempts outside the rules.
      await this.taskRepository.addEvent(
        task.id,
        TASK_EVENTS.connectionDenied,
        toAgentActor(agent),
        {
          callId: call.callId,
          connection: call.name,
          method: call.method,
          path: call.path,
          reason: denied
        }
      );
      this.runnerLogger.onConnectionDenied(
        task.id,
        call.name,
        call.method,
        call.path,
        denied ?? ''
      );
      throw new AppError('toolAccessDenied', denied ?? `You can't use "${call.name}".`);
    }
    return connection;
  }

  private async performHttpCall(
    task: Task,
    agentId: string,
    connection: Connection,
    call: { method: HttpMethod; path: string; body: string | null; callId: string }
  ): Promise<{ status: number; body: string; truncated: boolean }> {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          connection.id,
          connection.baseUrl,
          connection.authMethod,
          connection.authHeader,
          call.method,
          call.path,
          call.body
        ])
      )
      .digest('hex');
    const unknown = () =>
      new AppError(
        'connectionCallOutcomeUnknown',
        `HTTP ${call.method} ${call.path} on ${connection.name} (call ${call.callId}) has an unknown outcome. It will not be retried automatically. A person must check the external service, then resume with instructions to accept the result or explicitly request a new attempt.`
      );
    const replay = (stored: StoredHttpCall) => {
      if (stored.requestHash !== requestHash || !stored.response) throw unknown();
      return stored.response;
    };
    const stored = await this.taskRepository.getHttpCall(task.id, call.callId);
    if (stored) return replay(stored);
    // Older builds recorded successful requests without a recoverable response. Treat that
    // evidence conservatively instead of repeating a legacy action during the upgrade.
    const events = await this.loadEvents(task.id);
    if (
      events.some(
        (event) => event.type === TASK_EVENTS.connectionCalled && event.data.callId === call.callId
      )
    ) {
      throw unknown();
    }
    const headers = await this.loadConnectionHeaders(connection);
    if (!(await this.taskRepository.claimHttpCall(task.id, call.callId, requestHash))) {
      const winner = await this.taskRepository.getHttpCall(task.id, call.callId);
      if (!winner) throw unknown();
      return replay(winner);
    }
    let response;
    try {
      response = await this.connectionClient.request({
        baseUrl: connection.baseUrl,
        method: call.method,
        path: call.path,
        headers,
        body: call.body
      });
      // Persist before audit/batch events. Losing either later must not resend the request.
      if (
        !(await this.taskRepository.saveHttpCallResponse(
          task.id,
          call.callId,
          requestHash,
          response
        ))
      ) {
        throw unknown();
      }
    } catch {
      // A timeout, partial response, or lost database acknowledgement may follow a successful
      // remote write. Keep the claim and never expose raw transport errors or credentials.
      throw unknown();
    }
    await this.taskRepository
      .addEvent(
        task.id,
        TASK_EVENTS.connectionCalled,
        { type: 'agent', id: agentId },
        {
          callId: call.callId,
          connectionId: connection.id,
          method: call.method,
          path: call.path,
          status: response.status
        }
      )
      .catch(() => {
        // The durable response is authoritative. An audit failure must not look like a failed
        // remote action to the model and provoke a duplicate under a fresh call ID.
        this.runnerLogger.onHttpCallAuditFailed(task.id, call.callId);
      });
    return response;
  }

  private async oauthConnectionHeaders(connection: Connection): Promise<Record<string, string>> {
    if (connection.kind === 'mcp' && this.oauthRepository && this.oauthClient) {
      const result = await this.oauthRepository.withLock<Record<string, string> | null | false>(
        connection.id,
        async (session) => {
          if (!session)
            return { session, result: connection.authMethod === 'oauth' ? (false as const) : null };
          if (session.status !== 'connected') return { session, result: false as const };
          try {
            if (session.resource !== connection.baseUrl) throw new Error('Resource changed');
            const headers = await this.oauthClient!.headers(session);
            return { session, result: headers };
          } catch {
            session.status = 'reconnect_required';
            session.data = {};
            delete session.expiresAt;
            return { session, result: false as const };
          }
        }
      );
      if (result === false) throw new AppError('connectionSignInRequired');
      if (result) return result;
    }
    if (connection.authMethod === 'oauth') throw new AppError('connectionSignInRequired');
    const credential = await this.catalogRepository.getConnectionCredential(connection.id);
    if (connection.authMethod === 'header' && !credential) {
      throw new AppError(
        'validationError',
        'Add an API key or token in this connection’s configuration before continuing.'
      );
    }
    return credential ? { [connection.authHeader]: credential } : {};
  }

  private async requireReconnect(connectionId: string, failedAuthorization?: string) {
    if (this.oauthRepository)
      await this.oauthRepository.withLock(connectionId, async (session) => ({
        session:
          session &&
          failedAuthorization ===
            `Bearer ${(session.data.tokens as { access_token?: string } | undefined)?.access_token}`
            ? { ...session, status: 'reconnect_required', data: {}, expiresAt: undefined }
            : session,
        result: undefined
      }));
  }

  // The connection's stored credential, sent in its auth header. Never logged or recorded.
  private async loadConnectionHeaders(connection: Connection): Promise<Record<string, string>> {
    return this.oauthConnectionHeaders(connection);
  }

  // Makes approved calls, after checking access again (it may have been revoked while the
  // approval waited), records the result for the agent, and wakes the task. Calls run in
  // parallel, so one slow outside system doesn't hold up the others.
  private async executeApprovedCalls(): Promise<void> {
    const approved = await this.approvalRepository.listApprovedNotExecuted(
      this.options.concurrency
    );
    await Promise.all(approved.map((approval) => this.executeApprovedCall(approval)));
    // A crash after claiming a call but before waking its task would leave the task waiting.
    for (const approval of await this.approvalRepository.listExecutedAwaitingWake(20)) {
      await this.finishApproval(approval, approval.result ?? buildUnrecordedResult());
    }
  }

  private async executeApprovedCall(approval: Approval): Promise<void> {
    const release = await this.agentRepository.acquireExecution(approval.agentId);
    if (!release) return;
    try {
      if (isAccessRequest(approval.request)) {
        await this.applyApprovedAccess(approval, approval.request);
      } else {
        await this.executeApprovedCallWhileHeld(approval, approval.request);
      }
    } finally {
      await release();
    }
  }

  private async executeApprovedCallWhileHeld(
    approval: Approval,
    request: ConnectionCallRequest
  ): Promise<void> {
    const task = await this.taskRepository.getById(approval.taskId);
    const agent = await this.agentRepository.getById(approval.agentId);
    if (!task || !agent) {
      return;
    }
    // Wait while the task is paused; a person may still cancel it.
    if (task.pausedAt && !isFinishedState(task.state)) {
      return;
    }
    // Claim it first, so a crash during the call can never make it twice.
    if (!(await this.approvalRepository.markExecuted(approval.id, buildUnrecordedResult()))) {
      return;
    }

    let result: ApprovalResult;
    if (task.state !== 'waiting') {
      // The task was cancelled, finished, or blocked after the request: never act for it.
      result = {
        status: null,
        body: '',
        truncated: false,
        error: `The task is ${task.state}, so the call was not made.`
      };
    } else {
      const callId = `approval:${approval.id}`;
      try {
        if (request.kind === 'mcp') {
          const connection = await this.checkMcpCall(task, agent, request, callId);
          result = {
            ...(await this.performMcpCall(task, agent.id, connection, request, callId)),
            error: null
          };
        } else {
          const connection = await this.checkHttpCall(task, agent, {
            name: request.connectionName,
            connectionId: request.connectionId,
            method: request.method,
            path: request.path,
            callId
          });
          const response = await this.performHttpCall(task, agent.id, connection, {
            method: request.method,
            path: request.path,
            body: request.body,
            callId
          });
          result = { ...response, error: null };
        }
      } catch (error) {
        result = {
          status: null,
          body: '',
          truncated: false,
          error: (error as Error).message
        };
      }
    }
    await this.approvalRepository.saveResult(approval.id, result);
    await this.finishApproval(approval, result);
  }

  private async finishApproval(approval: Approval, result: ApprovalResult): Promise<void> {
    const waits = await this.taskRepository.findOpenWaits('approval', approval.id);
    if (waits.length === 0) {
      return;
    }
    await this.taskRepository.addEvent(
      approval.taskId,
      TASK_EVENTS.approvalExecuted,
      SYSTEM_ACTOR,
      {
        approvalId: approval.id,
        request: approval.request,
        result
      }
    );
    for (const wait of waits) {
      await this.lifecycle
        .resolveWait(wait.id, SYSTEM_ACTOR, { approvalId: approval.id, approved: true })
        .catch(ignoreWaitAlreadyResolved);
    }
  }

  // What the agent may use right now: skills chosen in the version that are still granted and
  // enabled, and explicitly selected connections that are still granted and enabled. Access a
  // person added to this task counts too: task-only access lasts while the task is open, and
  // ongoing access also needs the agent's live grant. Added connections are limited to the
  // scope the person approved. Grants are read fresh each time, so a revoke applies at once.
  private async loadUsableCatalog(
    agentId: string,
    version: AgentVersion,
    taskId: string
  ): Promise<{ skills: { skill: Skill; version: SkillVersion }[]; connections: Connection[] }> {
    const [grants, capabilities] = await Promise.all([
      this.catalogRepository.listGrants(agentId, { activeOnly: true }),
      this.taskCapabilityRepository.listForTask(taskId, { activeOnly: true })
    ]);
    const granted = (type: GrantTargetType) =>
      new Set(grants.filter((grant) => grant.targetType === type).map((grant) => grant.targetId));
    const grantedSkills = granted('skill');
    const grantedConnections = granted('connection');
    const added = capabilities.filter(
      (capability) =>
        capability.duration === 'task' || granted(capability.targetType).has(capability.targetId)
    );
    const addedSkillVersionIds = new Set(
      added.flatMap((capability) => capability.skillVersionId ?? [])
    );

    const skillVersions = await this.catalogRepository.getSkillVersions([
      ...version.skillVersionIds,
      ...addedSkillVersionIds
    ]);
    const skillRows = await this.catalogRepository.getSkills(
      skillVersions.map((skillVersion) => skillVersion.skillId)
    );
    const skills: { skill: Skill; version: SkillVersion }[] = [];
    for (const skillVersion of skillVersions) {
      const skill = skillRows.find((row) => row.id === skillVersion.skillId);
      const allowed =
        (version.skillVersionIds.includes(skillVersion.id) &&
          grantedSkills.has(skillVersion.skillId)) ||
        addedSkillVersionIds.has(skillVersion.id);
      if (
        skill &&
        !skill.disabledAt &&
        allowed &&
        !skills.some((entry) => entry.skill.id === skill.id)
      ) {
        skills.push({ skill, version: skillVersion });
      }
    }

    const wanted = new Set(version.connectionIds);
    const addedConnections = added.filter(
      (capability) => capability.targetType === 'connection' && capability.scope
    );
    const rows = await this.catalogRepository.getConnections([
      ...new Set([...wanted, ...addedConnections.map((capability) => capability.targetId)])
    ]);
    const connections: Connection[] = [];
    for (const connection of rows.filter((row) => !row.disabledAt)) {
      if (wanted.has(connection.id) && grantedConnections.has(connection.id)) {
        connections.push(connection);
        continue;
      }
      const capability = addedConnections.find((entry) => entry.targetId === connection.id);
      if (capability?.scope) {
        const limited = limitConnection(connection, capability.scope);
        if (!isEmptyScope(scopeOf(limited))) connections.push(limited);
      }
    }
    return { skills, connections };
  }

  // Access requests

  // Lists what people made discoverable. It shows names, descriptions, and scope only, and
  // grants nothing.
  private async runFindCapabilitiesTool(
    task: Task,
    agent: Agent,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const query = readOptionalString(input, 'query')?.trim().toLowerCase() ?? '';
    const matches = (entry: { name: string; description: string }) =>
      !query || `${entry.name} ${entry.description}`.toLowerCase().includes(query);
    const [discoverable, usable] = await Promise.all([
      this.catalogRepository.listDiscoverable(MAX_DISCOVERABLE),
      this.loadUsableForTask(task, agent)
    ]);
    const skills = discoverable.skills.filter(matches);
    const connections = discoverable.connections.filter(matches);
    if (skills.length === 0 && connections.length === 0) {
      return 'Nothing discoverable matches. Explain what is missing instead.';
    }
    const versions = await this.catalogRepository.getSkillVersions(
      skills.flatMap((skill) => skill.currentVersionId ?? [])
    );
    const status = (usableNow: boolean) =>
      usableNow ? 'You can use it now.' : 'Ask with request_access to use it.';
    const lines = [
      ...skills.map((skill) => {
        const number = versions.find((version) => version.id === skill.currentVersionId)?.version;
        return `- Skill "${skill.name}" (version ${number ?? '?'}): ${oneLine(skill.description)} ${status(usable.skills.some((entry) => entry.skill.id === skill.id))}`;
      }),
      ...connections.map((connection) => {
        const approvals =
          connection.kind === 'mcp'
            ? (connection.approvalTools ?? []).join(', ')
            : connection.approvalMethods.join(', ');
        return `- Connection "${connection.name}" (${connection.kind === 'mcp' ? 'MCP' : 'HTTP'}): ${oneLine(connection.description)} Allows ${describeScope(scopeOf(connection))}.${approvals ? ` Each call to ${approvals} also needs a person's OK.` : ''} ${status(usable.connections.some((entry) => entry.id === connection.id))}`;
      })
    ];
    return lines.join('\n');
  }

  // Asks a person for access to a discoverable skill or connection. The task waits for the
  // decision. A pending request is reused, and a declined one is not asked again.
  private async runRequestAccessTool(
    task: Task,
    agent: Agent,
    callId: string,
    input: ToolInput
  ): Promise<ToolOutcome> {
    const clientKey = `tool:${task.id}:${callId}`;
    const replayed = await this.approvalRepository.getByClientKey(clientKey);
    if (replayed && isAccessRequest(replayed.request)) {
      if (replayed.status === 'pending') {
        await this.requestApproval(task, agent, {
          clientKey,
          request: replayed.request,
          existing: replayed,
          description: describeAccessWait(replayed.request)
        });
      }
      return waitingForAccess(replayed.request, replayed.id);
    }

    const type = readRequiredString(input, 'type');
    if (type !== 'skill' && type !== 'connection') {
      throw new AppError('validationError', 'type must be "skill" or "connection".');
    }
    const name = readRequiredString(input, 'name').trim();
    const reason = readRequiredString(input, 'reason').trim();
    const recommended = readOptionalString(input, 'recommended_duration') ?? null;
    if (recommended !== null && !ACCESS_DURATIONS.includes(recommended as AccessDuration)) {
      throw new AppError('validationError', 'recommended_duration must be "task" or "ongoing".');
    }

    const discoverable = await this.catalogRepository.listDiscoverable(MAX_DISCOVERABLE);
    const entries: { id: string; name: string }[] =
      type === 'skill' ? discoverable.skills : discoverable.connections;
    const entry = entries.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!entry) {
      throw new AppError(
        'toolAccessDenied',
        `There is no discoverable ${type} named "${name}". Use find_capabilities to see what you can ask for.`
      );
    }
    const usable = await this.loadUsableForTask(task, agent);
    if (
      type === 'skill'
        ? usable.skills.some((skill) => skill.skill.id === entry.id)
        : usable.connections.some((connection) => connection.id === entry.id)
    ) {
      return `You can already use ${entry.name}.`;
    }

    const previous = (await this.approvalRepository.listForTask(task.id)).filter(
      (approval) =>
        isAccessRequest(approval.request) &&
        approval.request.targetType === type &&
        approval.request.targetId === entry.id
    );
    const pending = previous.find((approval) => approval.status === 'pending');
    if (pending && isAccessRequest(pending.request)) {
      await this.requestApproval(task, agent, {
        clientKey: `tool:${task.id}:${callId}`,
        request: pending.request,
        existing: pending,
        description: describeAccessWait(pending.request)
      });
      return waitingForAccess(pending.request, pending.id);
    }
    const declined = previous.filter((approval) => approval.status === 'rejected').pop();
    if (declined) {
      throw new AppError(
        'toolAccessDenied',
        `A person already declined access to ${entry.name} for this task${declined.reason ? `: ${declined.reason}` : '.'} Continue without it or explain the limitation. Don't ask again.`
      );
    }

    const request = await this.buildAccessRequest(type, entry.id, {
      reason,
      recommendedDuration: recommended as AccessDuration | null,
      durationReason: readOptionalString(input, 'duration_reason')?.trim() || null
    });
    const approval = await this.requestApproval(task, agent, {
      clientKey,
      request,
      description: describeAccessWait(request)
    });
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.accessRequested, toAgentActor(agent), {
      approvalId: approval.id,
      targetType: request.targetType,
      targetId: request.targetId,
      name: request.name,
      reason: request.reason
    });
    this.runnerLogger.onAccessRequested(task.id, approval.id, request.targetType, request.targetId);
    return waitingForAccess(request, approval.id);
  }

  private async buildAccessRequest(
    type: GrantTargetType,
    targetId: string,
    details: Pick<CapabilityAccessRequest, 'reason' | 'recommendedDuration' | 'durationReason'>
  ): Promise<CapabilityAccessRequest> {
    if (type === 'skill') {
      const skill = await this.catalogRepository.getSkill(targetId);
      const [version] = skill?.currentVersionId
        ? await this.catalogRepository.getSkillVersions([skill.currentVersionId])
        : [];
      if (!skill || !version) {
        throw new AppError('catalogEntryUnavailable', 'That skill has no saved version.');
      }
      return {
        kind: 'access',
        targetType: 'skill',
        targetId,
        name: skill.name,
        description: skill.description,
        skillVersionId: version.id,
        skillVersion: version.version,
        scope: null,
        ...details
      };
    }
    const connection = await this.catalogRepository.getConnection(targetId);
    if (!connection) {
      throw new AppError('connectionNotFound', 'That connection no longer exists.');
    }
    return {
      kind: 'access',
      targetType: 'connection',
      targetId,
      name: connection.name,
      description: connection.description,
      skillVersionId: null,
      skillVersion: null,
      scope: scopeOf(connection),
      ...details
    };
  }

  private async loadUsableForTask(task: Task, agent: Agent) {
    const version = await this.agentRepository.getVersion(task.agentVersionId);
    return version
      ? this.loadUsableCatalog(agent.id, version, task.id)
      : { skills: [], connections: [] };
  }

  // Adds approved access to the waiting task without changing its pinned configuration, and for
  // ongoing access also to the agent's configuration. The task, the capability, and the scope
  // are checked again first. Each step can run again safely after a crash.
  private async applyApprovedAccess(
    approval: Approval,
    request: CapabilityAccessRequest
  ): Promise<void> {
    const task = await this.taskRepository.getById(approval.taskId);
    if (!task || !approval.decidedByHumanId) return;
    if (task.pausedAt && !isFinishedState(task.state)) return;
    const humanId = approval.decidedByHumanId;
    const duration = approval.duration ?? 'task';
    let result: ApprovalResult;
    try {
      if (task.state !== 'waiting') {
        throw new AppError(
          'taskStateConflict',
          `The task is ${task.state}, so access was not added.`
        );
      }
      const scope = await this.checkAccessTarget(request);
      const events = await this.loadEvents(task.id);
      const human: Actor = { type: 'human', id: humanId };
      if (
        duration === 'ongoing' &&
        !events.some(
          (event) =>
            event.type === TASK_EVENTS.accessOngoingAdded && event.data.approvalId === approval.id
        )
      ) {
        await addOngoingAccess(
          { agentRepository: this.agentRepository, catalogRepository: this.catalogRepository },
          {
            agentId: approval.agentId,
            target: {
              type: request.targetType,
              id: request.targetId,
              skillVersionId: request.skillVersionId
            },
            humanId
          }
        );
        await this.taskRepository.addEvent(task.id, TASK_EVENTS.accessOngoingAdded, human, {
          approvalId: approval.id,
          targetType: request.targetType,
          targetId: request.targetId
        });
      }
      const { capability, created } = await this.taskCapabilityRepository.add({
        taskId: task.id,
        approvalId: approval.id,
        targetType: request.targetType,
        targetId: request.targetId,
        skillVersionId: request.skillVersionId,
        scope,
        duration,
        grantedByHumanId: humanId
      });
      if (created) {
        await this.taskRepository.addEvent(task.id, TASK_EVENTS.accessGranted, human, {
          approvalId: approval.id,
          capabilityId: capability.id,
          targetType: request.targetType,
          targetId: request.targetId,
          name: request.name,
          duration,
          skillVersionId: request.skillVersionId,
          scope
        });
      }
      result = {
        status: null,
        body: `Access to ${request.name} was added ${duration === 'task' ? 'for this task' : 'for this task and your future work'}.${scope ? ` It allows ${describeScope(scope)}.` : ''}`,
        truncated: false,
        error: null
      };
    } catch (error) {
      result = { status: null, body: '', truncated: false, error: (error as Error).message };
    }
    if (!(await this.approvalRepository.markExecuted(approval.id, result))) return;
    this.runnerLogger.onAccessGranted(task.id, approval.id, duration, !result.error, result.error);
    await this.finishApproval(approval, result);
  }

  // The capability must still be enabled. A connection's scope is the overlap of what the
  // person saw and what the connection allows now.
  private async checkAccessTarget(request: CapabilityAccessRequest) {
    if (request.targetType === 'skill') {
      const skill = await this.catalogRepository.getSkill(request.targetId);
      if (!skill || skill.disabledAt) {
        throw new AppError(
          'catalogEntryUnavailable',
          `${request.name} is disabled, so access was not added.`
        );
      }
      return null;
    }
    const connection = await this.catalogRepository.getConnection(request.targetId);
    if (!connection || connection.disabledAt || !request.scope) {
      throw new AppError(
        'catalogEntryUnavailable',
        `${request.name} is disabled, so access was not added.`
      );
    }
    const scope = narrowScope(request.scope, scopeOf(connection));
    if (isEmptyScope(scope)) {
      throw new AppError(
        'catalogEntryUnavailable',
        `${request.name} no longer allows anything that was approved, so access was not added.`
      );
    }
    return scope;
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
    const requester = request ? getAuthorRef(request) : null;
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
      participants.some((participant) => participant.type === ref.type && participant.id === ref.id)
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
      repliedToAuthor = getAuthorRef(repliedTo);
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
        memberAgentIds: new Set(
          participants
            .filter((participant) => participant.type === 'agent')
            .map((participant) => participant.id)
        ),
        authorAgentId: agent.id
      }),
      clientKey: `tool:${task.id}:${key}`
    });
  }

  // Agent and conversation budgets cover all their work, not one task. Raising the budget and
  // resuming the task lets it go on.
  private async checkSpendingBudgets(task: Task): Promise<string | null> {
    const agent = await this.agentRepository.getById(task.ownerAgentId);
    if (agent?.monthlyBudgetUsd != null) {
      const now = new Date();
      const { costUsd: spent } = await this.taskRepository.sumCost({
        agentId: agent.id,
        since: startOfMonth(now)
      });
      if (spent >= agent.monthlyBudgetUsd) {
        return `${agent.name} spent ${formatDollars(spent)} this month, reaching its ${formatDollars(agent.monthlyBudgetUsd)} monthly budget. A person can raise the budget and resume this task.`;
      }
    }
    if (task.conversationId) {
      const conversation = await this.conversationRepository.getById(task.conversationId);
      if (conversation?.budgetUsd != null) {
        const { costUsd: spent } = await this.taskRepository.sumCost({
          conversationId: conversation.id
        });
        if (spent >= conversation.budgetUsd) {
          return `This conversation spent ${formatDollars(spent)}, reaching its ${formatDollars(conversation.budgetUsd)} budget. A person can raise the budget and resume this task.`;
        }
      }
    }
    return null;
  }

  // Asks the agent's model, in a separate call with no tools, whether the result meets the
  // task's criteria. The verdict is saved with the tool call, so a replay after a crash reuses
  // it. Returns null when the check is off or the provider is the scripted test fake.
  private async checkCompletion(
    task: Task,
    callId: string,
    result: string
  ): Promise<{ met: boolean; summary: string; failures: number } | null> {
    if (!this.options.completionCheck) {
      return null;
    }
    const version = await this.agentRepository.getVersion(task.agentVersionId);
    const client = version ? this.modelClients[version.provider] : undefined;
    if (!version || !client || version.provider === 'scripted') {
      return null;
    }
    const events = await this.loadEvents(task.id);
    const checks = events.filter((event) => event.type === TASK_EVENTS.completionChecked);
    const failuresBefore = checks.filter((event) => event.data.met === false).length;
    const earlier = checks.find((event) => event.data.callId === callId);
    if (earlier) {
      const met = earlier.data.met === true;
      return {
        met,
        summary: String(earlier.data.summary ?? ''),
        failures: failuresBefore
      };
    }

    const outputs = await this.taskRepository.listOutputs(task.id);
    const evidence = outputs.length
      ? outputs
          .map(
            (output) =>
              `- ${output.title} (${output.kind})${output.uri ? ` ${output.uri}` : ''}: ${(output.content ?? '').slice(0, 2000)}`
          )
          .join('\n')
      : '(none)';
    const reply = await this.requestModel(task, version, events, client, {
      model: version.model,
      system: COMPLETION_CHECK_PROMPT,
      transcript: [
        {
          role: 'user',
          text: `Request:\n${task.brief}\n\nCompletion criteria:\n${task.completionCriteria}\n\nOutputs and evidence:\n${evidence}\n\nResult:\n${result.slice(0, 20_000)}`
        }
      ],
      tools: [],
      maxTokens: 1000
    });
    const latestTurn = events.filter((event) => event.type === TASK_EVENTS.modelTurn).at(-1);
    const contextEventId =
      typeof latestTurn?.data.contextEventId === 'number'
        ? latestTurn.data.contextEventId
        : (latestTurn?.id ?? 0);
    if (await this.hasNewTaskMessage(task.id, contextEventId)) {
      throw new AppError(
        'taskCompletionRejected',
        'A new message arrived during the check. Read the update and revise the result before completing.'
      );
    }
    const text = reply.text.trim();
    // Anything other than a clear "MET:" counts as not met, so a confused check never passes.
    const met = /^MET\b/i.test(text);
    const summary =
      text.replace(/^(NOT MET|MET)\s*:?\s*/i, '').slice(0, 1000) || 'No reason given.';
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.completionChecked, SYSTEM_ACTOR, {
      callId,
      met,
      summary,
      usage: reply.usage,
      costUsd: calculateCostUsd(this.options.prices, version.model, reply.usage)
    });
    this.runnerLogger.onCompletionChecked(task.id, met);
    return { met, summary, failures: failuresBefore + (met ? 0 : 1) };
  }

  private async hasNewTaskMessage(taskId: string, contextEventId: number): Promise<boolean> {
    const events = await this.taskRepository.listLatestEvents(
      [taskId],
      [TASK_EVENTS.messageReceived]
    );
    return events.some((event) => event.id > contextEventId);
  }

  private async handleCompletionFailure(
    task: Task,
    callId: string,
    error: ModelClientError
  ): Promise<number> {
    const events = await this.loadEvents(task.id);
    const failures =
      events.filter(
        (event) => event.type === TASK_EVENTS.completionFailed && event.data.callId === callId
      ).length + 1;
    await this.taskRepository.addEvent(task.id, TASK_EVENTS.completionFailed, SYSTEM_ACTOR, {
      callId,
      provider: error.provider,
      retryable: error.retryable,
      message: error.message
    });
    this.runnerLogger.onModelFailed(task.id, error.provider, error.retryable, error.message);
    if (error.retryable && failures < MAX_MODEL_FAILURES) return 5_000 * 2 ** (failures - 1);
    await this.block(task, `The completion check failed: ${error.message}`);
    return 0;
  }

  private async saveOutputOnce(
    task: Task,
    actor: Actor,
    callId: string,
    input: {
      title: string;
      content: string;
      kind: 'text' | 'link' | 'data' | 'log' | 'file';
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
      await this.lifecycle.blockTask(task.id, SYSTEM_ACTOR, reason);
    } catch (error) {
      ignoreStateConflict(error);
      return;
    }
    const agent = await this.agentRepository.getById(task.ownerAgentId);
    const blockCount = await this.taskRepository.countEvents(task.id, TASK_EVENTS.stateChanged);
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
      ? await this.lookupParticipantName(getAuthorRef(request))
      : task.requestedById && task.requestedByType !== 'schedule'
        ? await this.lookupParticipantName({ type: task.requestedByType, id: task.requestedById })
        : 'a schedule';

    // Notes from this conversation, plus agent-wide ones. Never notes from other conversations.
    const notes = await this.noteRepository.list({
      agentId: agent.id,
      visibility: { conversationId: task.conversationId },
      limit: NOTES_IN_PROMPT,
      offset: 0
    });

    if (!task.conversationId) {
      return buildTaskPrompt({
        task,
        requesterName,
        participants: [],
        notes,
        history: [],
        nameOf: () => ''
      });
    }
    // Newest first, each cut to what the prompt can hold, so huge documents aren't loaded.
    const [documents, participants, membership] = await Promise.all([
      this.documentRepository.list(task.conversationId, {
        limit: 50,
        maxChars: MAX_DOCUMENT_CHARS
      }),
      this.loadParticipants(task.conversationId),
      this.conversationRepository.getMember(task.conversationId, toAgentActor(agent))
    ]);

    // Only history this agent may see: nothing from before it joined, if it joined that way.
    const history = await this.messageRepository.listRecent(task.conversationId, {
      since: membership?.historyFrom ?? null,
      limit: this.options.historyLimit
    });
    const names = new Map(
      participants.map((participant) => [`${participant.type}:${participant.id}`, participant.name])
    );
    const directory = (await this.listDirectoryAgentsOutside(participants)).map(
      ({ name, purpose }) => ({
        name,
        purpose
      })
    );
    return buildTaskPrompt({
      task,
      requesterName,
      participants,
      directory,
      notes,
      documents,
      history,
      nameOf: (message) => names.get(`${message.authorType}:${message.authorId}`) ?? 'Someone'
    });
  }

  // Enabled agents with a configuration that aren't members. Only name and purpose are shown.
  private async listDirectoryAgentsOutside(participants: ContextParticipant[]): Promise<Agent[]> {
    return this.agentRepository.listDirectory({
      excludeIds: participants
        .filter((participant) => participant.type === 'agent')
        .map((participant) => participant.id),
      limit: DIRECTORY_AGENTS_IN_PROMPT,
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
          name: await this.lookupParticipantName(member.participant),
          purpose: null
        };
      })
    );
  }

  private async lookupParticipantName(ref: ParticipantRef | null): Promise<string> {
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
  // Turns from another provider, such as before a version change, or saved in another format,
  // such as before a client change, can't be sent back as they are. They are shown as text
  // instead. Turns saved before formats were recorded are 'native'.
  async rebuildTranscript(
    prompt: string,
    events: TaskEvent[],
    provider: ModelProvider,
    format: string = 'native'
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
        case TASK_EVENTS.modelTurn: {
          const calls = (event.data.toolCalls as ModelToolCall[] | undefined) ?? [];
          const turnProvider = event.data.provider as ModelProvider | undefined;
          const turnFormat = (event.data.format as string | undefined) ?? 'native';
          pendingIsForeign =
            (turnProvider !== undefined && turnProvider !== provider) || turnFormat !== format;
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
        case TASK_EVENTS.toolResults: {
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
        case TASK_EVENTS.messageReceived: {
          const messageId = event.data.messageId as string;
          if (seenMessages.has(messageId)) {
            break;
          }
          seenMessages.add(messageId);
          const message = await this.messageRepository.getById(messageId);
          if (message) {
            const name = await this.lookupParticipantName(getAuthorRef(message));
            say(`New message in the conversation:\n${formatMessage(message, name)}`);
          }
          break;
        }
        case TASK_EVENTS.approvalExecuted: {
          const approved = event.data.request as ApprovalRequest;
          if (isAccessRequest(approved)) {
            const result = event.data.result as ApprovalResult;
            say(
              result.error
                ? `A person allowed access to ${approved.name}, but it was not added: ${result.error}`
                : `A person allowed your request. ${result.body} You can use it now.`
            );
            break;
          }
          const request = approved;
          const action = describeConnectionAction(request);
          const result = event.data.result as ApprovalResult;
          say(
            result.error || result.isError
              ? `A person approved ${action} on ${request.connectionName}, but it failed: ${result.error ?? result.body}`
              : `A person approved ${action} on ${request.connectionName}. It returned ${request.kind === 'mcp' ? 'MCP' : `HTTP ${result.status}`}${result.truncated ? ' (cut off)' : ''}:\n${result.body}`
          );
          break;
        }
        case TASK_EVENTS.approvalRejected: {
          const rejected = event.data.request as ApprovalRequest;
          if (isAccessRequest(rejected)) {
            say(
              `A person declined access to ${rejected.name}${event.data.reason ? `: ${event.data.reason as string}` : '.'} Continue without it or explain the limitation. Don't ask again for it.`
            );
            break;
          }
          const request = rejected;
          const action = describeConnectionAction(request);
          say(
            `A person rejected ${action} on ${request.connectionName}${event.data.reason ? `: ${event.data.reason as string}` : '.'} It was not made.`
          );
          break;
        }
        case TASK_EVENTS.nudge: {
          say(event.data.text as string);
          break;
        }
        case TASK_EVENTS.stateChanged: {
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

function describeAccessWait(request: CapabilityAccessRequest): string {
  return `A person decides on ${request.targetType} access to ${request.name}`;
}

function waitingForAccess(request: CapabilityAccessRequest, approvalId: string): ToolOutcome {
  return {
    content: `Asked a person for access to ${request.name} (request ${approvalId}). Your work is paused until they decide.`,
    stop: true
  };
}

function getAuthorRef(message: Message): ParticipantRef | null {
  return message.authorType !== 'system' && message.authorId
    ? { type: message.authorType, id: message.authorId }
    : null;
}

function getAuthorActor(message: Message): Actor {
  return { type: message.authorType, id: message.authorId };
}

function resolveParticipant(participants: ContextParticipant[], name: string): ParticipantRef {
  const wanted = name.trim().toLowerCase();
  const match = participants.find(
    (participant) =>
      participant.name.toLowerCase() === wanted || participant.id.toLowerCase() === wanted
  );
  if (!match) {
    throw new AppError(
      'mentionNotMember',
      `No participant named "${name}". Participants: ${participants.map((participant) => participant.name).join(', ')}.`
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

function buildUnrecordedResult(): ApprovalResult {
  return {
    status: null,
    body: '',
    truncated: false,
    error: 'The call started, but its result was not recorded.'
  };
}

function isFinishedState(state: Task['state']): boolean {
  return state === 'completed' || state === 'cancelled';
}

// A short, one-line version of a message for a task title.
function shortenForTitle(text: string): string {
  const flat = oneLine(text);
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

function toAgentActor(agent: Agent): { type: 'agent'; id: string } {
  return { type: 'agent', id: agent.id };
}

// File text for the agent, with a note when the workspace cut it short.
function formatFileForAgent(file: { content: string; truncated: boolean; bytes: number }): string {
  return file.truncated
    ? `${file.content}\n(Cut off: the file is ${file.bytes} bytes.)`
    : file.content;
}

function describeConnectionAction(request: ConnectionCallRequest): string {
  return request.kind === 'mcp' ? request.tool : `${request.method} ${request.path}`;
}
