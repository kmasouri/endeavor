// Talks to the platform's API. Every request names the person acting (x-actor-id), because
// there is no sign-in yet. The chosen person is remembered in this browser.

const ACTOR_KEY = 'collaborative-agents.actorId';

export function getActorId(): string | null {
  try {
    return localStorage.getItem(ACTOR_KEY);
  } catch {
    return null;
  }
}

export function setActorId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTOR_KEY, id);
    } else {
      localStorage.removeItem(ACTOR_KEY);
    }
  } catch {
    // Private windows can block storage. The choice then lasts until the page reloads.
  }
}

export class ApiError extends Error {
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
  get: <T>(path: string) => request<{ data: T }>('GET', path).then((r) => r.data),
  list: <T>(path: string) => request<{ data: T[]; page: Page }>('GET', path),
  post: <T>(path: string, body: unknown = {}) =>
    request<{ data: T }>('POST', path, body).then((r) => r.data),
  patch: <T>(path: string, body: unknown) =>
    request<{ data: T }>('PATCH', path, body).then((r) => r.data),
  delete: (path: string) => request<unknown>('DELETE', path)
};

// The shapes the API sends back. They mirror src/shared/types.ts; dates arrive as strings.

export interface Human {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

export interface ParticipantRef {
  type: 'human' | 'agent';
  id: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export interface Member {
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

export interface DirectoryEntry {
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
  maxWorkingMinutes?: number;
}

export interface AgentVersion {
  id: string;
  version: number;
  instructions: string;
  provider: Provider;
  model: string;
  skillVersionIds: string[];
  connectionIds: string[];
  limits: AgentLimits;
  createdAt: string;
}

export interface Agent {
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
  disabledAt: string | null;
}

export interface SkillVersion {
  id: string;
  version: number;
  instructions: string;
  connectionIds: string[];
  createdAt: string;
}

export interface SkillDetails extends Skill {
  currentVersion: SkillVersion | null;
}

export interface Connection {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authHeader: string;
  hasCredential: boolean;
  allowedMethods: HttpMethod[];
  allowedPathPrefixes: string[];
  approvalMethods: HttpMethod[];
  disabledAt: string | null;
}

export interface Grant {
  targetType: 'skill' | 'connection';
  targetId: string;
  grantedAt: string;
  revokedAt: string | null;
}
