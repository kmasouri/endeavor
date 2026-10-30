import {
  Actor,
  CriteriaCheck,
  Task,
  TaskEvent,
  TaskOutput,
  TaskOutputKind,
  TaskRequesterType,
  TaskReview,
  TaskState,
  TaskWait,
  TaskWaitKind
} from '../../shared/types';

export interface CreateTaskInput {
  runKey: string;
  conversationId: string | null;
  ownerAgentId: string;
  agentVersionId: string;
  title: string;
  brief: string;
  completionCriteria: string;
  reviewRequired: boolean;
  requestedByType: TaskRequesterType;
  requestedById: string | null;
  requestMessageId: string | null;
  parentTaskId: string | null;
  restartedFromTaskId: string | null;
  responsibilityId: string | null;
}

export interface ListTasksInput {
  // Only tasks this person may see: in a conversation they belong to, or asked for by them.
  visibleToHumanId?: string;
  state?: TaskState;
  ownerAgentId?: string;
  conversationId?: string;
  responsibilityId?: string;
  limit: number;
  offset: number;
}

// Fields a state change may set. Fields left out are not changed.
export interface TaskChanges {
  state?: TaskState;
  stateReason?: string | null;
  pausedAt?: Date | null;
  criteriaCheck?: CriteriaCheck | null;
  review?: TaskReview | null;
  finishedAt?: Date | null;
  agentVersionId?: string;
}

export interface CreateTaskWaitInput {
  kind: TaskWaitKind;
  targetId: string | null;
  description: string;
}

export interface CreateTaskOutputInput {
  kind: TaskOutputKind;
  title: string;
  content: string | null;
  uri: string | null;
  metadata: Record<string, unknown>;
}

export interface CostFilter {
  agentId?: string;
  conversationId?: string;
  since?: Date;
}

export interface CostSummary {
  costUsd: number;
  tokens: number;
  unpricedCalls: number;
}

export interface TaskCost {
  taskId: string;
  title: string;
  costUsd: number;
  tokens: number;
}

export interface StoredHttpCall {
  requestHash: string;
  response: { status: number; body: string; truncated: boolean } | null;
}

export interface TaskRepository {
  getHttpCall(taskId: string, callId: string): Promise<StoredHttpCall | null>;
  // Only the insert winner may send this call. Existing claims are never reset.
  claimHttpCall(taskId: string, callId: string, requestHash: string): Promise<boolean>;
  saveHttpCallResponse(
    taskId: string,
    callId: string,
    requestHash: string,
    response: NonNullable<StoredHttpCall['response']>
  ): Promise<boolean>;
  // Creates the task, or returns the existing one with the same runKey. For responsibility
  // starts, a competing open run can also be returned; services check its key before use.
  create(input: CreateTaskInput): Promise<{ task: Task; created: boolean }>;
  // Scheduled starts lock and recheck the enabled schedule and expected slot through the
  // insert. Null means pause, cancellation, retiming, or another runner invalidated the slot.
  createScheduled(
    input: CreateTaskInput,
    expectedNextRunAt: Date
  ): Promise<{ task: Task; created: boolean } | null>;
  // Locks/revalidates a catch-up question, then saves its answer, optional task and question
  // removal in one transaction. Null means the question is no longer pending. A competing
  // open task is returned without consuming the question; the service checks its run key.
  // For a run request, task:null means the agent changed before the transaction.
  resolveCatchUp(input: {
    responsibilityId: string;
    agentId: string;
    slot: Date;
    task: CreateTaskInput | null;
  }): Promise<{ task: Task | null; created: boolean } | null>;
  getById(taskId: string): Promise<Task | null>;
  getByRunKey(runKey: string): Promise<Task | null>;
  list(input: ListTasksInput): Promise<Task[]>;
  count(input: Omit<ListTasksInput, 'limit' | 'offset'>): Promise<number>;

  // Applies changes only if the task still has the state, pause flag, and (when given) agent
  // version in expected. Returns null when another change got there first.
  update(
    taskId: string,
    expected: { state: TaskState; paused: boolean; agentVersionId?: string },
    changes: TaskChanges
  ): Promise<Task | null>;

  addWaits(taskId: string, waits: CreateTaskWaitInput[]): Promise<TaskWait[]>;
  listWaits(taskId: string, options: { openOnly: boolean }): Promise<TaskWait[]>;
  findOpenWaits(kind: TaskWaitKind, targetId: string): Promise<TaskWait[]>;
  // Resolves the wait if it is still open. Returns null if it was already resolved.
  resolveWait(waitId: string, resolution: Record<string, unknown>): Promise<TaskWait | null>;
  resolveOpenWaits(taskId: string, resolution: Record<string, unknown>): Promise<number>;

  addEvent(
    taskId: string,
    type: string,
    actor: Actor,
    data: Record<string, unknown>
  ): Promise<TaskEvent>;
  // Saves batch results only while this worker owns the task, or after a human control
  // action released its lease and left it stopped. Never finalizes another worker's batch.
  recordToolResults(
    taskId: string,
    workerId: string,
    data: Record<string, unknown>
  ): Promise<boolean>;
  listEvents(taskId: string, options: { afterId: number; limit: number }): Promise<TaskEvent[]>;

  // The newest matching event per task, fetched together for a status poll.
  listLatestEvents(taskIds: string[], types: string[]): Promise<TaskEvent[]>;

  addOutput(taskId: string, input: CreateTaskOutputInput): Promise<TaskOutput>;
  listOutputs(taskId: string): Promise<TaskOutput[]>;
  countOutputs(taskId: string): Promise<number>;
  // Outputs of every task in a conversation, newest first.
  listConversationOutputs(
    conversationId: string,
    options: { limit: number; offset: number }
  ): Promise<TaskOutput[]>;
  countConversationOutputs(conversationId: string): Promise<number>;
  // What model calls cost, for an agent or a conversation, since a moment if given. costUsd only
  // counts calls with a known price; unpricedCalls says how many had none.
  sumCost(filter: CostFilter): Promise<CostSummary>;
  // The costliest tasks, for the same filters.
  listTaskCosts(filter: CostFilter, limit: number): Promise<TaskCost[]>;

  // Leases up to limit working, unpaused tasks that no live worker holds. A lease that runs out,
  // such as after a crash, makes the task claimable again.
  claimRunnable(workerId: string, leaseMs: number, limit: number): Promise<Task[]>;
  // Gives up the lease. With delayMs, nobody can claim the task until then, which is how the
  // runner waits before trying a failed model call again.
  releaseLease(taskId: string, workerId: string, delayMs?: number): Promise<void>;
  renewLease(taskId: string, workerId: string, leaseMs: number): Promise<boolean>;

  // A responsibility's open (working, waiting, or blocked) run, if it has one.
  findOpenRun(responsibilityId: string): Promise<Task | null>;
  // The agent's open (working, waiting, or blocked) task in a conversation, if it has one.
  findOpenTask(conversationId: string, agentId: string): Promise<Task | null>;
  // Waiting tasks with no open waits. A crash between resolving a wait and waking the task
  // can leave one; the runner wakes them.
  listWaitingWithoutOpenWaits(limit: number): Promise<Task[]>;
  // Completed tasks that answered a message and have no event of this type yet. The runner uses
  // it to post results that weren't posted, such as after a review or a crash.
  listFinishedWithoutEvent(eventType: string, limit: number): Promise<Task[]>;
  // Counts events of one type, such as model turns, for execution limits.
  countEvents(taskId: string, type: string): Promise<number>;
}
