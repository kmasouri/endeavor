// Pure helpers that turn tasks and their events into the CA-3 measures. The report script
// fetches the data; these do the counting, so they can be tested without a server.

export interface TaskLike {
  id: string;
  ownerAgentId: string;
  state: string;
  stateReason: string | null;
  pausedAt: string | null;
  requestMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  waits?: WaitLike[];
}

export interface WaitLike {
  kind: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface EventLike {
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface TaskUsage {
  costUsd: number;
  tokens: number;
  unpricedCalls: number;
  modelTurns: number;
  asks: number;
  nudges: number;
  modelFailures: number;
  checksPassed: number;
  checksFailed: number;
}

// A task, or a wait, quiet for longer than this counts as stalled or missed.
const STALE_MINUTES = 15;

export function taskUsage(events: EventLike[]): TaskUsage {
  const usage: TaskUsage = {
    costUsd: 0,
    tokens: 0,
    unpricedCalls: 0,
    modelTurns: 0,
    asks: 0,
    nudges: 0,
    modelFailures: 0,
    checksPassed: 0,
    checksFailed: 0
  };
  for (const event of events) {
    const cost = event.data.costUsd;
    const tokens = event.data.usage as { inputTokens?: number; outputTokens?: number } | undefined;
    if (event.type === 'model.turn' || event.type === 'completion.checked') {
      if (typeof cost === 'number') {
        usage.costUsd += cost;
      } else {
        usage.unpricedCalls += 1;
      }
      usage.tokens += (tokens?.inputTokens ?? 0) + (tokens?.outputTokens ?? 0);
    }
    if (event.type === 'model.turn') {
      usage.modelTurns += 1;
      const calls = (event.data.toolCalls as { name: string }[] | undefined) ?? [];
      usage.asks += calls.filter((call) => call.name === 'ask').length;
    }
    if (event.type === 'runner.nudge') usage.nudges += 1;
    if (event.type === 'model.failed') usage.modelFailures += 1;
    if (event.type === 'completion.checked') {
      if (event.data.met === true) usage.checksPassed += 1;
      else usage.checksFailed += 1;
    }
  }
  return usage;
}

export function addUsage(a: TaskUsage, b: TaskUsage): TaskUsage {
  const sum = { ...a };
  for (const key of Object.keys(sum) as (keyof TaskUsage)[]) {
    sum[key] += b[key];
  }
  return sum;
}

export function minutesBetween(from: string, to: string | Date): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
}

// Working, not paused, and nothing has changed on it for a while.
export function isStalled(task: TaskLike, now: Date): boolean {
  return (
    task.state === 'working' &&
    !task.pausedAt &&
    minutesBetween(task.updatedAt, now) > STALE_MINUTES
  );
}

// Reply waits still open after a while. A person may simply not have answered yet, so the
// report lists these for a look rather than calling them failures outright.
export function staleReplyWaits(task: TaskLike, now: Date): WaitLike[] {
  return (task.waits ?? []).filter(
    (wait) =>
      wait.kind === 'reply' &&
      !wait.resolvedAt &&
      minutesBetween(wait.createdAt, now) > STALE_MINUTES
  );
}

// Completed without a passed completion check. Only meaningful when COMPLETION_CHECK=true.
export function unsupportedDone(task: TaskLike, usage: TaskUsage): boolean {
  return task.state === 'completed' && usage.checksPassed === 0;
}

// More than one task for the same agent and the same request message.
export function repeatedWork(tasks: TaskLike[]): number {
  const seen = new Map<string, number>();
  for (const task of tasks) {
    if (!task.requestMessageId) continue;
    const key = `${task.ownerAgentId}:${task.requestMessageId}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

// The window most of a run's requests fell in, or null if it made none.
export function majorityWindow(windows: number[]): number | null {
  const counts = new Map<number, number>();
  for (const window of windows) counts.set(window, (counts.get(window) ?? 0) + 1);
  let best: number | null = null;
  for (const [window, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = window;
  }
  return best;
}

export function money(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 3 : 2)}`;
}
