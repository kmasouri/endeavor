/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeRecurrence, scheduleInstant } from './schedules.ts';

const calendar = {
  intervalMinutes: null,
  recurrence: {
    frequency: 'weekly' as const,
    days: [1],
    time: '00:30',
    timeZone: 'America/New_York'
  }
};

test('Eastern and Pacific viewers see the same run on different dates and weekdays', () => {
  const instant = '2026-10-26T04:30:00Z';
  const east = scheduleInstant(instant, 'America/New_York');
  const west = scheduleInstant(instant, 'America/Los_Angeles');
  assert.match(east, /Mon.*Oct 26.*12:30.*AM/);
  assert.match(west, /Sun.*Oct 25.*9:30.*PM/);
  // Source Monday is never relabeled as Pacific Monday.
  assert.match(summarizeRecurrence(calendar), /Every Monday at 12:30.*AM.*America\/New_York/);
});
test('run display follows each viewer through DST without modifying source recurrence', () => {
  assert.match(scheduleInstant('2026-03-08T13:00:00Z', 'America/New_York'), /9:00.*AM.*EDT/);
  assert.match(scheduleInstant('2026-03-08T13:00:00Z', 'America/Los_Angeles'), /6:00.*AM.*PDT/);
  assert.match(scheduleInstant('2026-11-01T14:00:00Z', 'America/New_York'), /9:00.*AM.*EST/);
  assert.match(scheduleInstant('2026-11-01T14:00:00Z', 'America/Los_Angeles'), /6:00.*AM.*PST/);
});
test('source recurrence and actual instants respect the selected hour format', () => {
  assert.match(summarizeRecurrence(calendar, false), /Monday at 0[0]?:30/);
  assert.match(scheduleInstant('2026-10-26T04:30:00Z', 'America/Los_Angeles', false), /21:30/);
  assert.equal(summarizeRecurrence({ intervalMinutes: 5, recurrence: null }), 'Every 5 minutes');
});
