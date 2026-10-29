// Talks to the platform's API. Every request names the person acting (x-actor-id), because
// there is no sign-in yet. The chosen person is remembered in this browser.

import { readPreference, writePreference } from './preferences-storage';

export function getActorId(): string | null {
  return readPreference('actorId');
}

export function setActorId(id: string | null): void {
  writePreference('actorId', id);
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly name: string
  ) {
    super(message);
  }
}

export interface Page {
  limit: number;
  offset: number;
  total: number;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const actorId = getActorId();
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(actorId && { 'x-actor-id': actorId })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = json.error ?? {};
    throw new ApiError(error.message ?? response.statusText, response.status, error.name ?? '');
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<{ data: T }>('GET', path).then((body) => body.data),
  list: <T>(path: string) => request<{ data: T[]; page: Page }>('GET', path),
  post: <T>(path: string, body: unknown = {}) =>
    request<{ data: T }>('POST', path, body).then((body) => body.data),
  put: <T>(path: string, body: unknown) =>
    request<{ data: T }>('PUT', path, body).then((body) => body.data),
  patch: <T>(path: string, body: unknown) =>
    request<{ data: T }>('PATCH', path, body).then((body) => body.data),
  delete: (path: string) => request<unknown>('DELETE', path)
};

// The shapes the API sends back. They mirror src/shared/types.ts; dates arrive as strings.

export interface HumanPreferences {
  theme: 'system' | 'dark' | 'light';
  timeFormat: '12h' | '24h';
}

export interface Human {
  id: string;
  name: string;
  role: 'admin' | 'member';
  preferences: HumanPreferences;
}

export interface ParticipantRef {
  type: 'human' | 'agent';
  id: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  // Messages from others you haven't seen. Only the conversations list sends it.
  unreadCount?: number;
}

export interface Member extends AgentAppearance {
  deleted?: boolean;
  participant: ParticipantRef;
  name: string;
  purpose: string | null;
  historyFrom: string | null;
}

export interface ConversationDetails extends Conversation {
  members: Member[];
}

