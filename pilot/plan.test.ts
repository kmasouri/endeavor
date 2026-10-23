import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeFailure,
  ENDPOINTS,
  parseBrokenLines,
  scoreRun,
  SEEDED_FAILURES,
  WINDOW_COUNT,
  windowAt
} from './plan.ts';

test('every seeded failure is on a real endpoint, inside the pilot, and they never overlap', () => {
  const paths = ENDPOINTS.map((endpoint) => endpoint.path);
  const used = new Set<number>();
  for (const failure of SEEDED_FAILURES) {
    assert.ok(paths.includes(failure.path), failure.id);
    for (const window of failure.windows) {
      assert.ok(window >= 0 && window < WINDOW_COUNT, `${failure.id} window ${window}`);
      assert.ok(!used.has(window), `window ${window} has two failures`);
      used.add(window);
    }
  }
  assert.equal(SEEDED_FAILURES.length, 5);
  // Most runs see a healthy API, so false alarms can show up.
  assert.ok(WINDOW_COUNT - used.size >= 8);
});

test('activeFailure matches the path without its query string, only in its windows', () => {
  assert.equal(activeFailure('/api/products', 2)?.id, 'F1');
  assert.equal(activeFailure('/api/products', 4), null);
  assert.equal(activeFailure('/api/products/1', 2), null);
  assert.equal(activeFailure('/api/users/me?x=1', 9)?.id, 'F3');
  assert.equal(activeFailure('/api/users/me', -1), null);
});

test('windowAt counts whole intervals from the start', () => {
  const start = new Date('2026-10-23T10:00:00Z');
  assert.equal(windowAt(new Date('2026-10-23T09:59:00Z'), start, 10), -1);
  assert.equal(windowAt(new Date('2026-10-23T10:00:00Z'), start, 10), 0);
  assert.equal(windowAt(new Date('2026-10-23T10:19:59Z'), start, 10), 1);
  assert.equal(windowAt(new Date('2026-10-23T10:20:00Z'), start, 10), 2);
});

test('parseBrokenLines reads the report format and ignores other mentions', () => {
  const text = [
    'Checked 8 endpoints.',
    'BROKEN: /api/products - status 500 - the database is likely down',
    '- **BROKEN:** `/api/search?q=lamp` - wrong results',
    '/api/health is fine, not broken',
    'Note: BROKEN: is the format we use',
    'Broken: /api/version. Likely cause?',
    'BROKEN: /api/inventory. negative stock'
  ].join('\n');
  assert.deepEqual(parseBrokenLines(text), ['/api/products', '/api/search', '/api/inventory']);
  assert.deepEqual(parseBrokenLines('ALL OK'), []);
});

test('scoreRun counts caught, missed, and false alarms', () => {
  const score = scoreRun(5, ['/api/health']);
  assert.deepEqual(
    score.missed.map((failure) => failure.id),
    ['F2']
  );
  assert.deepEqual(score.falseAlarms, ['/api/health']);

  const good = scoreRun(5, ['/api/orders/recent']);
  assert.deepEqual(
    good.caught.map((failure) => failure.id),
    ['F2']
  );
  assert.deepEqual(good.falseAlarms, []);

  assert.deepEqual(scoreRun(0, []), { window: 0, caught: [], missed: [], falseAlarms: [] });
});
