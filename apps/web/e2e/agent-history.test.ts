import { captureReviewScreenshot } from './review-screenshot';
import { expect, test, type Page } from '@playwright/test';
import type { TaskActivity } from '../src/api';

const createdAt = '2026-10-24T12:00:00Z';
const agent = (id: string, name: string) => ({
  id,
  name,
  purpose: name,
  currentVersionId: 'v1',
  currentVersion: { id: 'v1' },
  disabledAt: null
});
const agents = [agent('researcher', 'Researcher'), agent('reviewer', 'Reviewer')];
const conversations = [
  { id: 'heat', title: 'heat-pumps', createdAt },
  { id: 'site', title: 'website-check', createdAt }
];
const makeTask = (
  id: string,
  ownerAgentId = 'researcher',
  conversationId: string | null = 'heat'
) => ({
  id,
  ownerAgentId,
  conversationId,
  title: `Request ${id}`,
  activity: null as TaskActivity | null,
  brief: `Brief for ${id}`,
  completionCriteria: `Criteria for ${id}`,
  state: 'completed',
  stateReason: null,
  agentVersionId: 'v1',
  pausedAt: null as string | null,
  requestedByType: 'human',
  requestedById: 'person',
  parentTaskId: null,
  restartedFromTaskId: null,
  responsibilityId: null,
  reviewRequired: false,
  criteriaCheck: { met: true, summary: 'Checked the sources' },
  review: null,
  waits: [],
  createdAt,
  updatedAt: createdAt,
  finishedAt: createdAt
});
const message = (id: string, taskId: string | null, authorId = 'researcher') => ({
  id,
  taskId,
  authorId,
  authorType: 'agent',
  body: `Answer ${id}`,
  mentions: [],
  inReplyToMessageId: null,
  createdAt
});

