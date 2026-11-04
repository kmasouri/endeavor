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

export interface HumanPreferences {
  theme: 'system' | 'dark' | 'light';
  timeFormat: '12h' | '24h';
}

export interface Human {
  id: string;
  name: string;
  role: HumanRole;
  preferences: HumanPreferences;
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
  // The project of the source conversation. null for notes saved outside any conversation.
  projectId: string | null;
  // 'project': shown in tasks in every endeavor of the project. 'conversation': only in tasks
  // in the source conversation (notes saved before projects). 'agent': in all of them.
  scope: NoteScope;
  createdBy: Actor;
  updatedByHumanId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const NOTE_SCOPES = ['conversation', 'project', 'agent'] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];

// A knowledge source a person attached to a project. conversationId, when set, limits it to that
// one endeavor.
export interface ProjectDocument {
  id: string;
  projectId: string;
  conversationId: string | null;
  title: string;
  content: string;
  addedByHumanId: string;
  createdAt: Date;
}

// Model providers an agent can use. src/integrations/models has a client for each one.
// 'scripted' is a fake that answers from a script, for tests and demos with no API key.
export const MODEL_PROVIDERS = ['anthropic', 'openai', 'scripted'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

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
  // Retained only for historical references. Deleted agents cannot be restored.
  deletedAt?: Date | null;
  id: string;
  name: string;
  purpose: string;
  currentVersionId: string | null;
  disabledAt: Date | null;
  // A cap on what this agent spends each calendar month (UTC), in US dollars. null: no cap.
  monthlyBudgetUsd: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Limits for each task an agent runs. Leaving one out means the runner's default applies.
export interface AgentLimits {
  maxModelTurns?: number;
  // Input plus output tokens over the whole task.
  maxTokens?: number;
  // US dollars over the whole task. Without it, TASK_BUDGET_USD applies.
  maxCostUsd?: number;
  // Minutes spent working. Time spent waiting or paused doesn't count.
  maxWorkingMinutes?: number;
}

// One saved version of an agent's settings. Versions never change once saved.
export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  instructions: string;
  provider: ModelProvider;
  model: string;
  skillVersionIds: string[];
  // Skill identities for display and editing, including pins to older versions.
  skillIds?: string[];
  connectionIds: string[];
  // Historical inherited selections for human review only. Never authorize calls.
  legacyConnectionIds?: string[];
  limits: AgentLimits;
  createdByHumanId: string | null;
  createdAt: Date;
}

