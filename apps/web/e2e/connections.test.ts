import { expect, test } from '@playwright/test';

test('create an MCP connection, discover tools, save access, and review exact arguments', async ({
  page
}, testInfo) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const connections: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    const paged = (data: unknown[]) => ({
      data,
      page: { limit: 100, offset: 0, total: data.length }
    });
    if (req.method() !== 'GET') {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      if (url.pathname === '/connections') {
        connections.push({
          ...body,
          id: 'c1',
          allowedMethods: [],
          allowedPathPrefixes: [],
          approvalMethods: [],
          hasCredential: true,
          disabledAt: null
        });
        return reply({ data: connections[0] });
      }
      if (url.pathname === '/connections/c1/tools')
        return reply({
          data: [
            { name: 'lookup', description: 'Look up a record' },
            { name: 'create', description: 'Create a record' }
          ]
        });
      if (url.pathname === '/connections/c1') Object.assign(connections[0], body);
      return reply({ data: connections[0] });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [{ id: 'p1', name: 'Kayvan', preferences: { theme: 'dark', timeFormat: '12h' } }]
      });
    if (url.pathname === '/connections') return reply(paged(connections));
    if (url.pathname === '/connections/c1') return reply({ data: connections[0] });
    if (url.pathname === '/approvals')
      return reply(
        paged([
          {
            id: 'ap1',
            agentId: 'a1',
            taskId: 't1',
            status: 'pending',
            request: {
              kind: 'mcp',
              connectionName: 'Records',
              tool: 'create',
              arguments: { title: 'Exact approved title' },
              baseUrl: 'https://records.test/mcp'
            },
            createdAt: '2026-10-25T14:00:00Z'
          }
        ])
      );
    return reply(paged([]));
  });

  await page.goto('/app/#/catalogs?tab=connections');
  await page.getByRole('button', { name: '+ Create connection', exact: true }).click();
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Create connection', exact: true }) });
  await form.getByLabel('Connection type').selectOption('mcp');
  await form.getByLabel('Name', { exact: true }).fill('Records');
  await form.getByLabel('MCP endpoint URL').fill('https://records.test/mcp');
  await form.getByLabel('Description', { exact: true }).fill('Record tools');
  await form.getByLabel('Credential', { exact: true }).fill('Bearer secret');
  await form.getByRole('button', { name: 'Create connection', exact: true }).click();
  await expect(page.getByText('Records', { exact: true })).toBeVisible();
  expect(writes[0].body).toMatchObject({ kind: 'mcp', allowedTools: [], approvalTools: [] });
  expect(writes[0].body).not.toHaveProperty('allowedMethods');
  await page.getByRole('link', { name: /Records Record tools/ }).click();
  await page.getByText('Discover and manage tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Discover tools', exact: true }).click();
  const lookup = page.getByRole('group', { name: 'lookup', exact: true });
  await lookup.getByLabel('Allowed', { exact: true }).check();
  await expect(lookup.getByLabel('Needs approval', { exact: true })).toBeChecked();
  await lookup.getByLabel('Needs approval', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save tool access', exact: true }).click();
  await expect
    .poll(() => writes.find((write) => write.path === '/connections/c1')?.body)
    .toEqual({ allowedTools: ['lookup'], approvalTools: [] });
  await page.screenshot({ path: testInfo.outputPath('mcp-connections.png'), fullPage: true });

  await page.goto('/app/#/approvals');
  await expect(page.getByText('Exact approved title', { exact: false })).toBeVisible();
  await expect(page.getByText('https://records.test/mcp', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect
    .poll(() => writes.some((write) => write.path === '/approvals/ap1/approve'))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('connection errors stay in their own section and clear on retry', async ({
  page
}, testInfo) => {
  const message = 'Sign in to this connection again in Catalogs before continuing.';
  let fail = true;
  let release: (() => void) | undefined;
  let hold = false;
  const connection = {
    id: 'c1',
    name: 'Records',
    description: 'Record tools',
    kind: 'mcp',
    authMethod: 'header',
    authHeader: 'Authorization',
    baseUrl: 'https://records.test/mcp',
    hasCredential: true,
    disabledAt: null,
    allowedTools: [],
    approvalTools: [],
    allowedMethods: [],
    allowedPathPrefixes: [],
    approvalMethods: []
  };
  const writes: { path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data)
      });
    if (request.method() !== 'GET') {
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (fail) return reply({ error: { message } }, 401);
      return reply({
        data: url.pathname.endsWith('/tools')
          ? [{ name: 'lookup', description: 'Look up a record' }]
          : connection
      });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [
          {
            id: 'p1',
            name: 'Kayvan',
            preferences: { theme: 'dark', timeFormat: '12h' }
          }
        ]
      });
    if (url.pathname === '/connections/c1') return reply({ data: connection });
    const data = url.pathname === '/connections' ? [connection] : [];
    return reply({ data, page: { limit: 100, offset: 0, total: data.length } });
  });
  await page.goto('/app/#/connections/c1');
  const tools = page
    .locator('details')
    .filter({ has: page.getByText('Discover and manage tools', { exact: true }) });
  const credentials = page
    .locator('details')
    .filter({ has: page.getByText('Replace or remove the credential', { exact: true }) });
  await tools.locator('summary').click();
  await credentials.locator('summary').click();
  const discover = tools.getByRole('button', { name: 'Discover tools', exact: true });
  const replace = credentials.getByRole('button', { name: 'Replace', exact: true });
  const remove = credentials.getByRole('button', { name: 'Remove', exact: true });
  await discover.click();
  await expect(tools.getByRole('alert')).toHaveText(message);
  await expect(credentials.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('discovery-error-once.png'), fullPage: true });

  fail = false;
  hold = true;
  await credentials.getByLabel('New credential').fill('Bearer replacement');
  await discover.click();
  await expect(discover).toBeDisabled();
  await expect(replace).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(tools.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => Boolean(release)).toBe(true);
  release!();
  hold = false;
  await expect(tools.getByRole('group', { name: 'lookup', exact: true })).toBeVisible();

  fail = true;
  await tools
    .getByRole('group', { name: 'lookup', exact: true })
    .getByLabel('Allowed', { exact: true })
    .check();
  await tools.getByRole('button', { name: 'Save tool access', exact: true }).click();
  await expect(tools.getByRole('alert')).toHaveText(message);
  await expect(credentials.getByRole('alert')).toHaveCount(0);
  fail = false;
  await tools.getByRole('button', { name: 'Save tool access', exact: true }).click();
  await expect(tools.getByRole('alert')).toHaveCount(0);

  for (const button of [replace, remove]) {
    fail = true;
    await button.click();
    await expect(credentials.getByRole('alert')).toHaveText(message);
    await expect(tools.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(1);
    fail = false;
    await button.click();
    await expect(credentials.getByRole('alert')).toHaveCount(0);
  }
  expect(
    writes.filter((write) => write.path === '/connections/c1').map((write) => write.body)
  ).toEqual([
    { allowedTools: ['lookup'], approvalTools: ['lookup'] },
    { allowedTools: ['lookup'], approvalTools: ['lookup'] },
    { credential: 'Bearer replacement' },
    { credential: 'Bearer replacement' },
    { credential: null },
    { credential: null }
  ]);
});
