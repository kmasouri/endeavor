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
      if (url.pathname.endsWith('/disable')) connection.disabledAt = '2026-10-27T04:00:00Z';
      if (url.pathname.endsWith('/enable')) connection.disabledAt = null;
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
    setAuthenticated: (value: boolean) => {
      authenticated = value;
    },
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
      await expect(row.locator('.management-status')).toHaveCount(1);
      await expect(row.getByText('Authentication required', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await row.click();
      const header = page.locator('.page-header');
      await expect(header.getByText('Authentication required', { exact: true })).toBeVisible();
      await expect(header.locator('.management-status')).toHaveCount(1);
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
      const checkDisabled = async () => {
        await page.getByRole('button', { name: 'Disable', exact: true }).click();
        await expect(header.locator('.management-status')).toHaveText('Disabled');
        await page.getByRole('link', { name: '← Connections', exact: true }).click();
        await expect(row.locator('.management-status')).toHaveCount(1);
        await expect(row.locator('.management-status')).toHaveText('Disabled');
        await row.click();
        await page.getByRole('button', { name: 'Enable', exact: true }).click();
      };
      await checkDisabled();
      await expect(header.locator('.management-status')).toHaveText('Authentication required');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('link', { name: 'Allow Notion access' }).click();
      await expect(header.locator('.management-status')).toHaveText('Enabled');
      await checkDisabled();
      await expect(header.locator('.management-status')).toHaveText('Enabled');
      await expect(page.getByText('No credential', { exact: true })).toHaveCount(0);
      await checkLayout();
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Disconnected.');
      await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
      await checkLayout();
      if (theme === 'dark' && (width === 390 || width === 1280)) {
        await page.screenshot({
          path: test.info().outputPath('auth-feedback.png'),
          fullPage: true
        });
      }
      await expect(header.getByText('Authentication required', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Signed in. Discover tools and choose the access this connection allows.', {
          exact: true
        })
      ).toHaveCount(0);
      expect(api.writes.map((write) => write.path)).toEqual([
        '/connections/c1/disable',
        '/connections/c1/enable',
        '/connections/c1/oauth/connect',
        '/connections/c1/disable',
        '/connections/c1/enable',
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
  await expect(page.locator('.page-header').getByText('Enabled', { exact: true })).toBeVisible();
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
  await expect(page.locator('.page-header').getByText('Enabled', { exact: true })).toBeVisible();
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

test('refresh status shows progress, confirms unchanged state, and recovers from errors', async ({
  page
}) => {
  const api = await mockOAuth(page);
  await page.goto('/app/#/connections/c1');
  const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
  await expect(disconnect).toBeDisabled();
  await expect(page.getByText('Not signed in. Sign in to connect.')).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/connections/c1', async (route) => {
    await held;
    await route.fallback();
  });
  const refresh = page.getByRole('button', { name: 'Refresh status', exact: true });
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('status')).toHaveText('Status refreshed.');
  await expect(disconnect).toBeDisabled();
  await page.route('**/connections/c1', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Status is temporarily unavailable.' } })
    })
  );
  await refresh.click();
  await expect(page.getByText('Status is temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toBeEmpty();
  await expect(refresh).toBeEnabled();
  await page.unroute('**/connections/c1');
  api.setAuthenticated(true);
  await refresh.click();
  await expect(page.getByRole('status')).toHaveText('Status refreshed.');
  await expect(page.getByText('Status is temporarily unavailable.', { exact: true })).toHaveCount(
    0
  );
  await expect(page.locator('.page-header .management-status')).toHaveText('Enabled');
  await expect(disconnect).toBeEnabled();
  expect(api.writes).toEqual([]);
});

test('disconnect shows progress and preserves authentication on failure before retry', async ({
  page
}) => {
  const api = await mockOAuth(page);
  api.setAuthenticated(true);
  await page.goto('/app/#/connections/c1');
  const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
  await expect(disconnect).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/connections/c1/oauth/disconnect', async (route) => {
    await held;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Disconnect failed. Try again.' } })
    });
  });
  await disconnect.click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('Disconnect failed. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toBeEmpty();
  await expect(disconnect).toBeEnabled();
  await expect(page.locator('.page-header .management-status')).toHaveText('Enabled');
  await page.unroute('**/connections/c1/oauth/disconnect');
  await disconnect.click();
  await expect(page.getByRole('status')).toHaveText('Disconnected.');
  await expect(disconnect).toBeDisabled();
  await expect(page.locator('.page-header .management-status')).toHaveText(
    'Authentication required'
  );
  await expect(page.getByText('Disconnect failed. Try again.', { exact: true })).toHaveCount(0);
  expect(api.writes).toEqual([{ path: '/connections/c1/oauth/disconnect', body: {} }]);
});

test('disconnect waits for the updated status and does not report success when reload fails', async ({
  page
}) => {
  const api = await mockOAuth(page);
  api.setAuthenticated(true);
  await page.goto('/app/#/connections/c1');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/connections/c1', async (route) => {
    await held;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Could not load connection.' } })
    });
  });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(() => api.writes.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('Could not load connection.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toBeEmpty();
  await page.unroute('**/connections/c1');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Status refreshed.');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
  expect(api.writes).toHaveLength(1);
});

for (const width of [320, 390, 1280]) {
  for (const theme of ['dark', 'light']) {
    test(`repeated status refresh keeps the page still at ${width}px in ${theme}`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockOAuth(page, theme);
      await page.goto('/app/#/connections/c1');
      const auth = page.getByText('Authentication', { exact: true }).locator('..');
      const refresh = auth.getByRole('button').nth(1);
      await expect(refresh).toBeVisible();
      const measure = async () => ({
        buttons: await auth.getByRole('button').evaluateAll((buttons) =>
          buttons.map((button) => {
            const { x, y, width, height } = button.getBoundingClientRect();
            return { x, y, width, height, opacity: getComputedStyle(button).opacity };
          })
        ),
        access: (await page.locator('fieldset').first().boundingBox())!
      });
      const initial = await measure();
      const checkStill = async () => {
        const current = await measure();
        for (let i = 0; i < initial.buttons.length; i += 1) {
          expect(current.buttons[i].opacity, `button ${i} opacity`).toBe(
            initial.buttons[i].opacity
          );
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(current.buttons[i][key], `button ${i} ${key}`).toBeCloseTo(
              initial.buttons[i][key],
              1
            );
          }
        }
        expect(current.access.y, 'Access section stays in place').toBeCloseTo(initial.access.y, 1);
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let requests = 0;
        await page.route('**/connections/c1', async (route) => {
          requests += 1;
          await held;
          await route.fallback();
        });
        try {
          await refresh.click();
          await expect(refresh).toBeDisabled();
          await expect(refresh).toHaveAttribute('aria-busy', 'true');
          await expect(page.getByRole('status')).toHaveText('Refreshing status…');
          await expect.poll(() => requests).toBe(1);
          await checkStill();
          await refresh.evaluate((button) => (button as HTMLButtonElement).click());
          expect(requests).toBe(1);
        } finally {
          release();
        }
        await expect(page.getByRole('status')).toHaveText('Status refreshed.');
        expect(requests).toBe(1);
        await checkStill();
        await expect(refresh).toBeFocused();
        await page.unroute('**/connections/c1');
      }
      if (theme === 'dark' && width !== 320) {
        await page.screenshot({
          path: test.info().outputPath('stable-refresh.png'),
          fullPage: true
        });
      }
    });
  }
}
