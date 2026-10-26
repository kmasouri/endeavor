import { AgentVersion, Task, TaskEvent } from '../../shared/types';
import { dollars } from './pricing';
import { TASK_EVENTS } from './task-events';

// Checks a task against its version's limits. Returns why it is over, or null.
export function findBudgetOverrun(
  task: Task,
  version: AgentVersion,
  events: TaskEvent[],
  defaultMaxTurns: number,
  now: Date = new Date(),
  defaultMaxCostUsd?: number
): string | null {
  // A version can lower the runner's turn limit, never raise it.
  const maxTurns = Math.min(version.limits.maxModelTurns ?? defaultMaxTurns, defaultMaxTurns);
  const turns = countEventsOfType(events, TASK_EVENTS.modelTurn);
  if (turns >= maxTurns) {
    return `Reached the limit of ${maxTurns} model turns.`;
  }

  if (version.limits.maxTokens !== undefined) {
    const tokens = sumTokens(events);
    if (tokens >= version.limits.maxTokens) {
      return `Used ${tokens} of the ${version.limits.maxTokens}-token budget.`;
    }
  }

  // Only known costs count: a model with no price can't be held to a dollar budget.
  const maxCostUsd = version.limits.maxCostUsd ?? defaultMaxCostUsd;
  if (maxCostUsd !== undefined) {
    const spentUsd = sumKnownCostUsd(events);
    if (spentUsd >= maxCostUsd) {
      return `Spent ${dollars(spentUsd)} of the ${dollars(maxCostUsd)} budget for one task.`;
    }
  }

  if (version.limits.maxWorkingMinutes !== undefined) {
    const minutes = measureWorkingMs(task, events, now) / 60_000;
    if (minutes >= version.limits.maxWorkingMinutes) {
      return `Worked ${Math.floor(minutes)} of the ${version.limits.maxWorkingMinutes} allowed minutes.`;
    }
  }
  return null;
}

// Time the task spent working and not paused, from its history. Waiting doesn't count.
export function measureWorkingMs(
  task: Pick<Task, 'createdAt'>,
  events: TaskEvent[],
  now: Date
): number {
  let isWorking = true;
  let isPaused = false;
  let periodStart = task.createdAt.getTime();
  let totalMs = 0;
  const startPeriod = (at: number, nextIsWorking: boolean, nextIsPaused: boolean) => {
    if (isWorking && !isPaused) {
      totalMs += at - periodStart;
    }
    periodStart = at;
    isWorking = nextIsWorking;
    isPaused = nextIsPaused;
  };
  for (const event of events) {
    const at = event.createdAt.getTime();
    if (event.type === TASK_EVENTS.stateChanged) {
      startPeriod(at, event.data.to === 'working', isPaused);
    } else if (event.type === TASK_EVENTS.paused) {
      startPeriod(at, isWorking, true);
    } else if (event.type === TASK_EVENTS.resumed) {
      startPeriod(at, isWorking, false);
    }
  }
  startPeriod(now.getTime(), isWorking, isPaused);
  return totalMs;
}

export function countEventsOfType(events: TaskEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

// Counts events of one type since the last event of the reset type.
export function countEventsSinceLast(events: TaskEvent[], type: string, resetType: string): number {
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

// Model calls are the turns themselves and the separate completion checks.
function listModelCallEvents(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (event) => event.type === TASK_EVENTS.modelTurn || event.type === TASK_EVENTS.completionChecked
  );
}

function sumTokens(events: TaskEvent[]): number {
  return listModelCallEvents(events).reduce((sum, event) => {
    const usage = event.data.usage as { inputTokens?: number; outputTokens?: number } | undefined;
    return sum + (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  }, 0);
}

// What a task has spent so far, counting only model calls with a known price.
function sumKnownCostUsd(events: TaskEvent[]): number {
  return listModelCallEvents(events).reduce(
    (sum, event) => sum + (typeof event.data.costUsd === 'number' ? event.data.costUsd : 0),
    0
  );
}