async function fixture(page: Page, theme = 'dark') {
  const state = {
    failHistory: false,
    failOutputs: false,
    emptyHistory: false,
    slowHistory: false,
    failRevision: false,
    largeEvents: false,
    writes: [] as { path: string; body: Record<string, unknown> }[],
    queries: [] as string[],
    tasks: [
      makeTask('old'),
      makeTask('new'),
      makeTask('review', 'reviewer'),
      makeTask('other', 'researcher', 'site'),
      makeTask('standalone', 'researcher', null)
    ],
    messages: [
      message('old-message', 'old'),
      message('new-message', 'new'),
      message('review-message', 'review', 'reviewer'),
      message('legacy-message', null)
    ]
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'person'));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const list = (data: unknown[], total = data.length) =>
      reply({
        data,
        page: { total, offset: Number(url.searchParams.get('offset') ?? 0), limit: 1 }
      });
    if (req.method() !== 'GET') {
      const action = /^\/tasks\/([^/]+)\/(pause|resume|cancel)$/.exec(url.pathname);
      if (action) {
        const task = state.tasks.find((t) => t.id === action[1])!;
        if (action[2] === 'pause') task.pausedAt = createdAt;
        if (action[2] === 'resume') task.pausedAt = null;
        if (action[2] === 'cancel') task.state = 'cancelled';
      }
      state.writes.push({ path: url.pathname, body: req.postData() ? req.postDataJSON() : {} });
      if (url.pathname.endsWith('/restart')) {
        if (state.failRevision) return reply({ error: { message: 'Try the revision again' } }, 503);
        return reply({ data: makeTask('revision') });
      }
      return reply({ data: {} });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [
          { id: 'person', name: 'Kayvan', role: 'admin', preferences: { theme, timeFormat: '12h' } }
        ]
      });
    if (url.pathname === '/agents') return list(agents);
    if (url.pathname === '/directory') return reply({ data: agents });
    if (url.pathname.endsWith('/versions')) return reply({ data: [{ id: 'v1', version: 1 }] });
    if (url.pathname === '/conversations') return list(conversations);
    if (url.pathname === '/conversations/heat' || url.pathname === '/conversations/site') {
      const conversation = conversations.find((c) => url.pathname.endsWith(c.id))!;
      return reply({
        data: {
          ...conversation,
          members: [
            { participant: { type: 'human', id: 'person' }, name: 'Kayvan', historyFrom: null },
            ...agents.map((a) => ({
              participant: { type: 'agent', id: a.id },
              name: a.name,
              historyFrom: null
            }))
          ]
        }
      });
    }
    if (url.pathname.endsWith('/messages'))
      return list(url.pathname.includes('/heat/') ? state.messages : []);
    if (url.pathname.endsWith('/costs'))
      return reply({
        data: {
          total: { costUsd: 0.18, tokens: 20 },
          thisMonth: { costUsd: 0.18 },
          budgetUsd: 1,
          tasks: state.tasks.map((t) => ({ taskId: t.id, costUsd: 0.06 }))
        }
      });
    if (url.pathname === '/tasks') {
      state.queries.push(url.search);
      let tasks = state.tasks.filter(
        (t) =>
          !url.searchParams.has('conversationId') ||
          t.conversationId === url.searchParams.get('conversationId')
      );
      if (url.searchParams.has('ownerAgentId')) {
        if (state.slowHistory) await new Promise((resolve) => setTimeout(resolve, 250));
        if (state.failHistory) return reply({ error: { message: 'History unavailable' } }, 503);
        if (state.emptyHistory) return list([]);
        tasks = tasks
          .filter((t) => t.ownerAgentId === url.searchParams.get('ownerAgentId'))
          .reverse();
        const offset = Number(url.searchParams.get('offset') ?? 0);
        // Fill the first full page to exercise the UI's page boundary.
        const rows =
          tasks.length === 2
            ? [
                ...Array.from({ length: 20 }, (_, i) => ({
                  ...tasks[0],
                  id: i ? `filler-${i}` : tasks[0].id,
                  title: i ? `Earlier ${i}` : tasks[0].title
                })),
                tasks[1]
              ]
            : tasks;
        return list(rows.slice(offset, offset + 20), rows.length);
      }
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return list(tasks.slice(offset, offset + limit), tasks.length);
    }
    const match = /^\/tasks\/([^/]+)(?:\/(outputs|events|capabilities))?$/.exec(url.pathname);
    if (match) {
      const task = state.tasks.find((t) => t.id === match[1]);
      if (!task) return reply({ error: { message: 'Run unavailable' } }, 404);
      if (match[2] === 'outputs' && state.failOutputs)
        return reply({ error: { message: 'Evidence unavailable' } }, 503);
      if (match[2] === 'outputs')
        return reply({
          data: [
            {
              id: `output-${task.id}`,
              title: `Evidence ${task.id}`,
              kind: 'document',
              content: `Result of ${task.id}`,
              uri: 'javascript:alert(1)',
              createdAt
            }
          ]
        });
      if (match[2] === 'events' && state.largeEvents) {
        const after = Number(url.searchParams.get('afterId') ?? 0);
        const all = Array.from({ length: 501 }, (_, i) => ({
          id: i + 1,
          type: i === 500 ? 'task.state.changed' : 'model.turn',
          actor: { type: 'agent', id: task.ownerAgentId },
          data: i === 500 ? { to: 'completed', reason: 'Last event beyond the first page' } : {},
          createdAt
        }));
        return reply({ data: all.filter((e) => e.id > after).slice(0, 500) });
      }
      if (match[2] === 'events')
        return reply({
          data: [
            {
              id: 1,
              type: 'task.state.changed',
              actor: { type: 'agent', id: task.ownerAgentId },
              data: { to: 'completed', reason: `Completed ${task.id}` },
              createdAt
            }
          ]
        });
      if (match[2] === 'capabilities') return reply({ data: [] });
      return reply({ data: task });
    }
    if (url.pathname.endsWith('/outputs')) return list([]);
    return list([]);
  });
  return { state, errors };
}

async function history(page: Page, name = 'Researcher') {
  await page.getByRole('button', { name: 'Show details' }).click();
  await page.getByRole('button', { name: '2 more agents' }).click();
  await page.locator('.agent-line').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
}

