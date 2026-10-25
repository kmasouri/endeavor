import { expect, test, type Page } from '@playwright/test';

const first = {
  id: 'v1',
  version: 1,
  instructions: 'Find sources.',
  provider: 'openai',
  model: 'test',
  skillVersionIds: ['sv1'],
  skillIds: ['s1'],
  connectionIds: ['c1'],
  limits: {},
  createdAt: '2026-10-24T10:00:00Z'
};
const latest = {
  ...first,
  id: 'v2',
  version: 2,
  instructions: 'Find sources and cite each claim.',
  connectionIds: ['c1', 'c2']
};
async function mockApi(page: Page, theme = 'dark', empty = false, legacy = false) {
  const agents = empty
    ? []
    : [
        {
          id: 'a1',
          name: 'Researcher',
          purpose: 'Researches topics and drafts briefs',
          currentVersionId: 'v2',
          currentVersion: legacy
            ? {
                ...latest,
                connectionIds: [],
                legacyConnectionIds: ['c1'],
                limits: {
                  maxModelTurns: 12,
                  maxTokens: 1000,
                  maxCostUsd: 0.5,
                  maxWorkingMinutes: 10
                }
              }
            : latest,
          disabledAt: null,
          providerReady: true
        },
        {
          id: 'a2',
          name: 'QA',
          purpose: 'Tests the staging site',
          currentVersionId: 'v1',
          currentVersion: first,
          disabledAt: '2026-10-24',
          providerReady: true
        },
        {
          id: 'a3',
          name: 'Checker',
          purpose: 'Checks an API',
          currentVersionId: 'v1',
          currentVersion: first,
          disabledAt: null,
          providerReady: false
        }
      ];
  const versions = [latest, first];
  const tasks = [
    {
      id: 't1',
      title: 'Research heat pumps',
      ownerAgentId: 'a1',
      agentVersionId: 'v1',
      state: 'waiting',
      pausedAt: null
    }
  ];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
      const body = (req.postData() ? req.postDataJSON() : {}) as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/config')) {
        const next = { ...latest, id: 'v3', version: 3, ...body };
        agents[0] = { ...agents[0], currentVersionId: next.id, currentVersion: next };
        versions.unshift(next);
        return reply({ data: agents[0] });
      }
      if (url.pathname === '/tasks/t1/version') tasks[0].agentVersionId = String(body.versionId);
      if (url.pathname.endsWith('/disable')) agents[0].disabledAt = '2026-10-25';
      if (url.pathname.endsWith('/enable')) agents[0].disabledAt = null;
      if (url.pathname === '/agents') return reply({ data: { id: 'a1' } });
      return reply({ data: agents[0] });
    }
    if (url.pathname === '/humans')
      return reply({
        data: [{ id: 'p1', name: 'Kayvan', preferences: { theme, timeFormat: '12h' } }]
      });
    if (url.pathname === '/agents') return reply(paged(agents));
    if (url.pathname.endsWith('/costs'))
      return reply({
        data: {
          thisMonth: { costUsd: 3.12, tokens: 12, unpricedCalls: 0 },
          total: { costUsd: 5, tokens: 20, unpricedCalls: 0 },
          budgetUsd: 20,
          tasks: []
        }
      });
    if (url.pathname.endsWith('/deletion-impact'))
      return reply({
        data: { tasks, schedules: [{ id: 'r1', title: 'Daily brief', status: 'enabled' }] }
      });
    if (url.pathname.endsWith('/versions')) return reply({ data: versions });
    if (/^\/agents\/a/.test(url.pathname) && !url.pathname.endsWith('/notes'))
      return reply({ data: agents[0] });
    if (url.pathname === '/tasks') return reply(paged(tasks));
    if (url.pathname === '/providers')
      return reply({
        data: [
          { provider: 'openai', ready: true, setup: 'Ready' },
          { provider: 'scripted', ready: true, setup: 'Test provider' }
        ]
      });
    if (url.pathname === '/skills')
      return reply(
        paged([
          {
            id: 's1',
            name: 'Cite sources',
            description: 'Citations',
            currentVersionId: 'sv1',
            disabledAt: null
          },
          ...Array.from({ length: 8 }, (_, i) => ({
            id: `s${i + 2}`,
            name: `Brief ${i + 1}`,
            description: 'Plain language',
            disabledAt: null
          }))
        ])
      );
    if (url.pathname === '/connections')
      return reply(
        paged([
          { id: 'c1', name: 'Web search', description: 'Search API', disabledAt: null },
          { id: 'c2', name: 'Docs', description: 'Read docs', disabledAt: null }
        ])
      );
    return reply(paged([]));
  });
  return { writes, errors };
}

