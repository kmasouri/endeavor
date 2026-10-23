// A tiny client for the platform's HTTP API, used by the pilot scripts. Plain fetch, no packages.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} failed with ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class Api {
  readonly baseUrl: string;
  actorId: string | null;

  constructor(baseUrl: string, actorId: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.actorId = actorId;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.actorId && { 'x-actor-id': this.actorId })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as { data?: T }) : {};
    if (!response.ok) {
      throw new ApiError(method, path, response.status, parsed);
    }
    return parsed.data as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  // Every page of a paged list.
  async all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const joiner = path.includes('?') ? '&' : '?';
    for (let offset = 0; ; offset += 100) {
      const page = await this.get<T[]>(`${path}${joiner}limit=100&offset=${offset}`);
      items.push(...page);
      if (page.length < 100) {
        return items;
      }
    }
  }
}

// What setup created, so the brief and report scripts can find it again.
export interface PilotState {
  apiUrl: string;
  actorId: string;
  dryRun: boolean;
  agents: Record<string, string>;
  skills: Record<string, string>;
  connections: Record<string, string>;
  checkConversationId: string;
  responsibilityId: string;
  intervalMinutes: number;
  checksStartAt: string;
  targetAdminUrl: string;
  briefs: BriefRecord[];
}

export interface BriefRecord {
  topicNumber: number;
  mode: 'team' | 'solo';
  conversationId: string;
  messageId: string;
  startedAt: string;
}

export const STATE_PATH = process.env.PILOT_STATE_FILE ?? 'pilot/results/state.json';

export function loadState(): PilotState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as PilotState;
  } catch {
    throw new Error(`No pilot state at ${STATE_PATH}. Run npm run pilot:setup first.`);
  }
}

export function readStateIfAny(): PilotState | null {
  try {
    return loadState();
  } catch {
    return null;
  }
}

export function saveState(state: PilotState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// Reads --name value and --flag arguments.
export function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const [name, inline] = arg.slice(2).split('=', 2);
    const next = argv[i + 1];
    if (inline !== undefined) {
      args[name] = inline;
    } else if (next !== undefined && !next.startsWith('--')) {
      args[name] = next;
      i++;
    } else {
      args[name] = true;
    }
  }
  return args;
}
