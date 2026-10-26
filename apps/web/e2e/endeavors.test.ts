import { expect, test, type Page } from '@playwright/test';

const people = [
  {
    id: 'person-1',
    name: 'Kayvan',
    role: 'admin',
    preferences: { theme: 'dark', timeFormat: '12h' }
  },
  {
    id: 'person-2',
    name: 'Lee',
    role: 'member',
    preferences: { theme: 'light', timeFormat: '12h' }
  }
];
const agents = [
  {
    id: 'agent-1',
    name: 'Researcher',
    purpose: 'Find evidence',
    capabilities: { provider: 'openai', model: 'test', skillCount: 0, connectionCount: 0 }
  }
];
const initial = [
  { id: 'heat', title: 'heat-pump-brief', createdAt: '2026-10-24T10:00:00Z' },
  { id: 'site', title: 'website-reliability', createdAt: '2026-10-23T10:00:00Z' }
];

type Options = {
  empty?: boolean;
  saved?: string;
  pages?: boolean;
  theme?: 'dark' | 'light';
  fail?: boolean;
  slow?: boolean;
};
async function mockApi(page: Page, options: Options = {}) {
  const state = {
    conversations: options.empty ? [] : [...initial],
    posts: [] as Record<string, unknown>[],
    fail: options.fail ?? false,
    writes: [] as string[]
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ saved, theme }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', 'yes');
      localStorage.setItem('endeavor.actorId', 'person-1');
      if (saved) localStorage.setItem('endeavor.lastConversation.person-1', saved);
      if (theme) localStorage.setItem('endeavor.theme', theme);
    },
    { saved: options.saved, theme: options.theme }
  );
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const paged = (data: unknown[], total = data.length) => ({
      data,
      page: { limit: 100, offset: Number(url.searchParams.get('offset') ?? 0), total }
    });
    if (request.method() !== 'GET') state.writes.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === '/humans')
      return reply({
        data: people.map((p) => ({
          ...p,
          preferences: { ...p.preferences, theme: options.theme ?? p.preferences.theme }
        }))
      });
    if (url.pathname === '/directory') return reply({ data: agents });
    if (url.pathname === '/conversations' && request.method() === 'POST') {
      const input = request.postDataJSON();
      state.posts.push(input);
      if (options.slow) await new Promise((resolve) => setTimeout(resolve, 350));
      if (state.fail) return reply({ error: { message: 'Please try again.' } }, 503);
      const created = { id: 'created', title: input.title, createdAt: '2026-10-24T12:00:00Z' };
      state.conversations.unshift(created);
      return reply({ data: created }, 201);
    }
    if (url.pathname === '/conversations') {
      const accessible =
        request.headers()['x-actor-id'] === 'person-2'
          ? state.conversations.filter((c) => c.id === 'site')
          : state.conversations;
      const offset = Number(url.searchParams.get('offset') ?? 0);
      // Deliberately small API pages exercise pagination without a large fixture.
      return reply(
        paged(options.pages ? accessible.slice(offset, offset + 1) : accessible, accessible.length)
      );
    }
    const match = /^\/conversations\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const conversation = state.conversations.find((c) => c.id === match[1]);
      if (!conversation) return reply({ error: { message: 'Unavailable' } }, 404);
      const posted = conversation.id === 'created' ? state.posts.at(-1) : undefined;
      const humanIds = (posted?.humanIds ?? []) as string[];
      const agentIds = (posted?.agentIds ?? []) as string[];
      return reply({
        data: {
          ...conversation,
          members: [
            ...people
              .filter((p) => p.id === 'person-1' || humanIds.includes(p.id))
              .map((p) => ({
                participant: { type: 'human', id: p.id },
                name: p.name,
                purpose: null,
                historyFrom: null
              })),
            ...agents
              .filter((a) => agentIds.includes(a.id))
              .map((a) => ({
                participant: { type: 'agent', id: a.id },
                name: a.name,
                purpose: a.purpose,
                historyFrom: null
              }))
          ]
        }
      });
    }
    if (url.pathname.endsWith('/costs'))
      return reply({
        data: { total: { costUsd: 0, tokens: 0, unpricedCalls: 0 }, budgetUsd: null, tasks: [] }
      });
    return reply(paged([]));
  });
  return { state, errors };
}

