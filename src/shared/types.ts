export interface Item {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Who did something. Agents and humans are both participants; 'system' is the platform itself,
// such as the runner recording a timeout.
export type ActorType = 'human' | 'agent' | 'system';

export interface Actor {
  type: ActorType;
  id: string | null;
}

export type HumanRole = 'admin' | 'member';

export interface Human {
  id: string;
  name: string;
  role: HumanRole;
  createdAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  authorType: ActorType;
  authorId: string | null;
  body: string;
  mentions: ParticipantRef[];
  inReplyToMessageId: string | null;
  taskId: string | null;
  createdAt: Date;
}

export interface ParticipantRef {
  type: 'human' | 'agent';
  id: string;
}

// The five task states from the PRD. Pause is a separate flag (pausedAt), not a state.
export const TASK_STATES = ['working', 'waiting', 'completed', 'blocked', 'cancelled'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export type TaskRequesterType = 'human' | 'agent' | 'schedule';

export interface CriteriaCheck {
  met: boolean;
  summary: string;
  checkedBy: Actor;
  checkedAt: Date;
}

export interface TaskReview {
  approved: boolean;
  notes: string | null;
  humanId: string;
  reviewedAt: Date;
}

export interface Task {
  id: string;
  runKey: string;
  conversationId: string | null;
  ownerAgentId: string;
  agentVersionId: string;
  title: string;
  brief: string;
  completionCriteria: string;
  reviewRequired: boolean;
  state: TaskState;
  stateReason: string | null;
  pausedAt: Date | null;
  requestedByType: TaskRequesterType;
  requestedById: string | null;
  requestMessageId: string | null;
  parentTaskId: string | null;
  restartedFromTaskId: string | null;
  responsibilityId: string | null;
  criteriaCheck: CriteriaCheck | null;
  review: TaskReview | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export const TASK_WAIT_KINDS = ['reply', 'approval', 'external', 'task'] as const;
export type TaskWaitKind = (typeof TASK_WAIT_KINDS)[number];

export interface TaskWait {
  id: string;
  taskId: string;
  kind: TaskWaitKind;
  targetId: string | null;
  description: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: Record<string, unknown> | null;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  type: string;
  actor: Actor;
  data: Record<string, unknown>;
  createdAt: Date;
}

export const TASK_OUTPUT_KINDS = ['text', 'link', 'file', 'data', 'log'] as const;
export type TaskOutputKind = (typeof TASK_OUTPUT_KINDS)[number];

export interface TaskOutput {
  id: string;
  taskId: string;
  kind: TaskOutputKind;
  title: string;
  content: string | null;
  uri: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// Saved notes (agent memory): what an agent wrote down for later work. Not instructions, and
// not an approved shared fact.
export interface AgentNote {
  id: string;
  agentId: string;
  body: string;
  sourceTaskId: string | null;
  sourceConversationId: string | null;
  createdBy: Actor;
  updatedByHumanId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  name: string;
  purpose: string;
  currentVersionId: string | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// One saved version of an agent's settings. Versions never change once saved.
export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  instructions: string;
  provider: string;
  model: string;
  skillIds: string[];
  connectionIds: string[];
  createdByHumanId: string | null;
  createdAt: Date;
}
