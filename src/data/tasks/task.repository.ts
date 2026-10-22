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
  state?: TaskState;
  ownerAgentId?: string;
  conversationId?: string;
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

export interface TaskRepository {
  // Creates the task, or returns the existing one with the same runKey. created says which.
  create(input: CreateTaskInput): Promise<{ task: Task; created: boolean }>;
  getById(taskId: string): Promise<Task | null>;
  getByRunKey(runKey: string): Promise<Task | null>;
  list(input: ListTasksInput): Promise<Task[]>;
  count(input: Omit<ListTasksInput, 'limit' | 'offset'>): Promise<number>;

  // Applies changes only if the task still has pausedAt and state as given in expected.
  // Returns null when another change got there first.
  update(
    taskId: string,
    expected: { state: TaskState; paused: boolean },
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
  listEvents(taskId: string, options: { afterId: number; limit: number }): Promise<TaskEvent[]>;

  addOutput(taskId: string, input: CreateTaskOutputInput): Promise<TaskOutput>;
  listOutputs(taskId: string): Promise<TaskOutput[]>;
  countOutputs(taskId: string): Promise<number>;

  // Leases up to limit working, unpaused tasks that no live worker holds. A lease that runs out,
  // such as after a crash, makes the task claimable again.
  claimRunnable(workerId: string, leaseMs: number, limit: number): Promise<Task[]>;
  releaseLease(taskId: string, workerId: string): Promise<void>;
}