// A long-lived group of endeavors. It holds knowledge sources, saved notes, and the people and
// agents added to each new endeavor in it.
export interface Project {
  id: string;
  name: string;
  // New endeavors go here when no project is named.
  isDefault: boolean;
  createdByHumanId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ProjectMember {
  projectId: string;
  participant: ParticipantRef;
  addedByHumanId: string | null;
  addedAt: Date;
}

export type EndeavorState = 'open' | 'closed';

// An endeavor in the web app: one goal inside a project.
export interface Conversation {
  id: string;
  title: string;
  projectId: string;
  // The request that opened the endeavor. null until someone asks for something.
  goal: string | null;
  goalMessageId: string | null;
  // When the goal is met. Filled in from the goal; people can edit it.
  doneCriteria: string | null;
  // Closed when a person confirms the goal is done. Closed endeavors are archived.
  state: EndeavorState;
  closedAt: Date | null;
  closedByHumanId: string | null;
  createdByHumanId: string;
  // A cap on what all agent work in this conversation spends, in US dollars. null: no cap.
  budgetUsd: number | null;
  createdAt: Date;
}

// historyFrom limits how far back a member can read. null means the whole history.
export interface ConversationMember {
  conversationId: string;
  participant: ParticipantRef;
  addedByHumanId: string | null;
  historyFrom: Date | null;
  addedAt: Date;
}

// A message addressed to an agent, waiting for the runner to turn it into work.
export interface MessageDelivery {
  messageId: string;
  agentId: string;
  createdAt: Date;
}

// What the agent directory shows about an agent. Only what's needed to decide whom to ask:
// never instructions, saved notes, credentials, or conversations.
export interface DirectoryEntry extends AgentAppearance {
  id: string;
  name: string;
  purpose: string;
  capabilities: {
    provider: ModelProvider;
    model: string;
    skillCount: number;
    connectionCount: number;
  };
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  currentVersionId: string | null;
  // Agents can find it with find_capabilities and ask for access. Grants nothing by itself.
  discoverable: boolean;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Skill instructions are guidance for the model, not the agent's own instructions and not a
// knowledge source. Versions never change once saved.
export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  instructions: string;
  createdByHumanId: string | null;
  createdAt: Date;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

// A connection as the API shows it. The credential itself is never included.
export interface Connection {
  authMethod?: 'none' | 'header' | 'oauth';
  // Credential availability, not a live provider health check.
  authenticated?: boolean;
  // Missing kind in older in-memory records means HTTP.
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
  // Methods that need a person's approval before each call.
  approvalMethods: HttpMethod[];
  // Agents can find it with find_capabilities and ask for access. Grants nothing by itself.
  discoverable: boolean;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type GrantTargetType = 'skill' | 'connection';

export interface AgentGrant {
  agentId: string;
  targetType: GrantTargetType;
  targetId: string;
  grantedByHumanId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface HttpConnectionCallRequest {
  kind?: 'http';
  connectionId: string;
  connectionName: string;
  method: HttpMethod;
  path: string;
  body: string | null;
}

export interface McpConnectionCallRequest {
  kind: 'mcp';
  connectionId: string;
  connectionName: string;
  tool: string;
  arguments: Record<string, unknown>;
  // Bind approval to the endpoint and credential header reviewed by the person.
  baseUrl: string;
  authHeader: string;
}

export type ConnectionCallRequest = HttpConnectionCallRequest | McpConnectionCallRequest;

// How long approved access lasts: for the requesting task only, or ongoing for the agent.
export const ACCESS_DURATIONS = ['task', 'ongoing'] as const;
export type AccessDuration = (typeof ACCESS_DURATIONS)[number];

// What a connection lets an agent do: HTTP methods and path prefixes, or MCP tool names.
export type ConnectionScope =
  | { kind: 'http'; methods: HttpMethod[]; pathPrefixes: string[] }
  | { kind: 'mcp'; tools: string[] };

// An agent asking a person for access to a skill or connection it found. The skill version
// and connection scope are what the person sees and approves.
export interface CapabilityAccessRequest {
  kind: 'access';
  targetType: GrantTargetType;
  targetId: string;
  name: string;
  description: string;
  // Skills: the exact version requested.
  skillVersionId: string | null;
  skillVersion: number | null;
  // Connections: the scope at the time of the request.
  scope: ConnectionScope | null;
  reason: string;
  // The agent may recommend a duration and say why. The person decides.
  recommendedDuration: AccessDuration | null;
  durationReason: string | null;
}

export type ApprovalRequest = ConnectionCallRequest | CapabilityAccessRequest;

export function isAccessRequest(request: ApprovalRequest): request is CapabilityAccessRequest {
  return request.kind === 'access';
}

// A skill or connection added to one task after an access request. The task's pinned
// configuration version is unchanged.
export interface TaskCapability {
  id: string;
  taskId: string;
  approvalId: string;
  targetType: GrantTargetType;
  targetId: string;
  skillVersionId: string | null;
  scope: ConnectionScope | null;
  duration: AccessDuration;
  grantedByHumanId: string;
  grantedAt: Date;
  revokedByHumanId: string | null;
  revokedAt: Date | null;
}

export interface ApprovalResult {
  isError?: boolean;
  status: number | null;
  body: string;
  truncated: boolean;
  // Set when the call wasn't made after approval, such as when access was revoked meanwhile.
  error: string | null;
}

// An action an agent asked to take, or access it asked for, that needs a person's approval.
export interface Approval {
  id: string;
  taskId: string;
  agentId: string;
  kind: 'connection_call' | 'capability_access';
  request: ApprovalRequest;
  status: ApprovalStatus;
  // Access requests only: the duration the person chose.
  duration: AccessDuration | null;
  decidedByHumanId: string | null;
  decidedAt: Date | null;
  reason: string | null;
  executedAt: Date | null;
  result: ApprovalResult | null;
  createdAt: Date;
}

export type ResponsibilityStatus = 'enabled' | 'paused' | 'cancelled';
export type MissedRunPolicy = 'ask' | 'run_once' | 'skip';

export interface CalendarRecurrence {
  frequency: 'daily' | 'weekdays' | 'weekly';
  // ISO weekdays: Monday = 1, Sunday = 7. Only weekly rules use this field.
  days?: number[];
  time: string;
  timeZone: string;
}

// A recurring piece of work for one agent. Each run is a task with this responsibilityId.
export interface Responsibility {
  id: string;
  agentId: string;
  conversationId: string | null;
  title: string;
  brief: string;
  completionCriteria: string;
  intervalMinutes: number | null;
  recurrence: CalendarRecurrence | null;
  missedRunPolicy: MissedRunPolicy;
  status: ResponsibilityStatus;
  nextRunAt: Date;
  lastRunAt: Date | null;
  // An open "run now or wait?" question about missed runs, or null.
  catchUp: { slot: Date; missed: number } | null;
  createdByHumanId: string;
  createdAt: Date;
  updatedAt: Date;
}
