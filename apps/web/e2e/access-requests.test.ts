import { expect, test, type Page } from '@playwright/test';

const accessRequest = {
  id: 'ap-access',
  agentId: 'a1',
  taskId: 't1',
  kind: 'capability_access',
  status: 'pending',
  duration: null,
  reason: null,
  decidedAt: null,
  result: null,
  request: {
    kind: 'access',
    targetType: 'connection',
    targetId: 'c1',
    name: 'Wikipedia',
    description: 'Search and read English Wikipedia pages.',
    skillVersion: null,
    scope: { kind: 'http', methods: ['GET'], pathPrefixes: ['/wiki'] },
    reason: 'I need to check the claims in this heat-pump brief.',
    recommendedDuration: 'ongoing',
    durationReason: 'Weekly briefs will need it too.'
  },
  createdAt: '2026-10-26T09:31:00Z'
};

const wikipedia = {
  id: 'c1',
  kind: 'http',
  name: 'Wikipedia',
  description: 'Search and read English Wikipedia pages.',
  baseUrl: 'https://wiki.test',
  authHeader: 'Authorization',
  hasCredential: false,
  allowedMethods: ['GET'],
  allowedPathPrefixes: ['/wiki'],
  approvalMethods: [],
  discoverable: false,
  disabledAt: null
};

async function mockApi(page: Page) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
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
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      writes.push({ method: req.method(), path: url.pathname, body });
      if (url.pathname === '/connections/c1') Object.assign(wikipedia, body);
      return reply({ data: { ...accessRequest, status: 'approved' } });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [{ id: 'p1', name: 'Kayvan', preferences: { theme: 'dark', timeFormat: '12h' } }]
      });
    if (url.pathname === '/agents')
      return reply(paged([{ id: 'a1', name: 'Researcher', purpose: 'Research' }]));
    if (url.pathname === '/approvals') return reply(paged([accessRequest]));
    if (url.pathname === '/connections') return reply(paged([wikipedia]));
    return reply(paged([]));
  });
  return writes;
}

test('approve an access request ongoing after seeing its scope', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const writes = await mockApi(page);

  await page.goto('/app/#/approvals');
  await expect(page.getByText('Access request', { exact: true })).toBeVisible();
  await expect(page.getByText('access to Wikipedia?', { exact: false })).toBeVisible();
  await expect(
    page.getByText('check the claims in this heat-pump brief', { exact: false })
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: /^For this task/ })).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Allow for this task', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Weekly briefs will need it too.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'See the allowed requests', exact: true }).click();
  await expect(page.getByText('GET on /wiki', { exact: true })).toBeVisible();

  await page.getByRole('radio', { name: /^Ongoing/ }).check();
  await page.screenshot({ path: testInfo.outputPath('access-request.png'), fullPage: true });
  await page.getByRole('button', { name: 'Allow ongoing', exact: true }).click();
  await expect
    .poll(() => writes.find((write) => write.path === '/approvals/ap-access/approve')?.body)
    .toEqual({ duration: 'ongoing' });
  expect(errors).toEqual([]);
});

test("decline an access request with Don't allow", async ({ page }) => {
  const writes = await mockApi(page);
  await page.goto('/app/#/approvals');
  await page.getByRole('button', { name: "Don't allow", exact: true }).click();
  await expect
    .poll(() => writes.some((write) => write.path === '/approvals/ap-access/reject'))
    .toBe(true);
  expect(writes.some((write) => write.path.endsWith('/approve'))).toBe(false);
});

test('the access request card fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/app/#/approvals');
  await expect(
    page.getByRole('button', { name: 'Allow for this task', exact: true })
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('mark a connection discoverable from the catalog', async ({ page }) => {
  const writes = await mockApi(page);
  await page.goto('/app/#/catalogs?tab=connections');
  await page.getByLabel('Agents can find this and ask for access').check();
  await expect
    .poll(() => writes.find((write) => write.path === '/connections/c1'))
    .toEqual({ method: 'PATCH', path: '/connections/c1', body: { discoverable: true } });
});
