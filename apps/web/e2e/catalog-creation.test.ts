import { captureReviewScreenshot } from './review-screenshot';
import { expect, test, type Page } from '@playwright/test';

async function mockApi(page: Page, theme = 'dark') {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const entries: Record<string, Record<string, unknown>[]> = { '/skills': [], '/connections': [] };
  let fail = false;
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() !== 'GET') {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      if (fail) return reply({ error: { message: 'Please try again.' } }, 503);
      const entry = {
        ...body,
        id: 'new',
        hasCredential: Boolean(body.credential),
        disabledAt: null
      };
      entries[url.pathname]?.push(entry);
      return reply({ data: entry }, 201);
    }
    if (url.pathname === '/humans')
      return reply({
        data: [{ id: 'p1', name: 'Kayvan', preferences: { theme, timeFormat: '12h' } }]
      });
    if (url.pathname === '/providers') return reply({ data: [] });
    const data = entries[url.pathname] ?? [];
    return reply({ data, page: { total: data.length, limit: 100, offset: 0 } });
  });
  return { writes, fail: (value: boolean) => (fail = value) };
}

for (const { viewport, theme } of [
  { viewport: { width: 1440, height: 1000 }, theme: 'light' },
  { viewport: { width: 390, height: 844 }, theme: 'dark' }
] as const) {
  test(`creation pages match agent layout at ${viewport.width}px in ${theme}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockApi(page, theme);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/app/#/agents/new');
    await expect(page.getByRole('heading', { name: 'New agent', exact: true })).toBeVisible();
    const reference = await page.locator('form').boundingBox();
    const profile = await page.getByRole('group', { name: 'Profile', exact: true }).boundingBox();
    const header = await page.locator('.page-header').boundingBox();
    for (const kind of ['skills', 'connections']) {
      await page.goto(`/app/#/catalogs/${kind}/new`);
      await expect(
        page.getByRole('heading', {
          name: kind === 'skills' ? 'New skill' : 'New connection',
          exact: true
        })
      ).toBeVisible();
      const form = await page.locator('form').boundingBox();
      const section = await page.getByRole('group', { name: 'Profile', exact: true }).boundingBox();
      const heading = await page.locator('.page-header').boundingBox();
      expect(Math.abs(form!.x - reference!.x)).toBeLessThan(1);
      expect(Math.abs(form!.width - reference!.width)).toBeLessThan(1);
      expect(
        Math.abs(
          section!.y - heading!.y - heading!.height - (profile!.y - header!.y - header!.height)
        )
      ).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.getByRole('button', { name: /^Create / }).scrollIntoViewIfNeeded();
      const footer = await page.locator('.savebar').boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height + 1);
      const cancel = await page.getByRole('link', { name: 'Cancel', exact: true }).boundingBox();
      if (viewport.width < 700) expect(cancel!.height).toBeGreaterThanOrEqual(44);
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`${kind}.png`),
        fullPage: true
      });
      await page.getByRole('link', { name: 'Cancel', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${kind}$`));
      await expect(
        page.getByRole('link', {
          name: kind === 'skills' ? 'Skills' : 'Connections',
          exact: true
        })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('form')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('skill creation keeps values after failure and returns to Skills after retry', async ({
  page
}) => {
  const api = await mockApi(page);
  await page.goto('/app/#/catalogs');
  await page.getByRole('button', { name: '+ Create skill', exact: true }).click();
  await expect(page).toHaveURL(/skills\/new$/);
  await page.getByLabel('Name', { exact: true }).fill('Citations');
  await page.getByLabel('Description', { exact: true }).fill('Cite each source');
  await page.getByLabel('Instructions', { exact: true }).fill('Include a source for each claim.');
  api.fail(true);
  await page.getByRole('button', { name: 'Create skill', exact: true }).click();
  await expect(page.getByText('Please try again.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
    'Include a source for each claim.'
  );
  api.fail(false);
  await page.getByRole('button', { name: 'Create skill', exact: true }).click();
  await expect(page).toHaveURL(/skills$/);
  await expect(page.getByText('Citations', { exact: true })).toBeVisible();
  expect(api.writes[1]).toEqual({
    path: '/skills',
    body: {
      name: 'Citations',
      description: 'Cite each source',
      instructions: 'Include a source for each claim.',
      discoverable: false
    }
  });
});

test('HTTP connection preserves access settings after failure and returns to Connections', async ({
  page
}) => {
  const api = await mockApi(page);
  await page.goto('/app/#/catalogs');
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: '+ Create connection', exact: true }).click();
  await expect(page).toHaveURL(/connections\/new$/);
  await page.getByLabel('Name', { exact: true }).fill('Records');
  await page.getByLabel('Description', { exact: true }).fill('Read and write records');
  await page.getByLabel('Base URL', { exact: true }).fill('https://records.test');
  await page.getByLabel('Credential', { exact: true }).fill('Bearer secret');
  await page
    .getByRole('group', { name: 'Allowed methods', exact: true })
    .getByLabel('POST', { exact: true })
    .check();
  await page.getByLabel('Allowed paths', { exact: false }).fill('/v1/records');
  api.fail(true);
  await page.getByRole('button', { name: 'Create connection', exact: true }).click();
  await expect(page.getByText('Please try again.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Credential', { exact: true })).toHaveValue('Bearer secret');
  api.fail(false);
  await page.getByRole('button', { name: 'Create connection', exact: true }).click();
  await expect(page).toHaveURL(/connections$/);
  await expect(page.getByText('Records', { exact: true })).toBeVisible();
  expect(api.writes[1].body).toEqual({
    name: 'Records',
    description: 'Read and write records',
    baseUrl: 'https://records.test',
    discoverable: false,
    authHeader: 'Authorization',
    authMethod: 'header',
    credential: 'Bearer secret',
    allowedMethods: ['GET', 'POST'],
    allowedPathPrefixes: ['/v1/records'],
    approvalMethods: ['POST']
  });
  await page.goBack();
  await page.getByRole('link', { name: '← Connections', exact: true }).click();
  await expect(page).toHaveURL(/connections$/);
});

test('GitHub and execution setup preserve explicit access at 390px', async ({ page }, testInfo) => {
  const width = 390;
  await page.setViewportSize({ width, height: 1000 });
  const api = await mockApi(page);
  for (const example of ['github', 'executor']) {
    await page.goto(`/app/#/catalogs/connections/new?example=${example}`);
    await expect(page.getByLabel('Connection type')).toHaveValue('mcp');
    await expect(page.getByLabel('MCP endpoint URL')).toHaveValue(
      example === 'github' ? 'https://api.githubcopilot.com/mcp/' : 'http://executor:3200/mcp'
    );
    await expect(page.getByLabel(/^Allowed tools/)).toHaveValue('');
    await page.getByLabel('Credential', { exact: true }).fill('Bearer test-secret');
    expect(await page.getByLabel('Credential', { exact: true }).getAttribute('type')).toBe(
      'password'
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`${example}-${width}.png`),
      fullPage: true
    });
    await page.getByRole('button', { name: 'Create connection', exact: true }).click();
    await expect(page).toHaveURL(/connections$/);
    const saved = api.writes.at(-1)!.body;
    expect(saved.kind).toBe('mcp');
    expect(saved.allowedTools).toEqual([]);
    expect(saved.approvalTools).toEqual([]);
    expect(saved.credential).toBe('Bearer test-secret');
  }
  for (const [example, name] of [
    ['coder', 'Coding agent'],
    ['reviewer', 'Code reviewer']
  ]) {
    await page.goto(`/app/#/agents/new?example=${example}`);
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
    expect(await page.getByLabel(/^Instructions/).inputValue()).toContain('get_execution');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`${example}-${width}.png`),
      fullPage: true
    });
  }
});