for (const theme of ['dark', 'light']) {
  for (const width of [1440, 390]) {
    test(`Agents layout and tabs in ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await mockApi(page, theme);
      await page.goto('/app/#/agents');
      await expect(page.getByRole('heading', { name: 'Researcher agent' })).toBeVisible();
      await expect(page.getByText('$3.12', { exact: false }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Disabled', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'QA agent' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Researcher agent' })).toHaveCount(0);
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search agents' }).fill('Research');
      await expect(page.getByRole('heading', { name: 'QA agent' })).toHaveCount(0);
      await page.screenshot({ path: `/tmp/ca57-list-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('heading', { name: 'Researcher agent' }).click();
      await expect(page.getByRole('heading', { name: 'Current configuration' })).toBeVisible();
      for (const tab of ['Configuration', 'Versions · 2', 'Overview']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        await page.screenshot({
          path: `/tmp/ca57-${tab.split(' ')[0]}-${theme}-${width}.png`,
          fullPage: true
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
      }
      await page.screenshot({ path: `/tmp/ca57-${theme}-${width}.png`, fullPage: true });
      expect(state.errors).toEqual([]);
    });
  }
}

test('configuration picker removal, undo, save, and version migration', async ({ page }) => {
  const { writes, errors } = await mockApi(page);
  await page.goto('/app/#/agents/a1');
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Web search', exact: true }).click();
  await expect(
    page.getByText('When you save, open tasks stop using it too', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo removal of Web search' }).click();
  await expect(
    page.getByText('When you save, open tasks stop using it too', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Web search', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Add skills' }).fill('Brief');
  await expect(page.getByRole('button', { name: /Brief.*Add/ })).toHaveCount(5);
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    path: '/agents/a1/config',
    body: expect.objectContaining({ connectionIds: ['c2'] })
  });
  await page.getByRole('button', { name: 'Versions · 3' }).click();
  await page.getByRole('button', { name: 'Move 1 task to v3' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({
    path: '/tasks/t1/version',
    body: expect.objectContaining({ versionId: 'v3' })
  });
  expect(errors).toEqual([]);
});

test('examples only fill the separate creation form', async ({ page }) => {
  const { writes, errors } = await mockApi(page, 'light', true);
  await page.goto('/app/#/agents');
  await page.getByRole('heading', { name: 'Researcher', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New agent' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Researcher');
  expect(writes).toEqual([]);
  await expect(page.getByText('Limits per task', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('creates an agent from the narrow example form only after submit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { writes, errors } = await mockApi(page);
  await page.goto('/app/#/agents/new?example=researcher');
  await page.getByRole('textbox', { name: 'Model', exact: true }).fill('test-model');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    path: '/agents',
    body: expect.objectContaining({
      name: 'Researcher',
      model: 'test-model',
      instructions: expect.stringContaining('Cite a source')
    })
  });
  await expect(page.getByRole('heading', { name: 'Current configuration' })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const kind of ['skill', 'connection']) {
  test(`${kind} picker opens before typing, filters, selects, and dismisses`, async ({ page }) => {
    const { writes, errors } = await mockApi(page);
    await page.setViewportSize({ width: kind === 'skill' ? 1440 : 390, height: 1000 });
    await page.goto('/app/#/agents/new');
    const input = page.getByRole('searchbox', { name: `Add ${kind}s` });
    const results = page.getByRole('region', { name: `${kind} matches` });
    await expect(results).toHaveCount(0);
    await input.click();
    await expect(input).toHaveValue('');
    await expect(results).toBeVisible();
    await expect(results.getByRole('button')).toHaveCount(kind === 'skill' ? 5 : 2);
    await page.screenshot({ path: `/tmp/ca57-${kind}-dropdown.png`, fullPage: true });
    await input.press('Escape');
    await expect(results).toHaveCount(0);
    await expect(input).toBeFocused();
    await input.click();
    await expect(results).toBeVisible();
    const name = kind === 'skill' ? 'Cite sources' : 'Web search';
    await input.fill(kind === 'skill' ? 'Cite' : 'Web');
    await expect(results.getByRole('button')).toHaveCount(1);
    await input.press('ArrowDown');
    await expect(results.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(results.getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Name', exact: true }).click();
    await expect(results).toHaveCount(0);
    await input.focus();
    await expect(results).toBeVisible();
    await input.fill('does-not-exist');
    await expect(results.getByText(`No matching ${kind}s.`)).toBeVisible();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('permanent deletion previews affected work and requires confirmation', async ({ page }) => {
  const { writes } = await mockApi(page);
  await page.goto('/app/#/agents/a1');
  await page.getByRole('button', { name: 'Delete agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Daily brief');
  await expect(dialog).toContainText('Research heat pumps');
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes.filter((w) => w.path === '/agents/a1')).toHaveLength(0);
  await page.getByRole('button', { name: 'Delete agent', exact: true }).click();
  const confirm = dialog.getByRole('button', { name: 'Delete permanently', exact: true });
  await expect(confirm).toBeDisabled();
  const name = dialog.getByRole('textbox');
  await expect(name).toHaveValue('');
  for (const wrong of ['QA', 'researcher', 'Researcher ']) {
    await name.fill(wrong);
    await expect(confirm).toBeDisabled();
  }
  expect(writes.filter((w) => w.path === '/agents/a1')).toHaveLength(0);
  await name.fill('Researcher');
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: '/tmp/ca63-delete-name.png', fullPage: true });
  await confirm.click();
  await expect(page).toHaveURL(/#\/agents$/);
  expect(writes.filter((w) => w.path === '/agents/a1')).toHaveLength(1);
});

test('failed deletion preview prevents confirmation and Escape restores focus', async ({
  page
}) => {
  const { writes } = await mockApi(page);
  await page.route('**/agents/a1/deletion-impact', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Preview unavailable' } })
    })
  );
  await page.goto('/app/#/agents/a1');
  const opener = page.getByRole('button', { name: 'Delete agent', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Preview unavailable');
  await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(writes).toHaveLength(0);
});

for (const theme of ['dark', 'light']) {
  for (const width of [390, 1440]) {
    test(`agent controls have clear placement in ${theme} at ${width}px`, async ({ page }) => {
      await mockApi(page, theme);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/app/#/agents/a1');
      const header = page.locator('.agent-detail-header');
      const toggle = header.getByRole('button', { name: 'Disable agent', exact: true });
      await expect(toggle).toBeVisible();
      await expect(header.getByRole('button', { name: 'Delete agent', exact: true })).toHaveCount(
        0
      );
      const section = page.getByRole('region', { name: 'Delete agent', exact: true });
      await expect(section).toContainText('Shared history and costs stay available.');
      const overview = await page.locator('.agent-overview').boundingBox();
      const deletion = await section.boundingBox();
      expect(deletion!.y).toBeGreaterThanOrEqual(overview!.y + overview!.height);
      await page.screenshot({ path: `/tmp/ca63-placement-${theme}-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await toggle.click();
      await expect(header.getByRole('button', { name: 'Enable agent', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Configuration', exact: true }).click();
      await expect(section).toHaveCount(0);
      await expect(header.getByRole('button', { name: 'Enable agent', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
      await section.getByRole('button', { name: 'Delete agent', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' })
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(
        section.getByRole('button', { name: 'Delete agent', exact: true })
      ).toBeFocused();
    });
  }
}

for (const legacy of [false, true]) {
  test(`discard leaves configuration and restores saved values with legacy connections ${legacy}`, async ({
    page
  }) => {
    const { writes, errors } = await mockApi(page, 'dark', false, legacy);
    await page.clock.install();
    await page.setViewportSize({ width: legacy ? 390 : 1440, height: 1000 });
    await page.goto('/app/#/agents/a1');
    const configuration = page.getByRole('button', { name: 'Configuration', exact: true });
    const overview = page.getByRole('button', { name: 'Overview', exact: true });
    await configuration.click();
    const form = page.locator('form.creation-form');
    const instructions = form.getByRole('textbox', { name: /^Instructions/ });
    const model = form.getByRole('textbox', { name: 'Model', exact: true });
    const provider = form.getByRole('combobox', { name: 'Provider', exact: true });
    const limits = ['Model turns', 'Tokens', 'Cost, $', 'Working minutes'];
    await instructions.fill('Unsaved instructions');
    await model.fill('unsaved-model');
    await provider.selectOption('scripted');
    await form.getByRole('button', { name: 'Remove Cite sources', exact: true }).click();
    await form.getByRole('searchbox', { name: 'Add skills' }).fill('Brief 1');
    await form.getByRole('region', { name: 'skill matches' }).getByRole('button').click();
    if (legacy) {
      await expect(form.getByRole('status')).toContainText('inherited connections: Web search');
      await form.getByRole('searchbox', { name: 'Add connections' }).fill('Web');
      await form.getByRole('region', { name: 'connection matches' }).getByRole('button').click();
    } else {
      await form.getByRole('button', { name: 'Remove Web search', exact: true }).click();
    }
    await form.getByText('Limits per task', { exact: false }).click();
    for (const label of limits) {
      await form.getByRole('textbox', { name: label, exact: true }).fill('99');
    }
    await form.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(overview).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Current configuration' })).toBeVisible();
    await expect(form).toHaveCount(0);
    await page.screenshot({
      path: `/tmp/ca67-discard-${legacy ? 'legacy' : 'explicit'}.png`,
      fullPage: true
    });
    expect(writes).toEqual([]);

    await configuration.click();
    const assertSaved = async () => {
      await expect(instructions).toHaveValue(latest.instructions);
      await expect(model).toHaveValue(latest.model);
      await expect(provider).toHaveValue(latest.provider);
      await expect(
        form.getByRole('button', { name: 'Remove Cite sources', exact: true })
      ).toBeVisible();
      await expect(form.getByRole('button', { name: 'Remove Brief 1', exact: true })).toHaveCount(
        0
      );
      await expect(form.getByRole('button', { name: /Undo removal/ })).toHaveCount(0);
      await expect(form.getByRole('searchbox', { name: 'Add skills' })).toHaveValue('');
      await expect(form.getByRole('searchbox', { name: 'Add connections' })).toHaveValue('');
      if (legacy) {
        await expect(form.getByText('No connections chosen.', { exact: true })).toBeVisible();
        await expect(form.getByRole('status')).toContainText('inherited connections: Web search');
      } else {
        for (const name of ['Web search', 'Docs']) {
          await expect(
            form.getByRole('button', { name: `Remove ${name}`, exact: true })
          ).toBeVisible();
        }
      }
      for (const [i, label] of limits.entries()) {
        await expect(form.getByRole('textbox', { name: label, exact: true })).toHaveValue(
          legacy ? ['12', '1000', '0.5', '10'][i] : ''
        );
      }
    };
    await form.getByText('Limits per task', { exact: false }).click();
    await assertSaved();
    // A parent update from task polling must not revive the discarded draft.
    const poll = page.waitForResponse((response) => new URL(response.url()).pathname === '/tasks');
    await page.clock.fastForward(10_001);
    await poll;
    await assertSaved();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
