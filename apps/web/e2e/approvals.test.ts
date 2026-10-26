import { expect, test, type Page } from '@playwright/test';

async function mockApi(page: Page, theme = 'dark') {
  let empty = false;
  let failHistory = false;
  let pending = true;
  const requests: string[] = [];
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/humans')
      return reply({ data: [{ id: 'p1', name: 'Kayvan', preferences: { theme } }] });
    if (request.method() === 'POST') {
      expect(url.pathname).toBe('/approvals/pending/approve');
      pending = false;
      return reply({ data: {} });
    }
    let data: unknown[] = [];
    if (url.pathname === '/approvals') {
      const status = url.searchParams.get('status')!;
      requests.push(status);
      if (failHistory && status !== 'pending')
        return reply({ error: { message: 'History unavailable' } }, 503);
      const approval = (id: string, path: string, status: string, decidedAt: string | null) => ({
        id,
        agentId: 'a1',
        taskId: 't1',
        status,
        createdAt: '2026-10-25T12:00:00Z',
        decidedAt,
        reason: status === 'rejected' ? 'Outside scope' : 'Reviewed',
        request: { method: 'POST', path, connectionName: 'Records' },
        result: status === 'approved' ? { status: 201 } : null
      });
      if (!empty) {
        if (status === 'pending' && pending) data = [approval('pending', '/waiting', status, null)];
        if (status === 'approved')
          data = [approval('approved', '/allowed', status, '2026-10-25T13:00:00Z')];
        if (status === 'rejected')
          data = [approval('rejected', '/denied', status, '2026-10-25T14:00:00Z')];
        if (status === 'approved' && !pending)
          data.push(approval('pending', '/waiting', status, '2026-10-25T15:00:00Z'));
      }
    }
    return reply({ data, page: { limit: 100, offset: 0, total: data.length } });
  });
  return { requests, empty: () => (empty = true), failHistory: () => (failHistory = true) };
}

for (const width of [1440, 390]) {
  for (const theme of ['dark', 'light']) {
    test(`approval tabs and layout at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const api = await mockApi(page, theme);
      await page.goto('/app/#/agents');
      const header = await page.locator('.page-header').boundingBox();
      await page.goto('/app/#/approvals');
      const pending = page.getByRole('button', { name: 'Pending', exact: true });
      await expect(pending).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('POST /waiting', { exact: true })).toBeVisible();
      expect(api.requests).not.toContain('approved');
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      const approvalHeader = await page.locator('.page-header').boundingBox();
      const filters = await page.getByLabel('Filter approvals').boundingBox();
      expect(approvalHeader!.x).toBe(header!.x);
      expect(approvalHeader!.width).toBe(header!.width);
      expect(approvalHeader!.y).toBe(header!.y);
      expect(filters!.x).toBe(header!.x);
      expect(filters!.y - approvalHeader!.y - approvalHeader!.height).toBe(24);
      await page.screenshot({ path: testInfo.outputPath('pending.png'), fullPage: true });
      await page.getByRole('button', { name: 'History', exact: true }).click();
      await expect(page.getByText('POST /allowed', { exact: true })).toBeVisible();
      await expect(page.getByText('POST /waiting', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
      await expect(page.locator('.list li')).toHaveCount(2);
      await expect(page.locator('.list li').first()).toContainText('/denied');
      await expect(page.locator('.list')).toContainText('Outside scope');
      await expect(page.locator('.list')).toContainText('HTTP 201');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: testInfo.outputPath('history.png'), fullPage: true });
      await pending.click();
      await expect(page.getByText('POST /waiting', { exact: true })).toBeVisible();
    });
  }
}

test('deciding a request moves it from Pending to History', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app/#/approvals');
  await page.getByRole('button', { name: 'Allow once' }).click();
  await expect(page.getByText('Nothing waiting for you.')).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.list li').first()).toContainText('/waiting');
});

test('empty and failed history states stay separate from Pending', async ({ page }) => {
  const api = await mockApi(page);
  api.empty();
  await page.goto('/app/#/approvals');
  await expect(page.getByText('Nothing waiting for you.')).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('No past decisions yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Pending', exact: true }).click();
  api.failHistory();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('History unavailable')).toBeVisible();
  await expect(page.getByText('No past decisions yet.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pending', exact: true }).click();
  await expect(page.getByText('History unavailable')).toHaveCount(0);
  await expect(page.getByText('Nothing waiting for you.')).toBeVisible();
});