export interface Message {
  id: string;
  authorType: 'human' | 'agent' | 'system';
  authorId: string | null;
  body: string;
  mentions: ParticipantRef[];
  inReplyToMessageId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface DirectoryEntry extends AgentAppearance {
  id: string;
  name: string;
  purpose: string;
  capabilities: { provider: string; model: string; skillCount: number; connectionCount: number };
}

export type Provider = 'openai' | 'anthropic' | 'scripted';
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface ProviderStatus {
  provider: Provider;
  ready: boolean;
  setup: string;
}

export interface AgentLimits {
  maxModelTurns?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxWorkingMinutes?: number;
}

export interface AgentVersion {
  id: string;
  version: number;
  instructions: string;
  provider: Provider;
  model: string;
  skillVersionIds: string[];
  skillIds?: string[];
  connectionIds: string[];
  legacyConnectionIds?: string[];
  limits: AgentLimits;
  createdAt: string;
}

export const AGENT_AVATAR_COLORS = ['lime', 'sky', 'teal'] as const;
export const AGENT_AVATAR_ICONS = [
  'agents',
  'search',
  'check',
  'file',
  'work',
  'connections',
  'approvals',
  'catalogs',
  'setup',
  'schedules'
] as const;
export interface AgentAppearance {
  avatarColor?: (typeof AGENT_AVATAR_COLORS)[number] | null;
  avatarIcon?: (typeof AGENT_AVATAR_ICONS)[number] | null;
}

export interface Agent extends AgentAppearance {
  id: string;
  name: string;
  purpose: string;
  currentVersionId: string | null;
  disabledAt: string | null;
  currentVersion: AgentVersion | null;
  providerReady: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  currentVersionId: string | null;
  discoverable: boolean;
  disabledAt: string | null;
}

export interface SkillVersion {
  id: string;
  version: number;
  instructions: string;
  createdAt: string;
}

export interface SkillDetails extends Skill {
  currentVersion: SkillVersion | null;
}

export interface Connection {
  authMethod?: 'none' | 'header' | 'oauth';
  // Credential availability, not a live provider health check.
  authenticated?: boolean;
  kind?: 'http' | 'mcp';
  allowedTools?: string[];
  approvalTools?: string[];
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authHeader: string;
  hasCredential: boolean;
  allowedMethods: HttpMethod[];
  allowedPathPrefixes: string[];
  approvalMethods: HttpMethod[];
  discoverable: boolean;
  disabledAt: string | null;
}

export interface Grant {
  targetType: 'skill' | 'connection';
  targetId: string;
  grantedAt: string;
  revokedAt: string | null;
}

export type TaskState = 'working' | 'waiting' | 'completed' | 'blocked' | 'cancelled';
export const TASK_STATES: TaskState[] = ['working', 'waiting', 'completed', 'blocked', 'cancelled'];

export interface Actor {
  type: 'human' | 'agent' | 'system';
  id: string | null;
}

export interface TaskWait {
  id: string;
  kind: 'reply' | 'approval' | 'external' | 'task';
  targetId: string | null;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface TaskActivity {
  kind: 'searching' | 'reading' | 'writing' | 'checking' | 'connection' | 'thinking';
  detail: string;
  since: string;
}

export interface Task {
  activity?: TaskActivity | null;
  id: string;
  conversationId: string | null;
  ownerAgentId: string;
  agentVersionId: string;
  title: string;
  brief: string;
  completionCriteria: string;
  reviewRequired: boolean;
  state: TaskState;
  stateReason: string | null;
  pausedAt: string | null;
  requestedByType: 'human' | 'agent' | 'schedule';
  requestedById: string | null;
  parentTaskId: string | null;
  restartedFromTaskId: string | null;
  responsibilityId: string | null;
  criteriaCheck: { met: boolean; summary: string } | null;
  review: { approved: boolean; notes: string | null } | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface TaskDetails extends Task {
  waits: TaskWait[];
}

export interface TaskEvent {
  id: number;
  type: string;
  actor: Actor;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TaskOutput {
  id: string;
  kind: string;
  title: string;
  content: string | null;
  uri: string | null;
  createdAt: string;
}

export type AccessDuration = 'task' | 'ongoing';

export type ConnectionScope =
  | { kind: 'http'; methods: HttpMethod[]; pathPrefixes: string[] }
  | { kind: 'mcp'; tools: string[] };

// An agent asking for access to a skill or connection it found. The person picks the duration.
export interface AccessRequest {
  kind: 'access';
  targetType: 'skill' | 'connection';
  targetId: string;
  name: string;
  description: string;
  skillVersion: number | null;
  scope: ConnectionScope | null;
  reason: string;
  recommendedDuration: AccessDuration | null;
  durationReason: string | null;
}

export interface Approval {
  id: string;
  taskId: string;
  agentId: string;
  kind: 'connection_call' | 'capability_access';
  request:
    | { kind?: 'http'; connectionName: string; method: string; path: string; body: string | null }
    | {
        kind: 'mcp';
        connectionName: string;
        tool: string;
        arguments: Record<string, unknown>;
        baseUrl: string;
      }
    | AccessRequest;
  duration: AccessDuration | null;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  decidedAt: string | null;
  result: { status: number | null; body: string; error: string | null } | null;
  createdAt: string;
}

// Access a person added to one task after a request. The task's version is unchanged.
export interface TaskCapability {
  id: string;
  targetType: 'skill' | 'connection';
  targetId: string;
  scope: ConnectionScope | null;
  duration: AccessDuration;
  grantedAt: string;
  revokedAt: string | null;
}

export interface Responsibility {
  id: string;
  agentId: string;
  conversationId: string | null;
  title: string;
  brief: string;
  completionCriteria: string;
  intervalMinutes: number | null;
  recurrence: {
    frequency: 'daily' | 'weekdays' | 'weekly';
    days?: number[];
    time: string;
    timeZone: string;
  } | null;
  missedRunPolicy: 'ask' | 'run_once' | 'skip';
  status: 'enabled' | 'paused' | 'cancelled';
  nextRunAt: string;
  lastRunAt: string | null;
  catchUp: { slot: string; missed: number } | null;
}

export interface AgentNote {
  id: string;
  body: string;
  sourceTaskId: string | null;
  sourceConversationId: string | null;
  scope: 'conversation' | 'agent';
  createdBy: Actor;
  updatedByHumanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface CostSummary {
  costUsd: number;
  tokens: number;
  unpricedCalls: number;
}

export interface CostReport {
  total: CostSummary;
  thisMonth: CostSummary;
  budgetUsd: number | null;
  tasks: { taskId: string; title: string; costUsd: number; tokens: number }[];
}
