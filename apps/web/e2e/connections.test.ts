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
  await page.getByRole('button', { name: 'New connection', exact: true }).click();
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
