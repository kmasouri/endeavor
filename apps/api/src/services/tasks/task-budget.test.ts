import { AgentVersion, Task, TaskEvent } from '../../shared/types';
import { findBudgetOverrun, measureWorkingMs } from './task-budget';

const version: AgentVersion = {
  id: 'v-1',
  agentId: 'a-1',
  version: 1,
  instructions: 'Research carefully.',
  provider: 'scripted',
  model: 'script',
  skillVersionIds: [],
  connectionIds: [],
  limits: {},
  createdByHumanId: 'h-1',
  createdAt: new Date()
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return { createdAt: new Date(), ...overrides } as Task;
}

function event(id: number, type: string, data: Record<string, unknown>): TaskEvent {
  return {
    id,
    taskId: 't-1',
    type,
    actor: { type: 'system', id: null },
    data,
    createdAt: new Date()
  };
}

describe('budgets', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 12, minutes));
  const timed = (id: number, type: string, data: Record<string, unknown>, minutes: number) => ({
    ...event(id, type, data),
    createdAt: at(minutes)
  });

  it('counts only working, unpaused time', () => {
    const events = [
      timed(1, 'task.state.changed', { to: 'waiting' }, 10),
      timed(2, 'task.state.changed', { to: 'working' }, 70),
      timed(3, 'task.paused', {}, 75),
      timed(4, 'task.resumed', {}, 100)
    ];

    // Working 0-10, then 70-75, then 100-110.
    expect(measureWorkingMs({ createdAt: at(0) }, events, at(110)) / 60_000).toBe(25);
  });

  it('blocks on tokens once the budget is used', () => {
    const limited = { ...version, limits: { maxTokens: 1000 } };
    const events = [
      event(1, 'model.turn', { usage: { inputTokens: 600, outputTokens: 100 } }),
      event(2, 'model.turn', { usage: { inputTokens: 250, outputTokens: 60 } })
    ];

    expect(findBudgetOverrun(makeTask(), limited, events, 40)).toBe(
      'Used 1010 of the 1000-token budget.'
    );
    expect(findBudgetOverrun(makeTask(), version, events, 40)).toBeNull();
  });

  it("never lets a version raise the runner's turn limit", () => {
    const events = Array.from({ length: 40 }, (_, i) => event(i + 1, 'model.turn', {}));

    expect(
      findBudgetOverrun(makeTask(), { ...version, limits: { maxModelTurns: 1000 } }, events, 40)
    ).toBe('Reached the limit of 40 model turns.');
  });

  it("uses the version's turn limit over the runner default", () => {
    const events = [event(1, 'model.turn', {}), event(2, 'model.turn', {})];

    expect(
      findBudgetOverrun(makeTask(), { ...version, limits: { maxModelTurns: 2 } }, events, 40)
    ).toBe('Reached the limit of 2 model turns.');
  });

  it('blocks on working minutes', () => {
    const task = makeTask({ createdAt: at(0) });

    expect(
      findBudgetOverrun(task, { ...version, limits: { maxWorkingMinutes: 30 } }, [], 40, at(31))
    ).toBe('Worked 31 of the 30 allowed minutes.');
  });
});
