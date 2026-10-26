import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  test(`OAuth consent, status, reconnect and disconnect at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let status = 'header';
    const writes: string[] = [];
    await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
      const reply = (value: unknown) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (url.pathname === '/consent') {
        status = 'connected';
        return route.fulfill({
          contentType: 'text/html',
          body: '<a href="/app/#/connections/c1?oauth=connected">Allow Juniper documentation access</a>'
        });
      }
      if (url.pathname.startsWith('/app/')) return route.continue();
      if (req.method() !== 'GET') {
        writes.push(url.pathname);
        if (url.pathname.endsWith('/oauth/connect')) {
          status = 'pending';
          return reply({ data: { authorizationUrl: 'http://127.0.0.1:5190/consent' } });
        }
        if (url.pathname.endsWith('/oauth/disconnect')) {
          status = 'disconnected';
          return reply({ data: { status } });
        }
        return reply({ data: {} });
      }
      if (url.pathname === '/humans')
        return reply({
          data: [{ id: 'p1', name: 'Kayvan', preferences: { theme: 'dark', timeFormat: '12h' } }]
        });
      if (url.pathname === '/connections/c1/oauth')
        return reply({ data: { status, expiresAt: null } });
      const data =
        url.pathname === '/connections' || url.pathname === '/connections/c1'
          ? [
              {
                id: 'c1',
                name: 'Juniper Parcel — Notion',
                kind: 'mcp',
                description: 'Fictional company docs',
                baseUrl: 'https://mcp.notion.com/mcp',
                allowedTools: [],
                approvalTools: [],
                allowedMethods: [],
                allowedPathPrefixes: [],
                approvalMethods: [],
                hasCredential: false,
                disabledAt: null
              }
            ]
          : [];
      if (url.pathname === '/connections/c1') return reply({ data: data[0] });
      return reply({ data, page: { limit: 100, offset: 0, total: data.length } });
    });
    await page.goto('/app/#/connections/c1');
    await page.getByText('Sign in with OAuth', { exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Allow Juniper documentation access' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Signed in. Discover tools' })
    ).toBeVisible();
    await page.getByText('Sign in with OAuth', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
    const buttons = page
      .locator('details')
      .filter({ has: page.getByText('Sign in with OAuth', { exact: true }) })
      .getByRole('button');
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (width <= 390) expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Disconnected.' })).toBeVisible();
    expect(writes).toEqual(['/connections/c1/oauth/connect', '/connections/c1/oauth/disconnect']);
  });
}