test('agent histories isolate owners and conversations, paginate and return from exact runs', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  await page.goto('/app/#/conversations/heat');
  await history(page);
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(panel.getByRole('button', { name: /Request new/ })).toBeVisible();
  await expect(panel).not.toContainText('Request review');
  await expect(panel).not.toContainText('Request other');
  await panel.getByRole('button', { name: 'Older runs' }).click();
  await expect(panel.getByRole('button', { name: /Request old/ })).toBeVisible();
  await panel.getByRole('button', { name: /Request old/ }).click();
  await expect(panel).toContainText('Brief for old');
  await expect(panel).toContainText('Criteria for old');
  await expect(panel).toContainText('Result of old');
  await expect(panel).toContainText('Completed old');
  await expect(page.locator('#m-old-message')).toHaveClass(/selected-run/);
  await expect(page.locator('.thread')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'javascript:alert(1)' })).toHaveCount(0);
  await panel.getByRole('button', { name: "← Researcher's history" }).click();
  await expect(panel.getByRole('button', { name: /Request new/ })).toBeVisible();
  await panel.getByRole('button', { name: '← Details', exact: true }).click();
  await page.getByRole('button', { name: '2 more agents' }).click();
  await page.locator('.agent-line').filter({ hasText: 'Reviewer' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(panel.getByRole('button', { name: /Request review/ })).toBeVisible();
  await expect(panel).not.toContainText('Request new');
  expect(
    state.queries.some(
      (q) => q.includes('conversationId=heat') && q.includes('ownerAgentId=reviewer')
    )
  ).toBe(true);
  await page.goto('/app/#/conversations/site');
  await history(page);
  await expect(panel.getByRole('button', { name: /Request other/ })).toBeVisible();
  await expect(panel).not.toContainText('Request old');
  expect(errors).toEqual([]);
});

test('message inspection opens its recorded run, keeps drafts, and explains legacy messages', async ({
  page
}) => {
  const { errors } = await fixture(page);
  await page.goto('/app/#/conversations/heat');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my draft');
  await page.locator('#m-old-message').hover();
  await page
    .locator('#m-old-message')
    .getByRole('button', { name: 'See what this agent did' })
    .click();
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(panel).toContainText('Brief for old');
  await expect(panel).not.toContainText('Brief for new');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep my draft'
  );
  await page.locator('#m-legacy-message').hover();
  await page
    .locator('#m-legacy-message')
    .getByRole('button', { name: 'See what this agent did' })
    .click();
  await expect(panel).toContainText('No run was recorded for this message');
  await expect(panel).not.toContainText('Brief for new');
  expect(errors).toEqual([]);
});

test('history loading, errors, retry and empty states', async ({ page }) => {
  const { state } = await fixture(page);
  state.failHistory = true;
  state.slowHistory = true;
  await page.goto('/app/#/conversations/heat');
  await history(page);
  await expect(page.getByText('Loading history…')).toBeVisible();
  await expect(page.getByText('History unavailable')).toBeVisible();
  state.failHistory = false;
  state.emptyHistory = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('No runs in this conversation yet.')).toBeVisible();
});

