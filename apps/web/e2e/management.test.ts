import { expect, test, type Page } from '@playwright/test';

async function mockApi(page: Page, theme: string) {
  const writes: { path: string; body: unknown }[] = [];
  const skills = [
    {
      id: 's1',
      name: 'Research',
      description: 'Write sourced briefs',
      disabledAt: null,
      currentVersionId: 'v1'
    },
    {
      id: 's2',
      name: 'Review',
      description: 'Check claims',
      disabledAt: '2026-10-25',
      currentVersionId: 'v2'
    }
  ];
  const connections = [
    {
      id: 'c1',
      name: 'Records',
      description: 'Read records',
      kind: 'http',
      disabledAt: null,
      baseUrl: 'https://records.test',
      hasCredential: true,
      authHeader: 'Authorization',
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/'],
      approvalMethods: []
    },
    {
      id: 'c2',
      name: 'Tools',
      description: 'Remote tools',
      kind: 'mcp',
      disabledAt: '2026-10-25',
      baseUrl: 'https://tools.test/mcp',
      hasCredential: false,
      allowedTools: [],
      approvalTools: []
    }
  ];
  const responsibilities = ['enabled', 'paused', 'cancelled'].map((status, i) => ({
    id: `r${i}`,
    title: `${status} check`,
    agentId: 'a1',
    status,
    nextRunAt: '2026-10-27T12:00:00Z',
    intervalMinutes: 10,
    recurrence: null,
    catchUp: null
  }));
  let failSave = false;
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const paged = (data: unknown[], total = data.length) =>
      reply({ data, page: { total, offset: 0, limit: 100 } });
    if (req.method() !== 'GET') {
      writes.push({ path: url.pathname, body: req.postData() ? req.postDataJSON() : null });
      if (failSave) return reply({ error: { message: 'Save unavailable' } }, 503);
      if (url.pathname === '/skills/s1/disable') skills[0].disabledAt = '2026-10-26';
      if (url.pathname === '/skills/s1/enable') skills[0].disabledAt = null;
      if (url.pathname === '/skills/s1/versions') skills[0].currentVersionId = 'v3';
      return reply({ data: {} });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [{ id: 'p1', name: 'Kayvan', preferences: { theme, timeFormat: '12h' } }]
      });
    if (url.pathname === '/skills') {
      // Deliberately paginate to ensure filters include records beyond the first page.
      return paged([skills[Number(url.searchParams.get('offset')) || 0]], 2);
    }
    if (url.pathname === '/skills/s1')
      return reply({
        data: {
          ...skills[0],
          currentVersion: {
            id: skills[0].currentVersionId,
            version: skills[0].currentVersionId === 'v3' ? 3 : 1,
            instructions: 'Cite every source.'
          }
        }
      });
    if (url.pathname === '/connections') return paged(connections);
    if (url.pathname === '/connections/c1') return reply({ data: connections[0] });
    if (url.pathname === '/responsibilities') return paged(responsibilities);
    if (url.pathname === '/agents')
      return paged([{ id: 'a1', name: 'Checker', purpose: 'Check APIs', disabledAt: null }]);
    return paged([]);
  });
  return { writes, failSave: (fail: boolean) => (failSave = fail) };
}

for (const width of [1440, 390]) {
  for (const theme of ['dark', 'light']) {
    test(`management lists align and filter at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await mockApi(page, theme);
      await page.goto('/app/#/agents');
      await expect(page.locator('.agent-row')).toHaveCount(1);
      const reference = (await page.locator('.page-header').boundingBox())!;
      for (const [kind, total] of [
        ['skills', 2],
        ['connections', 2],
        ['schedules', 3]
      ] as const) {
        await page.goto(`/app/#/${kind}`);
        const rows = page.locator(kind === 'schedules' ? '.schedule-row' : '.management-row');
        await expect(rows).toHaveCount(total);
        const header = (await page.locator('.page-header').boundingBox())!;
        const row = (await rows.first().boundingBox())!;
        expect(Math.abs(header.x - reference.x)).toBeLessThan(1);
        expect(Math.abs(header.width - reference.width)).toBeLessThan(1);
        expect(Math.abs(row.x - header.x)).toBeLessThan(1);
        expect(Math.abs(row.width - header.width)).toBeLessThan(1);
        const filter = page.getByRole('button', {
          name: kind === 'schedules' ? 'Cancelled' : 'Disabled',
          exact: true
        });
        await filter.click();
        await expect(filter).toHaveAttribute('aria-pressed', 'true');
        await expect(rows).toHaveCount(1);
        await page.getByRole('searchbox').fill('no-match');
        await expect(rows).toHaveCount(0);
        await expect(page.getByText(`No ${kind} match your filters.`)).toBeVisible();
        await page.getByRole('searchbox').fill('');
        await page.getByRole('button', { name: 'All', exact: true }).click();
        await expect(rows).toHaveCount(total);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        await page.screenshot({ path: info.outputPath(`${kind}.png`), fullPage: true });
      }
    });
  }
}

test('skill configuration keeps failed edits, saves versions, and reports enable failures', async ({
  page
}) => {
  const api = await mockApi(page, 'dark');
  await page.goto('/app/#/skills');
  const row = page.getByRole('link', { name: /Research Write sourced briefs/ });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/skills\/s1$/);
  await page.getByLabel('Instructions', { exact: true }).fill('Use primary sources.');
  api.failSave(true);
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText('Save unavailable')).toBeVisible();
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
    'Use primary sources.'
  );
  api.failSave(false);
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText('Version 3', { exact: true })).toBeVisible();
  expect(api.writes.at(-1)).toEqual({
    path: '/skills/s1/versions',
    body: { instructions: 'Use primary sources.' }
  });
  api.failSave(true);
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.getByText('Save unavailable')).toBeVisible();
  await expect(page.getByText('Enabled', { exact: true })).toBeVisible();
  api.failSave(false);
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Skills' }).click();
  await page.getByRole('button', { name: 'Disabled', exact: true }).click();
  await expect(page.locator('.management-row')).toHaveCount(2);
});

test('legacy catalogs select the right separate sidebar destination', async ({ page }) => {
  await mockApi(page, 'dark');
  for (const kind of ['skills', 'connections']) {
    await page.goto(`/app/#/catalogs?tab=${kind}`);
    await expect(
      page.getByRole('link', { name: kind === 'skills' ? 'Skills' : 'Connections', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.management-row')).toHaveCount(2);
  }
});
