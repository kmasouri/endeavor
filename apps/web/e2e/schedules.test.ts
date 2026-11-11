import { expect, test, type Page } from '@playwright/test';

const baseSchedule = {
  agentId: 'agent-1',
  projectId: 'project-1',
  brief: 'Check the test API.',
  completionCriteria: 'Report failures.',
  intervalMinutes: 10,
  recurrence: null,
  missedRunPolicy: 'ask',
  nextRunAt: '2026-10-26T13:00:00Z',
  lastRunAt: null,
  catchUp: null
};
const schedules = [
  { ...baseSchedule, id: 'enabled', title: 'Enabled check', status: 'enabled' },
  { ...baseSchedule, id: 'paused', title: 'Paused check', status: 'paused' },
  { ...baseSchedule, id: 'cancelled', title: 'Cancelled check', status: 'cancelled' }
];

type Mode = 'populated' | 'cancelled' | 'empty' | 'error';
async function mockApi(
  page: Page,
  theme: 'dark' | 'light',
  mode: Mode = 'populated',
  legacy = false
) {
  await page.addInitScript(
    ({ theme, legacy }) => {
      if (sessionStorage.getItem('identity-seeded')) return;
      sessionStorage.setItem('identity-seeded', 'true');
      const prefix = legacy ? 'collaborative-agents' : 'endeavor';
      localStorage.setItem(`${prefix}.actorId`, 'person-1');
      localStorage.setItem(`${prefix}.theme`, theme);
    },
    { theme, legacy }
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // Keep font loading and other outside services out of deterministic layout checks.
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const paged = (data: unknown[]) => ({
      data,
      page: { limit: 100, offset: 0, total: data.length }
    });
    if (url.pathname === '/humans') {
      return reply({
        data: [
          {
            id: 'person-1',
            name: 'Kayvan',
            role: 'admin',
            preferences: { theme, timeFormat: '12h' }
          }
        ]
      });
    }
    if (url.pathname === '/agents') {
      return reply(
        paged([
          {
            id: 'agent-1',
            name: 'Checker',
            purpose: 'Check APIs',
            disabledAt: null,
            currentVersionId: 'version-1'
          }
        ])
      );
    }
    if (url.pathname === '/projects') {
      return reply(paged(url.searchParams.get('archived') === 'true' ? [] : [
        { id: 'project-1', name: 'General', isDefault: true, archivedAt: null }
      ]));
    }
    if (url.pathname === '/responsibilities') {
      if (mode === 'error') return reply({ error: { message: 'Schedules unavailable' } }, 503);
      let data =
        mode === 'empty'
          ? []
          : mode === 'cancelled'
            ? schedules.filter((s) => s.status === 'cancelled')
            : schedules;
      if (url.searchParams.has('status'))
        data = data.filter((s) => s.status === url.searchParams.get('status'));
      return reply(paged(data));
    }
    return reply(paged([]));
  });
}