test('revision uses the composer and exact finished run, preserving input after failure', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  await page.goto('/app/#/conversations/heat?run=old');
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await panel.getByRole('button', { name: 'Ask for changes', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('@Researcher Please revise "Request old": ');
  await input.fill('@Researcher Add citations');
  state.failRevision = true;
  await page.getByRole('button', { name: 'Send changes' }).click();
  await expect(page.getByText('Try the revision again')).toBeVisible();
  await expect(input).toHaveValue('@Researcher Add citations');
  state.failRevision = false;
  await page.getByRole('button', { name: 'Send changes' }).click();
  await expect(input).toHaveValue('');
  expect(state.writes.filter((w) => w.path.endsWith('/restart'))).toEqual([
    { path: '/tasks/old/restart', body: { reason: '@Researcher Add citations' } },
    { path: '/tasks/old/restart', body: { reason: '@Researcher Add citations' } }
  ]);
  expect(state.writes.filter((w) => w.path.endsWith('/messages'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('direct links retain conversation inspection and standalone runs are read-only', async ({
  page
}) => {
  const { errors } = await fixture(page);
  await page.goto('/app/#/tasks/old');
  await expect(page).toHaveURL(/conversations\/heat\?run=old/);
  await expect(page.getByRole('complementary', { name: 'Conversation details' })).toContainText(
    'Brief for old'
  );
  await page.goto('/app/#/tasks/standalone');
  await expect(page.locator('.standalone-run')).toContainText('Brief for standalone');
  await expect(page.getByRole('button', { name: 'Restart as a new run' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask for changes' })).toHaveCount(0);
  await expect(
    page.locator('.sidebar').getByRole('link', { name: 'Work', exact: true })
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a foreign conversation run cannot appear in the selected conversation', async ({ page }) => {
  await fixture(page);
  await page.goto('/app/#/conversations/heat?run=other');
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(panel).toContainText('This run does not belong to this Endeavor.');
  await expect(panel).not.toContainText('Brief for other');
});

for (const { theme, width } of [
  { theme: 'light', width: 1440 },
  { theme: 'dark', width: 320 }
] as const) {
  test(`history and run layout ${theme} ${width}px`, async ({ page }, testInfo) => {
    const { errors } = await fixture(page, theme);
    await page.setViewportSize({ width, height: 940 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/#/conversations/heat?run=old');
    const panel = page.getByRole('complementary', { name: 'Conversation details' });
    await expect(panel).toContainText('Brief for old');
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    if (width === 1440) {
      const thread = await page.locator('.thread').boundingBox();
      expect(thread!.width).toBeGreaterThan(400);
      expect(thread!.x + thread!.width).toBeLessThanOrEqual(bounds!.x + 1);
    }
    expect(
      await panel.locator('.run-title').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x + 2, rect.y + rect.height / 2));
      }),
      'The sidebar must not cover the run title'
    ).toBe(true);
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath('run-inspection.png'),
      fullPage: true
    });
    await panel.getByRole('button', { name: "← Researcher's history" }).click();
    await expect(panel.getByRole('button', { name: /Request new/ })).toBeVisible();
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath('agent-history.png'),
      fullPage: true
    });
    await panel.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('run controls and pending result review stay available inside the conversation', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  state.tasks[0].state = 'working';
  await page.goto('/app/#/conversations/heat?run=old');
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await panel.getByRole('button', { name: 'Resume', exact: true }).click();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Restart as a new run' })).toBeVisible();
  expect(state.writes.map((w) => w.path)).toEqual(
    expect.arrayContaining(['/tasks/old/pause', '/tasks/old/resume', '/tasks/old/cancel'])
  );
  state.tasks[0].state = 'waiting';
  state.tasks[0].reviewRequired = true;
  await page.reload();
  await panel.getByRole('button', { name: 'Accept', exact: true }).click();
  expect(state.writes).toContainEqual({ path: '/tasks/old/review', body: { approved: true } });
  expect(errors).toEqual([]);
});

test('execution history includes events beyond the first API page', async ({ page }) => {
  const { state } = await fixture(page);
  state.largeEvents = true;
  await page.goto('/app/#/conversations/heat?run=old');
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(panel).toContainText('Last event beyond the first page');
  await panel.getByText('Technical events · 501', { exact: true }).click();
  await expect(panel.locator('.technical-events .events > li')).toHaveCount(501);
});

test('a slow history response cannot replace another agent after returning to Details', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  state.slowHistory = true;
  await page.goto('/app/#/conversations/heat');
  const request = page.waitForRequest((req) => req.url().includes('ownerAgentId=researcher'));
  await history(page);
  await request;
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await panel.getByRole('button', { name: '← Details', exact: true }).click();
  await page.getByRole('button', { name: '2 more agents' }).click();
  await page.locator('.agent-line').filter({ hasText: 'Reviewer' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(panel.getByRole('button', { name: /Request review/ })).toBeVisible();
  await expect(panel).not.toContainText('Request new');
  expect(errors).toEqual([]);
});

test('history and run selection work from the keyboard and Escape restores Details focus', async ({
  page
}) => {
  await fixture(page);
  await page.goto('/app/#/conversations/heat');
  await history(page);
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(panel.getByRole('button', { name: '← Details', exact: true })).toBeFocused();
  const run = panel.getByRole('button', { name: /Request new/ });
  await run.focus();
  await run.press('Enter');
  await expect(panel).toContainText('Brief for new');
  await expect(panel.getByRole('button', { name: "← Researcher's history" })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show details' })).toBeFocused();
});

test('output inspection failure retries the same run without losing the chat draft', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  state.failOutputs = true;
  await page.goto('/app/#/conversations/heat');
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep this question while I inspect the evidence.');
  await page.locator('#m-old-message').hover();
  await page
    .locator('#m-old-message')
    .getByRole('button', { name: 'See what this agent did' })
    .click();
  const panel = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(panel).toContainText('Brief for old');
  await expect(panel.getByText('Evidence unavailable', { exact: true })).toBeVisible();
  await expect(panel.getByText('Result of new', { exact: true })).toHaveCount(0);
  state.failOutputs = false;
  await panel.getByRole('button', { name: 'Retry outputs', exact: true }).click();
  await expect(panel.getByText('Result of old', { exact: true })).toBeVisible();
  await expect(panel.getByText('Evidence unavailable', { exact: true })).toHaveCount(0);
  await expect(draft).toHaveValue('Keep this question while I inspect the evidence.');
  await panel.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByRole('button', { name: 'Show details' })).toBeFocused();
  expect(state.writes.filter((write) => !write.path.endsWith('/read'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('live status shows independent steps, elapsed time and plain stopped states at 320px', async ({
  page
}) => {
  const width = 320;
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = new Date('2026-10-24T12:00:00Z');
  await page.clock.install({ time: now });
  const { state, errors } = await fixture(page);
  const since = new Date(now.getTime() - 18_000).toISOString();
  const first = state.tasks[0];
  first.state = 'working';
  first.activity = { kind: 'reading', detail: 'reading sources/air-source-heat-pump.md', since };
  const second = state.tasks[2];
  second.state = 'working';
  second.activity = { kind: 'connection', detail: 'calling a connection', since };
  await page.goto('/app/#/conversations/heat');
  const live = page.locator('.live-status');
  await expect(live).toContainText('Researcher is skimming');
  await expect(live).toContainText('reading sources/air-source-heat-pump.md');
  await expect(live).toContainText('Reviewer is poking the API');
  await expect(live.locator(':scope > span')).toHaveCount(2);
  await captureReviewScreenshot(page, { path: test.info().outputPath('live-agent-status.png') });
  const elapsed = live.locator('.muted[aria-hidden="true"]').first();
  const before = await elapsed.innerText();
  await page.clock.fastForward(1001);
  await expect(elapsed).not.toHaveText(before);
  const geometry = await live.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, scroll: el.scrollWidth, width: el.clientWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(width);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  first.pausedAt = since;
  second.state = 'blocked';
  await page.clock.fastForward(4001);
  await expect(live).toContainText('Researcher is paused');
  await expect(live).toContainText('Reviewer is stuck');
  await expect(live).not.toContainText('skimming');
  first.pausedAt = null;
  first.state = 'waiting';
  await page.clock.fastForward(4001);
  await expect(live).toContainText('Researcher is waiting');
  first.state = 'completed';
  second.state = 'completed';
  await page.clock.fastForward(4001);
  await expect(live).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an older active run still shows after more than 100 newer completed runs', async ({
  page
}) => {
  const { state } = await fixture(page);
  state.tasks = Array.from({ length: 101 }, (_, i) => makeTask(`run-${i}`));
  state.tasks[100].state = 'working';
  state.tasks[100].activity = {
    kind: 'writing',
    detail: 'writing brief.md',
    since: new Date().toISOString()
  };
  await page.goto('/app/#/conversations/heat');
  await expect(page.locator('.live-status')).toContainText('writing brief.md');
  expect(state.queries.some((query) => query.includes('offset=100'))).toBe(true);
});
