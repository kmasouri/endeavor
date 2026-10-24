import { expect, test, type Page } from '@playwright/test';

const baseSchedule = {
  agentId: 'agent-1',
  conversationId: null,
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
async function mockApi(page: Page, theme: 'dark' | 'light', mode: Mode = 'populated') {
  await page.addInitScript(() => localStorage.setItem('collaborative-agents.actorId', 'person-1'));
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

for (const theme of ['dark', 'light'] as const) {
  for (const width of [2515, 1024, 390]) {
    test(`status badges stay on one line in the production bundle: ${theme}, ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await mockApi(page, theme);
      await page.goto('/app/#/schedules');
      await page.getByText('Cancelled schedules · 1').click();
      await expectSingleLineBadges(page);
      await page.getByRole('button', { name: /Cancelled check/ }).click();
      const badge = page.locator('.schedule-badge');
      await expect(badge).toContainText('Cancelled');
      await expect(badge).toHaveCSS('display', /^(inline-)?flex$/);
    });
  }
}

test('wide layout shares a centered frame and keeps the empty-state action centered', async ({
  page
}) => {
  await page.setViewportSize({ width: 2515, height: 1289 });
  await mockApi(page, 'dark', 'cancelled');
  await page.goto('/app/#/schedules');
  await expect(page.getByRole('heading', { name: 'No active schedules' })).toBeVisible();
  const frame = (await page.locator('.schedules-page').boundingBox())!;
  const header = (await page.locator('.page-header').boundingBox())!;
  const content = (await page.locator('.schedules-view').boundingBox())!;
  const main = (await page.locator('.shell > main').boundingBox())!;
  const empty = (await page.locator('.schedule-empty').boundingBox())!;
  const create = page.getByRole('button', { name: 'Create schedule', exact: true });
  const action = (await create.boundingBox())!;
  expect(frame.width).toBe(1220);
  expect(Math.abs(frame.x - main.x - (main.x + main.width - frame.x - frame.width))).toBeLessThan(
    1
  );
  expect(header.x).toBe(content.x);
  expect(header.width).toBe(content.width);
  expect(Math.abs(action.x + action.width / 2 - empty.x - empty.width / 2)).toBeLessThan(1);
  await expect(page.getByRole('button', { name: 'New schedule', exact: true })).toHaveCount(0);
  await expect(page.locator('.schedule-cancelled')).not.toHaveAttribute('open');
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'New schedule', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No active schedules' })).toBeFocused();
});

test('failed schedule loading does not show an empty-state creation prompt', async ({ page }) => {
  await mockApi(page, 'light', 'error');
  await page.goto('/app/#/schedules');
  await expect(page.getByText('Schedules unavailable')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No active schedules' })).toHaveCount(0);
});