async function expectSingleLineBadges(page: Page) {
  const rows = page.locator('.schedule-row:visible');
  await expect(rows).toHaveCount(3);
  const metrics = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const badge = row.querySelector<HTMLElement>('.schedule-badge')!;
      const icon = badge.querySelector<HTMLElement>('[aria-hidden]')!;
      const next = row.querySelector<HTMLElement>('.schedule-next')!;
      const chevron = row.lastElementChild!;
      const label = [...badge.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      )!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const bounds = badge.getBoundingClientRect();
      const iconBounds = icon.getBoundingClientRect();
      return {
        status: badge.textContent?.trim(),
        display: getComputedStyle(badge).display,
        sameLine:
          Math.abs((iconBounds.top + iconBounds.bottom) / 2 - (text.top + text.bottom) / 2) < 4,
        contained: text.left >= bounds.left && text.right <= bounds.right + 1,
        separated:
          next.getBoundingClientRect().right <= bounds.left &&
          bounds.right <= chevron.getBoundingClientRect().left,
        height: bounds.height,
        badgeRight: bounds.right,
        nextRight: next.getBoundingClientRect().right
      };
    })
  );
  for (const badge of metrics) {
    expect(badge.display, badge.status).toMatch(/^(inline-)?flex$/);
    expect(badge.sameLine, badge.status).toBe(true);
    expect(badge.contained, badge.status).toBe(true);
    expect(badge.height, badge.status).toBeLessThan(30);
    if (await page.locator('.schedules-page').evaluate((el) => el.clientWidth > 650)) {
      expect(badge.separated, badge.status).toBe(true);
      expect(Math.abs(badge.badgeRight - metrics[0].badgeRight)).toBeLessThan(1);
      expect(Math.abs(badge.nextRight - metrics[0].nextRight)).toBeLessThan(1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const { theme, width } of [
  { theme: 'light', width: 2515 },
  { theme: 'light', width: 1024 },
  { theme: 'dark', width: 390 }
] as const) {
  test(`status badges stay on one line in the production bundle: ${theme}, ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockApi(page, theme);
    await page.goto('/app/#/schedules');
    await expectSingleLineBadges(page);
    await page.getByRole('button', { name: /Cancelled check/ }).click();
    const badge = page.locator('.schedule-badge');
    await expect(badge).toContainText('Cancelled');
    await expect(badge).toHaveCSS('display', /^(inline-)?flex$/);
  });
}

test('wide layout shares a centered frame with a persistent header creation action', async ({
  page
}) => {
  await page.setViewportSize({ width: 2515, height: 1289 });
  await mockApi(page, 'dark', 'empty');
  await page.goto('/app/#/schedules');
  await expect(page.getByRole('heading', { name: 'No schedules yet' })).toBeVisible();
  const frame = (await page.locator('.schedules-page').boundingBox())!;
  const header = (await page.locator('.page-header').boundingBox())!;
  const content = (await page.locator('.schedules-view').boundingBox())!;
  const main = (await page.locator('.shell > main').boundingBox())!;

  const create = page.getByRole('button', { name: 'Create schedule', exact: true });
  const action = (await create.boundingBox())!;
  expect(frame.width).toBe(1220);
  expect(Math.abs(frame.x - main.x - (main.x + main.width - frame.x - frame.width))).toBeLessThan(
    1
  );
  expect(header.x).toBe(content.x);
  expect(header.width).toBe(content.width);
  expect(action.x + action.width).toBeLessThanOrEqual(header.x + header.width + 1);
  await expect(page.getByRole('button', { name: 'New schedule', exact: true })).toHaveCount(0);
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'New schedule', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedules · 0', exact: true })).toBeFocused();
});

test('failed schedule loading does not show an empty-state creation prompt', async ({ page }) => {
  await mockApi(page, 'light', 'error');
  await page.goto('/app/#/schedules');
  await expect(page.getByText('Schedules unavailable')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No schedules yet' })).toHaveCount(0);
});

test('Endeavor keeps the selected person, theme, and navigation after reload: dark', async ({
  page
}) => {
  const theme = 'dark';
  await page.setViewportSize({ width: 1100, height: 800 });
  await mockApi(page, theme, 'populated', true);
  await page.goto('/app/#/schedules');
  await expect(page).toHaveTitle('Endeavor');
  await expect(page.getByRole('link', { name: 'Endeavor', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Setup', exact: true }).click();
  await expect(page.getByText('People, providers, and Endeavor on this computer.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Profile and settings' })).toContainText('Kayvan');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  expect(await page.evaluate(() => localStorage.getItem('endeavor.actorId'))).toBe('person-1');
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('endeavor.theme'))).toBe(theme);
  expect(
    await page.evaluate(() => localStorage.getItem('collaborative-agents.actorId'))
  ).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('collaborative-agents.theme'))).toBeNull();
  await expect(page.locator('.brand')).not.toContainText('Collaborative Agents');
});

test('catch-up failure survives reload and keeps Run once now available for a successful retry', async ({
  page
}) => {
  await mockApi(page, 'light');
  const pending = {
    ...baseSchedule,
    id: 'retry',
    title: 'Retryable check',
    status: 'enabled',
    catchUp: { slot: '2026-10-26T12:00:00Z', missed: 2 }
  };
  let fail = true;
  let resolved = false;
  const decisions: unknown[] = [];
  await page.route('**/responsibilities**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'POST' && url.pathname.endsWith('/catch-up')) {
      decisions.push(request.postDataJSON());
      if (fail) return reply({ error: { message: 'The agent is unavailable. Try again.' } }, 409);
      resolved = true;
      return reply({
        data: { responsibility: { ...pending, catchUp: null }, run: { runKey: 'only-run', conversationId: 'run-1' } }
      });
    }
    return reply({
      data: [{ ...pending, catchUp: resolved ? null : pending.catchUp }],
      page: { limit: 100, offset: 0, total: 1 }
    });
  });
  await page.goto('/app/#/schedules');
  const run = page.getByRole('button', { name: 'Run once now', exact: true });
  await run.click();
  await expect(page.getByText('The agent is unavailable. Try again.')).toBeVisible();
  await page.reload();
  await expect(run).toBeEnabled();
  await expect(page.getByText('Retryable check missed 2 runs')).toBeVisible();
  fail = false;
  await run.click();
  await expect(page.getByText('Catch-up run started.', { exact: true })).toBeVisible();
  await expect(page.locator('.schedule-catchup')).toHaveCount(0);
  expect(decisions).toEqual([{ decision: 'run' }, { decision: 'run' }]);
});

test('creates an unpinned project schedule and opens its waiting run from history', async ({ page }) => {
  await mockApi(page, 'light', 'empty');
  const title = 'Weekly status';
  let submitted: unknown;
  let created = false;
  const schedule = { ...baseSchedule, id: 'project-schedule', title, status: 'enabled', agentId: null };
  await page.route('**/responsibilities**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const data = path.endsWith('/runs')
      ? [{ runKey: 'run-1', taskId: null, conversationId: 'run-endeavor', state: 'waiting',
          createdAt: '2026-11-10T13:00:00Z' }]
      : created ? [schedule] : [];
    if (request.method() === 'POST') {
      submitted = request.postDataJSON();
      created = true;
      return route.fulfill({ status: 201, json: { data: schedule } });
    }
    return route.fulfill({ json: { data, page: { limit: 100, offset: 0, total: data.length } } });
  });
  await page.goto('/app/#/schedules');
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await page.getByLabel('Project', { exact: true }).selectOption('project-1');
  await expect(page.getByLabel('Starting agent')).toHaveValue('');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('What to do each time').fill('Draft the weekly status');
  await page.getByLabel('Done when').fill('Include three bullets');
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Schedule created.' })).toBeVisible();
  expect(submitted).toEqual({
    projectId: 'project-1',
    agentId: null,
    title,
    brief: 'Draft the weekly status',
    completionCriteria: 'Include three bullets',
    recurrence: { frequency: 'daily', time: '09:00', timeZone: expect.any(String) },
    missedRunPolicy: 'ask'
  });
  await page.getByRole('button', { name: /Weekly status Automatic routing/ }).click();
  await expect(page.locator('.schedule-runs')).toContainText('waiting');
  await expect(page.getByRole('link', { name: 'Open endeavor' })).toHaveAttribute(
    'href', '#/conversations/run-endeavor'
  );
});
