/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endeavorDetails } from './endeavor-details.ts';

const projects = [{ id: 'p1', name: 'Finance reporting' }];
const now = new Date('2026-11-21T12:00:00');
const day = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));

test('shows the project, closed state, and start date', () => {
  const createdAt = '2026-11-14T12:00:00';
  assert.equal(
    endeavorDetails({ createdAt, projectId: 'p1', state: 'closed' }, projects, now),
    `Finance reporting · Closed · ${day(createdAt)}`
  );
});

test('open endeavors and endeavors without a project leave those parts out', () => {
  const createdAt = '2026-11-14T12:00:00';
  assert.equal(endeavorDetails({ createdAt, projectId: 'p1', state: 'open' }, projects, now), `Finance reporting · ${day(createdAt)}`);
  assert.equal(endeavorDetails({ createdAt, projectId: null }, projects, now), day(createdAt));
});

test('dates from another year include the year', () => {
  const createdAt = '2025-03-02T12:00:00';
  const expected = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(createdAt));
  assert.equal(endeavorDetails({ createdAt }, projects, now), expected);
});
