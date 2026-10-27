import { expect, test, type Page } from '@playwright/test';

async function mockOAuth(page: Page, theme = 'dark') {
  let authenticated = false;
  let failSignIn = false;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let connection: Record<string, unknown> = {
    id: 'c1',
    name: 'Juniper Parcel — Notion',
    description: 'Fictional company docs',
    kind: 'mcp',
    authMethod: 'oauth',
    baseUrl: 'https://mcp.notion.com/mcp',
    allowedTools: [],
    approvalTools: [],
    allowedMethods: [],
    allowedPathPrefixes: [],
    approvalMethods: [],
    hasCredential: false,
    disabledAt: null
  };
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/consent') {
      authenticated = true;
      return route.fulfill({
        contentType: 'text/html',
        body: '<a href="/app/#/connections/c1?oauth=connected">Allow Notion access</a>'
      });
    }
    if (url.pathname.startsWith('/app/')) return route.continue();
    if (request.method() !== 'GET') {
      const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {};
      writes.push({ path: url.pathname, body });
      if (url.pathname === '/connections') {
        connection = { ...connection, ...body };
        return reply({ data: { ...connection, authenticated } }, 201);
      }
      if (url.pathname.endsWith('/oauth/connect')) {
        if (failSignIn)
          return reply({ error: { message: 'Sign-in setup failed. Try again.' } }, 503);
        return reply({ data: { authorizationUrl: 'http://127.0.0.1:5190/consent' } });
      }
      if (url.pathname.endsWith('/oauth/disconnect')) {
        authenticated = false;
        return reply({ data: { status: 'disconnected' } });
      }
      return reply({ data: {} });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [{ id: 'p1', name: 'Kayvan', preferences: { theme, timeFormat: '12h' } }]
      });
    if (url.pathname === '/connections/c1')
      return reply({ data: { ...connection, authenticated } });
    const data = url.pathname === '/connections' ? [{ ...connection, authenticated }] : [];
    return reply({ data, page: { limit: 100, offset: 0, total: data.length } });
  });
  return {
    writes,
    failSignIn: (value: boolean) => {
      failSignIn = value;
    }
  };
}

for (const width of [320, 390, 900, 1280]) {
  for (const theme of ['dark', 'light']) {
    test(`simple auth status and sign-in controls fit ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const api = await mockOAuth(page, theme);
      await page.goto('/app/#/connections');
      const row = page.getByRole('link').filter({ hasText: 'Juniper Parcel — Notion' });
      await expect(row.getByText('Enabled', { exact: true })).toBeVisible();
      await expect(row.getByText('Authentication required', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await row.click();
      const header = page.locator('.page-header');
      await expect(header.getByText('Authentication required', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      const checkLayout = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        for (const badge of await header.locator('.management-status').all()) {
          const box = (await badge.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        for (const button of await page
          .locator('details')
          .filter({ has: page.getByText('Authentication', { exact: true }) })
          .getByRole('button')
          .all()) {
          const box = (await button.boundingBox())!;
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          if (width <= 390) expect(box.height).toBeGreaterThanOrEqual(44);
        }
      };
      await checkLayout();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('link', { name: 'Allow Notion access' }).click();
      await expect(header.getByText('Authenticated', { exact: true })).toBeVisible();
      await expect(page.getByText('No credential', { exact: true })).toHaveCount(0);
      await checkLayout();
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(header.getByText('Authentication required', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Signed in. Discover tools and choose the access this connection allows.', {
          exact: true
        })
      ).toHaveCount(0);
      expect(api.writes.map((write) => write.path)).toEqual([
        '/connections/c1/oauth/connect',
        '/connections/c1/oauth/disconnect'
      ]);
    });
  }
}

test('Notion can be created and signed in from the new connection screen', async ({ page }) => {
  const api = await mockOAuth(page);
  await page.goto('/app/#/connections/new');
  await page.getByRole('link', { name: 'Notion', exact: true }).click();
  await expect(page.getByLabel('Authentication method')).toHaveValue('oauth');
  await expect(page.getByLabel('MCP endpoint URL')).toHaveValue('https://mcp.notion.com/mcp');
  await expect(page.getByLabel('Credential', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create and sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Allow Notion access' }).click();
  await expect(
    page.locator('.page-header').getByText('Authenticated', { exact: true })
  ).toBeVisible();
  expect(api.writes.map((write) => write.path)).toEqual([
    '/connections',
    '/connections/c1/oauth/connect'
  ]);
  expect(api.writes[0].body).toMatchObject({
    name: 'Notion',
    kind: 'mcp',
    authMethod: 'oauth',
    allowedTools: [],
    approvalTools: []
  });
  expect(api.writes[0].body).not.toHaveProperty('credential');
});

test('failed OAuth setup retains the saved connection and retry never creates a duplicate', async ({
  page
}) => {
  const api = await mockOAuth(page);
  api.failSignIn(true);
  await page.goto('/app/#/connections/new?example=notion');
  await page.getByRole('button', { name: 'Create and sign in', exact: true }).click();
  await expect(page.getByText('Sign-in setup failed. Try again.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/connections\/c1$/);
  await expect(
    page.locator('.page-header').getByText('Authentication required', { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(api.writes.filter((write) => write.path === '/connections')).toHaveLength(1);
  expect(api.writes.filter((write) => write.path.endsWith('/connect'))).toHaveLength(1);
  api.failSignIn(false);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Allow Notion access' }).click();
  await expect(
    page.locator('.page-header').getByText('Authenticated', { exact: true })
  ).toBeVisible();
  expect(api.writes.filter((write) => write.path === '/connections')).toHaveLength(1);
});

test('switching to OAuth omits a token entered for header authentication', async ({ page }) => {
  const api = await mockOAuth(page);
  await page.goto('/app/#/connections/new?example=notion');
  await page.getByLabel('Authentication method').selectOption('header');
  await page.getByLabel('Credential', { exact: true }).fill('do-not-send-this-token');
  await page.getByLabel('Authentication method').selectOption('oauth');
  await page.getByRole('button', { name: 'Create and sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Allow Notion access' }).waitFor();
  expect(api.writes[0].body).not.toHaveProperty('credential');
});

test('switching from MCP OAuth to HTTP resets authentication and omits hidden credentials', async ({
  page
}) => {
  const api = await mockOAuth(page);
  await page.goto('/app/#/connections/new?example=notion');
  await page.getByLabel('Connection type').selectOption('http');
  await expect(page.getByLabel('Authentication method')).toHaveValue('none');
  await expect(
    page.getByLabel('Authentication method').locator('option[value="oauth"]')
  ).toHaveCount(0);
  await page.getByLabel('Authentication method').selectOption('header');
  await page.getByLabel('Credential', { exact: true }).fill('hidden-token');
  await page.getByLabel('Authentication method').selectOption('none');
  await page.getByRole('button', { name: 'Create connection', exact: true }).click();
  await expect(page).toHaveURL(/connections$/);
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0].body).toMatchObject({ authMethod: 'none' });
  expect(api.writes[0].body).not.toHaveProperty('credential');
});
