import { expect, test, type Page } from '@playwright/test';

async function mockConnection(page: Page, oauth = false, theme = 'dark') {
  let connection: Record<string, unknown> = {
    id: 'c1',
    name: 'Records',
    description: 'Read records',
    kind: oauth ? 'mcp' : 'http',
    baseUrl: 'https://records.test',
    authMethod: oauth ? 'oauth' : 'header',
    authHeader: 'Authorization',
    hasCredential: !oauth,
    authenticated: true,
    allowedMethods: ['GET'],
    allowedPathPrefixes: ['/v1'],
    approvalMethods: [],
    allowedTools: ['lookup'],
    approvalTools: ['lookup'],
    discoverable: false,
    disabledAt: null
  };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let fail = false;
  let hold: Promise<void> | undefined;
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data)
      });
    if (req.method() !== 'GET') {
      const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : {};
      writes.push({ path: url.pathname, body });
      if (hold) await hold;
      if (fail) return reply({ error: { message: 'Please try again.' } }, 503);
      if (url.pathname.endsWith('/oauth/disconnect')) connection.authenticated = false;
      else connection = { ...connection, ...body };
      return reply({ data: connection });
    }
    if (url.pathname === '/humans')
      return reply({ data: [{ id: 'p1', name: 'Kayvan', preferences: { theme } }] });
    if (url.pathname === '/connections/c1') return reply({ data: connection });
    return reply({ data: [], page: { total: 0, limit: 100, offset: 0 } });
  });
  return {
    writes,
    fail: (value: boolean) => (fail = value),
    hold: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => (release = resolve));
      return () => {
        hold = undefined;
        release();
      };
    }
  };
}

for (const width of [320, 390, 1440]) {
  for (const theme of ['dark', 'light']) {
    test(`connection editor saves HTTP configuration and discards at ${width}px in ${theme}`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const api = await mockConnection(page, false, theme);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/app/#/connections/c1');
      await page.getByRole('button', { name: 'Edit configuration' }).click();
      await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
      await page.getByLabel('Name', { exact: true }).fill('Changed draft');
      await page.getByLabel('Authentication method').selectOption('none');
      await page.getByRole('button', { name: 'Discard', exact: true }).click();
      expect(api.writes).toEqual([]);
      await expect(page.getByRole('button', { name: 'Edit configuration' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Records');
      await expect(page.getByLabel('Authentication method')).toHaveValue('header');
      await page.getByLabel('Name', { exact: true }).fill('Updated records');
      await page.getByLabel('Description', { exact: true }).fill('Updated description');
      await page.getByLabel('Base URL').fill('https://records.test/v2');
      await page.getByLabel('Credential header').fill('X-API-Key');
      await page
        .getByRole('group', { name: 'Allowed methods', exact: true })
        .getByLabel('POST', { exact: true })
        .check();
      await expect(
        page
          .getByRole('group', { name: "Need a person's approval", exact: true })
          .getByLabel('POST', { exact: true })
      ).toBeChecked();
      await page.getByLabel(/^Allowed paths/).fill('/v2/issues\n/v2/users');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const form = page.getByRole('form', { name: 'Edit connection configuration' });
      const box = await form.boundingBox();
      const input = await page.getByLabel('Name', { exact: true }).boundingBox();
      expect(input!.x).toBeGreaterThanOrEqual(box!.x);
      expect(input!.x + input!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
      await page
        .getByRole('button', { name: 'Save changes', exact: true })
        .scrollIntoViewIfNeeded();
      const save = await page.locator('.savebar').boundingBox();
      expect(save!.y + save!.height).toBeLessThanOrEqual(1001);
      await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
      api.fail(true);
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(form.getByText('Please try again.')).toBeVisible();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Updated records');
      await expect(page.getByLabel('Credential header')).toHaveValue('X-API-Key');
      api.fail(false);
      const release = api.hold();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
      await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
      release();
      await expect(
        page.getByRole('heading', { name: 'Updated records', exact: true })
      ).toBeVisible();
      expect(api.writes[1]).toEqual({
        path: '/connections/c1',
        body: {
          name: 'Updated records',
          description: 'Updated description',
          baseUrl: 'https://records.test/v2',
          authHeader: 'X-API-Key',
          allowedMethods: ['GET', 'POST'],
          allowedPathPrefixes: ['/v2/issues', '/v2/users'],
          approvalMethods: ['POST']
        }
      });
      await page.reload();
      await page.getByRole('button', { name: 'Edit configuration' }).click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Updated records');
      await expect(page.getByLabel(/^Allowed paths/)).toHaveValue('/v2/issues\n/v2/users');
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
      expect(errors).toEqual([]);
    });
  }
}

test('connection editor preserves OAuth on rename and requires explicit disconnect for endpoint changes', async ({
  page
}) => {
  const api = await mockConnection(page, true);
  await page.goto('/app/#/connections/c1');
  await page.getByRole('button', { name: 'Edit configuration' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Renamed MCP');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Renamed MCP' })).toBeVisible();
  expect(api.writes).toEqual([{ path: '/connections/c1', body: { name: 'Renamed MCP' } }]);
  await expect(page.getByRole('button', { name: 'Sign in again', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit configuration' }).click();
  await expect(page.getByLabel('Authentication method').locator('option')).toHaveCount(3);
  await page.getByLabel('MCP endpoint URL').fill('https://other.test/mcp');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  api.fail(true);
  await page.getByRole('button', { name: 'Disconnect OAuth', exact: true }).click();
  await expect(page.getByText('Please try again.')).toBeVisible();
  await expect(page.getByLabel('MCP endpoint URL')).toHaveValue('https://other.test/mcp');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  api.fail(false);
  await page.getByRole('button', { name: 'Disconnect OAuth', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(api.writes.at(-1)).toEqual({
    path: '/connections/c1',
    body: { baseUrl: 'https://other.test/mcp' }
  });
  await expect(
    page.getByText('Allowed tools: lookup. Needs approval: lookup.', { exact: true })
  ).toBeVisible();
});

test('connection editor changes authentication without resending credentials or HTTP-only OAuth', async ({
  page
}) => {
  const api = await mockConnection(page);
  await page.goto('/app/#/connections/c1');
  await page.getByRole('button', { name: 'Edit configuration' }).click();
  await expect(page.getByLabel('Authentication method').locator('option')).toHaveCount(2);
  await page.getByLabel('Authentication method').selectOption('none');
  await expect(
    page.getByText('Saving this authentication method removes the saved header credential.')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit configuration' })).toBeVisible();
  expect(api.writes).toEqual([{ path: '/connections/c1', body: { authMethod: 'none' } }]);
});
