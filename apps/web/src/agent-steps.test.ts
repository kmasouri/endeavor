import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskEvent } from './api';
import { buildAgentSteps } from './agent-steps.ts';
const event = (id: number, type: string, data: Record<string, unknown>): TaskEvent => ({
  id,
  type,
  data,
  actor: { type: 'agent', id: 'a1' },
  createdAt: '2026-10-24T18:00:00Z'
});

test('chat steps summarize actual requests and outputs without raw event or response text', () => {
  const steps = buildAgentSteps([
    event(1, 'task.created', {}),
    event(2, 'model.turn', {
      text: 'Private model text',
      raw: [{ secret: 'not for chat' }],
      toolCalls: [
        {
          id: 'search',
          name: 'http_request',
          input: { connection: 'Wikipedia', path: '/w/api.php?list=search&srsearch=mRNA+vaccines' }
        },
        { id: 'read', name: 'http_request', input: { connection: 'Wikipedia' } }
      ]
    }),
    event(3, 'connection.called', {
      callId: 'search',
      method: 'GET',
      path: '/w/api.php?list=search&srsearch=mRNA+vaccines',
      status: 200
    }),
    event(4, 'connection.called', {
      callId: 'read',
      method: 'GET',
      path: '/w/api.php?titles=MRNA_vaccine',
      status: 200
    }),
    event(5, 'tool.results', {
      results: [{ callId: 'read', content: 'HTTP 200 {"raw":"huge JSON payload"}', isError: false }]
    }),
    event(6, 'task.output.added', { title: 'How mRNA vaccines work' }),
    event(7, 'task.output.added', { title: 'Result' }),
    event(8, 'task.state.changed', { to: 'completed' })
  ]);
  assert.deepEqual(
    steps.map((s) => s.title),
    [
      'Searched for “mRNA vaccines”',
      'Read MRNA vaccine',
      'Saved How mRNA vaccines work',
      'Completed the work'
    ]
  );
  assert.ok(!JSON.stringify(steps).includes('Private model'));
  assert.ok(!JSON.stringify(steps).includes('huge JSON'));
});

test('a proposed request does not appear as completed before a recorded call', () => {
  assert.deepEqual(
    buildAgentSteps([
      event(1, 'model.turn', {
        toolCalls: [{ id: 'call', name: 'http_request', input: { connection: 'Wikipedia' } }]
      })
    ]),
    []
  );
});

test('help, failed calls, and blocked work remain clear and plain', () => {
  const steps = buildAgentSteps([
    event(1, 'model.turn', {
      toolCalls: [{ id: 'ask', name: 'ask', input: { to: 'Reviewer' } }]
    }),
    event(2, 'tool.results', {
      results: [{ callId: 'ask', isError: false, content: 'Internal message id and raw response' }]
    }),
    event(3, 'connection.called', { method: 'GET', path: '/status', status: 503 }),
    event(4, 'task.state.changed', { to: 'blocked', reason: 'The service is unavailable.' })
  ]);
  assert.equal(steps[0].title, 'Asked Reviewer for help');
  assert.equal(steps[1].kind, 'error');
  assert.equal(steps[1].detail, 'HTTP 503');
  assert.equal(steps[2].detail, 'The service is unavailable.');
});

test('unexpected metadata is ignored without exposing raw payloads', () => {
  assert.deepEqual(
    buildAgentSteps([
      event(1, 'model.turn', { toolCalls: [null, 3, 'raw'] }),
      event(2, 'tool.results', { results: [null, 'raw'] })
    ]),
    []
  );
});
