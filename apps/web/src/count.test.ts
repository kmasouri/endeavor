/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { count } from './count.ts';

test('one takes the singular noun', () => {
  assert.equal(count(1, 'agent'), '1 agent');
  assert.equal(count(1, 'person', 'people'), '1 person');
});

test('zero and many take the plural noun', () => {
  assert.equal(count(0, 'agent'), '0 agents');
  assert.equal(count(2, 'person', 'people'), '2 people');
  assert.equal(count(12000, 'token'), `${(12000).toLocaleString()} tokens`);
});