async function openNew(page: Page) {
  if (await page.getByRole('button', { name: 'Open sidebar', exact: true }).count())
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  const button = page
    .locator('.sidebar')
    .getByRole('button', { name: 'New endeavor', exact: true });
  await button.hover();
  const geometry = await button.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const icon = element.querySelector('svg')!.getBoundingClientRect();
    const label = [...element.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    )!;
    const range = document.createRange();
    range.selectNodeContents(label);
    const text = range.getBoundingClientRect();
    return {
      leftInset: icon.left - bounds.left,
      rightInset: bounds.right - text.right,
      sameLine: Math.abs((icon.top + icon.bottom) / 2 - (text.top + text.bottom) / 2) < 3,
      height: bounds.height
    };
  });
  expect(geometry.leftInset).toBeGreaterThanOrEqual(8);
  expect(geometry.rightInset).toBeGreaterThanOrEqual(7);
  expect(geometry.sameLine).toBe(true);
  if (page.viewportSize()!.width <= 700) expect(geometry.height).toBeGreaterThanOrEqual(44);
  await button.click();
  return page.getByRole('dialog', { name: 'What do you want to accomplish?' });
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: collapsed sidebar keeps icons and expands on hover and keyboard focus`, async ({ page }) => {
    await mockApi(page, { theme });
    await page.goto('/app/');
    const sidebar = page.getByRole('complementary', { name: 'Sidebar', exact: true });
    const width = () => sidebar.evaluate((element) => element.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect.poll(width).toBe(68);
    const iconOffsets = await sidebar.locator('nav a').evaluateAll((links) => links.map((link) => {
      const bounds = link.getBoundingClientRect();
      const icon = link.querySelector('svg')!.getBoundingClientRect();
      return Math.abs((icon.left + icon.right - bounds.left - bounds.right) / 2);
    }));
    expect(iconOffsets.every((offset) => offset < 1)).toBe(true);
    const agents = sidebar.getByRole('link', { name: 'Agents', exact: true });
    await expect(agents.locator('svg')).toBeVisible();
    await expect(agents).toHaveAttribute('href', '#/agents');
    await agents.hover();
    await expect.poll(width).toBe(264);
    await expect(sidebar.getByRole('button', { name: 'New endeavor', exact: true })).toBeVisible();
    await agents.click();
    await expect(page).toHaveURL(/#\/agents$/);
    await expect(agents).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Search endeavors', exact: true }).hover();
    await expect.poll(width).toBe(68);
    // Keyboard focus reveals the labels even after the mouse has left.
    await page.keyboard.press('Tab');
    await expect.poll(width).toBe(264);
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Search endeavors', exact: true }).hover();
    await expect.poll(width).toBe(264);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(sidebar).toHaveCSS('transition-duration', '0s');
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect.poll(width).toBe(68);
    await page.screenshot({ path: `/tmp/ca61-${theme}-collapsed.png` });
  });
}

test('sidebar width drags between its limits, remembers the choice, and works from the keyboard', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar', exact: true });
  const width = () => sidebar.evaluate((element) => element.getBoundingClientRect().width);
  const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  await expect.poll(width).toBe(264);
  const drag = async (x: number) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(x, box.y + 100, { steps: 4 });
    await page.mouse.up();
  };
  await drag(360);
  await expect.poll(width).toBe(360);
  await expect(handle).toHaveAttribute('aria-valuenow', '360');
  await drag(900);
  await expect.poll(width).toBe(480);
  await drag(40);
  await expect.poll(width).toBe(220);
  await page.reload();
  await expect.poll(width).toBe(220);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(width).toBe(236);
  await page.keyboard.press('End');
  await expect.poll(width).toBe(480);
  await page.keyboard.press('Home');
  await expect.poll(width).toBe(220);
  await handle.dblclick();
  await expect.poll(width).toBe(264);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(handle).toHaveCount(0);
});

test.describe('touch sidebar', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('compact icons navigate and the toggle opens the full menu', async ({ page }) => {
    await mockApi(page);
    await page.goto('/app/');
    const sidebar = page.getByRole('complementary', { name: 'Sidebar', exact: true });
    const width = () => sidebar.evaluate((element) => element.getBoundingClientRect().width);
    await expect.poll(width).toBe(68);
    await sidebar.getByRole('link', { name: 'Agents', exact: true }).tap();
    await expect(page).toHaveURL(/#\/agents$/);
    await expect.poll(width).toBe(68);
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).tap();
    await expect.poll(width).toBe(264);
    await expect(sidebar.getByRole('button', { name: 'New endeavor', exact: true })).toHaveCount(0);
    await expect(sidebar.locator('.sidebar-conversations')).toHaveCount(0);
    await sidebar.getByRole('link', { name: 'Endeavors', exact: true }).tap();
    await expect.poll(width).toBe(68);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('restores the last accessible selection, preserves links, and searches older pages', async ({
  page
}) => {
  const { errors } = await mockApi(page, { saved: 'site', pages: true });
  await page.goto('/app/');
  await expect(
    page.getByRole('heading', { name: 'website-reliability', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: '#website-reliability', exact: true })
  ).toHaveAttribute('title', 'website-reliability');
  await page.getByRole('link', { name: '#heat-pump-brief', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'heat-pump-brief', exact: true })).toBeVisible();
  for (const destination of ['Agents', 'Schedules', 'Approvals', 'Skills and connections', 'Setup', 'Work']) {
    await page.getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('link', { name: destination, exact: true }).click();
    await expect(page.locator('.sidebar-conversations')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New endeavor', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Profile and settings', exact: true }).click();
  await expect(page.locator('.sidebar-conversations')).toHaveCount(0);
  await page.getByRole('link', { name: 'Endeavors', exact: true }).click();
  await expect(page.locator('.sidebar-conversations')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'heat-pump-brief', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'heat-pump-brief', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Find an endeavor' });
  await search.getByLabel('Search endeavors', { exact: true }).fill('website');
  await search.getByLabel('Search endeavors', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/#\/conversations\/site$/);
  await expect(search).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unavailable saved selection falls back, and switching people resets accessible results', async ({
  page
}) => {
  await mockApi(page, { saved: 'gone' });
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'heat-pump-brief', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch person', exact: true }).click();
  await page.getByRole('button', { name: 'Lee', exact: true }).click();
  await page.getByRole('link', { name: 'Endeavors', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'website-reliability', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Search endeavors', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'heat-pump-brief', exact: true })
  ).toHaveCount(0);
});

test('cancel, Close and Escape preserve the thread and draft, trap focus, and restore the opener', async ({
  page
}) => {
  const { state, errors } = await mockApi(page);
  await page.goto('/app/#/conversations/site');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft');
  for (const dismissal of ['Cancel', 'Close', 'Escape']) {
    const dialog = await openNew(page);
    await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
    await expect(dialog.locator('input[type=checkbox]:checked')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    // Start is disabled: Cancel is the last enabled control.
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New endeavor', exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Keep this draft'
    );
    await expect(page).toHaveURL(/#\/conversations\/site$/);
  }
  expect(state.posts).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps failed values and membership, prevents duplicate saves, then selects and focuses the new chat', async ({
  page
}) => {
  const { state, errors } = await mockApi(page, { fail: true, slow: true });
  await page.goto('/app/');
  const dialog = await openNew(page);
  const name = dialog.getByLabel('Name', { exact: true });
  await name.fill('! @ 🧪');
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await name.fill('Heat');
  await name.press('Space');
  await expect(name).toHaveValue('heat-');
  await name.pressSequentially('Pumps @ Brief!!');
  await expect(name).toHaveValue('heat-pumps-brief-');
  await name.press('Tab');
  await expect(name).toHaveValue('heat-pumps-brief');
  await name.fill('  Explain heat pumps  ');
  await dialog.getByLabel('Find people or agents').fill('research');
  await dialog.getByRole('checkbox', { name: 'Add Researcher' }).check();
  await expect(dialog.locator('.spark')).toHaveCount(1);
  await dialog.getByLabel('Find people or agents').fill('lee');
  await dialog.getByRole('checkbox', { name: 'Add Lee' }).check();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Starting…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Please try again.', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('explain-heat-pumps');
  await expect(dialog.getByRole('checkbox', { name: 'Add Lee' })).toBeChecked();
  expect(state.posts).toHaveLength(1);
  state.fail = false;
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'explain-heat-pumps', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
  await expect(
    page.getByRole('link', { name: '#explain-heat-pumps', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Conversation details' });
  await expect(details.getByText('Lee', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: /1 more agents/ }).click();
  await expect(
    details.getByRole('button', { name: 'Agent Researcher agent Free', exact: true })
  ).toBeVisible();
  expect(state.posts[1]).toEqual({
    title: 'explain-heat-pumps',
    agentIds: ['agent-1'],
    humanIds: ['person-2']
  });
  expect(state.writes).toEqual(['POST /conversations', 'POST /conversations']);
  expect(errors).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390, 320]) {
    test(`${theme} at ${width}px: empty prompt, creation, search and chat fit`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const { state, errors } = await mockApi(page, { empty: true, saved: 'gone', theme });
      await page.goto('/app/');
      await expect(
        page.getByRole('heading', { name: 'What do you want to accomplish?' })
      ).toBeVisible();
      const dialog = await openNew(page);
      await dialog.getByLabel('Name', { exact: true }).fill('A readable outcome ');
      await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
      await page.screenshot({ path: `/tmp/ca52-${theme}-${width}-dialog.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await dialog.getByLabel('Name', { exact: true }).press('Enter');
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Search endeavors', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByLabel('Search endeavors', { exact: true })
        .fill('missing');
      await expect(page.getByText('No endeavors found.', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Search endeavors', exact: true })
      ).toBeFocused();
      await page.screenshot({ path: `/tmp/ca52-${theme}-${width}-chat.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(state.posts[0]).toEqual({ title: 'a-readable-outcome', agentIds: [], humanIds: [] });
      expect(errors).toEqual([]);
    });
  }
}
