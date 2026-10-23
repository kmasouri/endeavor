import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isStalled,
  majorityWindow,
  repeatedWork,
  staleReplyWaits,
  type TaskLike,
  taskUsage,
  unsupportedDone
} from './metrics.ts';

const NOW = new Date('2026-10-23T12:00:00Z');

function task(overrides: Partial<TaskLike> = {}): TaskLike {
  return {
    id: 't1',
    ownerAgentId: 'a1',
    state: 'working',
    stateReason: null,
    pausedAt: null,
    requestMessageId: 'm1',
    createdAt: '2026-10-23T11:00:00Z',
    updatedAt: '2026-10-23T11:59:00Z',
    finishedAt: null,
    ...overrides
  };
}

test('taskUsage adds up cost, tokens, asks, and checks', () => {
  const usage = taskUsage([
    {
      type: 'model.turn',
      createdAt: '',
      data: {
        costUsd: 0.01,
        usage: { inputTokens: 100, outputTokens: 20 },
        toolCalls: [{ name: 'ask' }, { name: 'http_request' }]
      }
    },
    { type: 'model.turn', createdAt: '', data: { costUsd: null, usage: { inputTokens: 5 } } },
    { type: 'completion.checked', createdAt: '', data: { met: false, costUsd: 0.002 } },
    { type: 'completion.checked', createdAt: '', data: { met: true, costUsd: 0.002 } },
    { type: 'runner.nudge', createdAt: '', data: {} },
    { type: 'model.failed', createdAt: '', data: {} }
  ]);
  assert.equal(usage.costUsd.toFixed(3), '0.014');
  assert.equal(usage.tokens, 125);
  assert.equal(usage.unpricedCalls, 1);
  assert.equal(usage.modelTurns, 2);
  assert.equal(usage.asks, 1);
  assert.equal(usage.checksFailed, 1);
  assert.equal(usage.checksPassed, 1);
  assert.equal(usage.nudges, 1);
  assert.equal(usage.modelFailures, 1);
});

test('isStalled only flags working, unpaused tasks quiet for 15+ minutes', () => {
  assert.equal(isStalled(task({ updatedAt: '2026-10-23T11:40:00Z' }), NOW), true);
  assert.equal(isStalled(task(), NOW), false);
  assert.equal(
    isStalled(task({ updatedAt: '2026-10-23T11:40:00Z', state: 'waiting' }), NOW),
    false
  );
  assert.equal(
    isStalled(task({ updatedAt: '2026-10-23T11:40:00Z', pausedAt: '2026-10-23T11:40:00Z' }), NOW),
    false
  );
});

test('staleReplyWaits finds open reply waits older than 15 minutes', () => {
  const waits = [
    { kind: 'reply', createdAt: '2026-10-23T11:30:00Z', resolvedAt: null },
    { kind: 'reply', createdAt: '2026-10-23T11:55:00Z', resolvedAt: null },
    { kind: 'reply', createdAt: '2026-10-23T11:00:00Z', resolvedAt: '2026-10-23T11:05:00Z' },
    { kind: 'approval', createdAt: '2026-10-23T11:00:00Z', resolvedAt: null }
  ];
  assert.equal(staleReplyWaits(task({ waits }), NOW).length, 1);
});

test('unsupportedDone flags completed tasks with no passed check', () => {
  const none = taskUsage([]);
  const passed = taskUsage([{ type: 'completion.checked', createdAt: '', data: { met: true } }]);
  assert.equal(unsupportedDone(task({ state: 'completed' }), none), true);
  assert.equal(unsupportedDone(task({ state: 'completed' }), passed), false);
  assert.equal(unsupportedDone(task(), none), false);
});

test('repeatedWork counts extra tasks for the same agent and request', () => {
  assert.equal(
    repeatedWork([
      task({ id: 'a' }),
      task({ id: 'b' }),
      task({ id: 'c', ownerAgentId: 'a2' }),
      task({ id: 'd', requestMessageId: null }),
      task({ id: 'e', requestMessageId: null })
    ]),
    1
  );
});

test('majorityWindow picks the most common window', () => {
  assert.equal(majorityWindow([]), null);
  assert.equal(majorityWindow([3, 3, 4]), 3);
  assert.equal(majorityWindow([4]), 4);
});
