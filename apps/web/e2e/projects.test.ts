import { expect, test, type Page } from '@playwright/test';
import type { ConversationDetails, ProjectDetails } from '../src/api';
import { captureReviewScreenshot } from './review-screenshot';

async function fixture(page: Page, theme = 'light') {
  const person = {
    id: 'person',
    name: 'Kayvan',
    role: 'admin',
    preferences: { theme, timeFormat: '12h' }
  };
  const member = {
    participant: { type: 'human' as const, id: person.id },
    name: person.name,
    purpose: null,
    historyFrom: null
  };
  const projects: ProjectDetails[] = [
    {
      id: 'alpha',
      name: 'Alpha',
      isDefault: true,
      archivedAt: null,
      createdAt: '2026-11-04T01:00:00Z',
      members: [member]
    },
    {
      id: 'beta',
      name: 'Beta',
      isDefault: false,
      archivedAt: null,
      createdAt: '2026-11-04T01:00:00Z',
      members: [member]
    }
  ];
  const conversations: ConversationDetails[] = [
    {
      id: 'open',
      projectId: 'alpha',
      title: 'open-goal',
      goal: 'Build a report',
      doneCriteria: 'The report is checked',
      state: 'open',
      members: [member],
      createdAt: '2026-11-04T01:00:00Z'
    },
    {
      id: 'closed',
      projectId: 'alpha',
      title: 'old-goal',
      goal: 'Old request',
      doneCriteria: 'Finished',
      state: 'closed',
      members: [member],
      createdAt: '2026-11-04T01:00:00Z'
    },
    {
      id: 'other',
      projectId: 'beta',
      title: 'other-project',
      goal: 'Beta request',
      doneCriteria: 'Finished',
      state: 'open',
      members: [member],
      createdAt: '2026-11-04T01:00:00Z'
    }
  ];
  const state = {
    projects,
    conversations,
    docs: [] as { id: string; title: string; content: string }[],
    writes: [] as { path: string; method: string; body: Record<string, unknown> }[],
    messages: [] as Record<string, unknown>[],
    failMessage: false,
    failGoal: false,
    failProjects: false,
    failClose: false
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'person'));
  await page.route('**/*', async (route) => {
    const r = route.request(),
      u = new URL(r.url()),
      method = r.method(),
      path = u.pathname;
    if (u.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (path.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const list = (data: unknown[]) => ({
      data,
      page: { limit: 100, offset: 0, total: data.length }
    });
    const body = method === 'GET' ? {} : (r.postDataJSON() ?? {});
    if (method !== 'GET') state.writes.push({ path, method, body });
    if (path === '/humans') return reply({ data: [person] });
    if (path === '/directory') return reply({ data: [] });
    if (path === '/projects' && method === 'POST') {
      const p = { ...projects[1], id: 'new-project', name: body.name, members: [member] };
      projects.push(p);
      return reply({ data: p }, 201);
    }
    if (path === '/projects') {
      if (state.failProjects) return reply({ error: { message: 'Projects unavailable' } }, 503);
      return reply(
        list(
          projects.filter(
            (p) => Boolean(p.archivedAt) === (u.searchParams.get('archived') === 'true')
          )
        )
      );
    }
    const p = /^\/projects\/([^/]+)$/.exec(path);
    if (p) {
      const project = projects.find((item) => item.id === p[1])!;
      if (method === 'PATCH') {
        if (body.name) project.name = body.name;
        if ('icon' in body) project.icon = body.icon as ProjectDetails['icon'];
        if ('color' in body) project.color = body.color as ProjectDetails['color'];
        if ('archived' in body) project.archivedAt = body.archived ? '2026-11-04T01:00:00Z' : null;
      }
      return reply({ data: project });
    }
    if (/^\/projects\/[^/]+\/documents/.test(path)) {
      if (method === 'POST') {
        state.docs.push({ id: 'doc', ...body } as (typeof state.docs)[number]);
        return reply({ data: state.docs.at(-1) }, 201);
      }
      if (method === 'DELETE') {
        state.docs = [];
        return reply({});
      }
      return reply({ data: state.docs });
    }
    if (path === '/conversations' && method === 'POST') {
      const c = {
        ...conversations[0],
        id: 'created',
        title: body.title,
        projectId: body.projectId,
        goal: null,
        doneCriteria: null
      };
      conversations.push(c);
      return reply({ data: c }, 201);
    }
    if (path === '/conversations')
      return reply(
        list(
          conversations.filter(
            (c) =>
              (!u.searchParams.has('projectId') ||
                c.projectId === u.searchParams.get('projectId')) &&
              (u.searchParams.get('state') === 'all' || c.state === 'open')
          )
        )
      );
    const c = /^\/conversations\/([^/]+)(?:\/(close|reopen))?$/.exec(path);
    if (c) {
      const conversation = conversations.find((item) => item.id === c[1])!;
      if (c[2] && state.failClose) return reply({ error: { message: 'Close failed' } }, 503);
      if (c[2]) conversation.state = c[2] === 'close' ? 'closed' : 'open';
      if (method === 'PATCH') {
        if (state.failGoal) return reply({ error: { message: 'Save failed' } }, 503);
        Object.assign(conversation, body);
      }
      return reply({ data: conversation });
    }
    if (path.endsWith('/messages') && method === 'POST') {
      if (state.failMessage) await new Promise((resolve) => setTimeout(resolve, 150));
      if (state.failMessage) return reply({ error: { message: 'Send failed' } }, 503);
      const message = {
        id: `message-${state.messages.length}`,
        authorType: 'human',
        authorId: 'person',
        body: body.body,
        mentions: [],
        inReplyToMessageId: null,
        taskId: null,
        createdAt: '2026-11-04T01:00:00Z'
      };
      state.messages.push(message);
      const current = conversations.find((c) => path.includes(`/${c.id}/`))!;
      current.goal ??= body.body as string;
      current.doneCriteria ??= 'A person confirms the result';
      return reply({ data: message }, 201);
    }
    if (path.endsWith('/messages')) return reply(list(state.messages));
    if (path.endsWith('/read')) return reply({ data: {} });
    if (path.endsWith('/costs'))
      return reply({
        data: { total: { costUsd: 0, tokens: 0, unpricedCalls: 0 }, budgetUsd: null, tasks: [] }
      });
    if (path === '/responsibilities')
      return reply(
        list([
          {
            id: 'alpha-schedule',
            conversationId: 'open',
            agentId: 'agent',
            title: 'Alpha check',
            status: 'paused',
            intervalMinutes: 60,
            recurrence: null,
            nextRunAt: '2026-11-04T01:00:00Z',
            catchUp: null
          },
          {
            id: 'beta-schedule',
            conversationId: 'other',
            agentId: 'agent',
            title: 'Beta check',
            status: 'paused',
            intervalMinutes: 60,
            recurrence: null,
            nextRunAt: '2026-11-04T01:00:00Z',
            catchUp: null
          }
        ])
      );
    if (
      ['/agents', '/approvals', '/tasks', '/skills', '/connections', '/providers'].includes(path) ||
      /\/(outputs|routing|events)$/.test(path)
    )
      return reply(list([]));
    if (path.endsWith('/budget')) return reply({ data: { budgetUsd: null } });
    throw new Error(`Unexpected API request: ${method} ${path}`);
  });
  return { state, errors };
}

test('projects: shared context, members, scoped schedules, create and archive', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  state.failProjects = true;
  await page.goto('/app/#/projects');
  await expect(page.getByText('Projects unavailable', { exact: true }).first()).toBeVisible();
  state.failProjects = false;
  await page.getByRole('button', { name: 'Retry projects', exact: true }).click();
  await page.locator('main').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Delivery');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delivery', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Delivery team');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delivery team', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive project', exact: true }).click();
  await expect(
    page.locator('main').getByRole('button', { name: 'New endeavor', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Restore project', exact: true }).click();
  await expect(
    page.locator('main').getByRole('button', { name: 'New endeavor', exact: true })
  ).toBeEnabled();
  await page.goto('/app/#/projects/alpha');
  await expect(page.locator('main').getByRole('link', { name: /open-goal/ })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: /other-project/ })).toHaveCount(0);
  await expect(page.locator('main').getByRole('link', { name: /old-goal/ })).toBeHidden();
  await page.getByText('Archived endeavors · 1', { exact: true }).click();
  await expect(page.locator('main').getByRole('link', { name: /old-goal/ })).toBeVisible();
  await page.getByRole('button', { name: 'Knowledge sources', exact: true }).click();
  await page.getByText('Attach a document', { exact: true }).click();
  await page.getByLabel('Document title').fill('Reference');
  await page.getByLabel('Document text').fill('Shared with Alpha');
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(page.getByText('Reference', { exact: true })).toBeVisible();
  expect(state.docs).toHaveLength(1);
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByRole('button', { name: 'Edit members', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Include Kayvan' })).toBeChecked();
  await page.getByRole('button', { name: 'Save members', exact: true }).click();
  expect(state.writes.at(-1)?.body).toEqual({ humanIds: ['person'], agentIds: [] });
  await page.getByRole('button', { name: 'Schedules', exact: true }).click();
  await expect(page.getByRole('button', { name: /Alpha check/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Beta check/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('projects: request retry creates one endeavor, reply stays there, goal edits and close/reopen persist', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  state.failMessage = true;
  await page.goto('/app/#/projects/beta');
  await page.locator('main').getByRole('button', { name: 'New endeavor', exact: true }).click();
  const draft = page.getByRole('region', { name: 'New endeavor' });
  const input = draft.getByRole('textbox', { name: 'First message' });
  await expect(input).toBeFocused();
  await input.fill('Build the report');
  await draft.getByRole('button', { name: 'Send message', exact: true }).click();
  const retry = draft.getByRole('button', { name: 'Retry first message', exact: true });
  await expect(retry).toBeDisabled();
  await expect(draft.getByText('Send failed', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Build the report');
  state.failMessage = false;
  await retry.click();
  await expect(page).toHaveURL(/conversations\/created$/);
  const creation = state.writes.filter((w) => w.path === '/conversations');
  expect(creation).toHaveLength(1);
  expect(creation[0].body).toEqual({ projectId: 'beta', title: 'build-the-report' });
  const sends = state.writes.filter((w) => w.path.endsWith('/messages'));
  expect(sends[0].body.clientKey).toBe(sends[1].body.clientKey);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A follow-up');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect.poll(() => state.messages.length).toBe(2);
  expect(state.writes.filter((w) => w.path === '/conversations')).toHaveLength(1);
  state.failGoal = true;
  await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit endeavor goal' });
  await editor.getByLabel('Goal', { exact: true }).fill('Make a checked report');
  await editor.getByLabel('Done when', { exact: true }).fill('Reviewed and accepted');
  await editor.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(editor.getByText('Save failed', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Goal', { exact: true })).toHaveValue('Make a checked report');
  state.failGoal = false;
  await editor.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm goal done', exact: true }).click();
  state.failClose = true;
  await page.getByRole('button', { name: 'Confirm and close', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Close failed', { exact: true })).toBeVisible();
  expect(state.conversations.find((c) => c.id === 'created')?.state).toBe('open');
  state.failClose = false;
  await page.getByRole('button', { name: 'Confirm and close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Closed · Goal confirmed done', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen endeavor', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search endeavors', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'old-goal', exact: true })
  ).toBeVisible();
  expect(state.conversations.find((c) => c.id === 'created')?.doneCriteria).toBe(
    'Reviewed and accepted'
  );
  expect(errors).toEqual([]);
});

for (const { theme, width } of [
  { theme: 'light', width: 1440 },
  { theme: 'dark', width: 320 }
]) {
  test(`projects: ${theme} at ${width}px fits overview, request and goal controls`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await fixture(page, theme);
    await page.goto('/app/#/projects/alpha');
    await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await captureReviewScreenshot(page, { path: `/tmp/ca102-project-${width}.png` });
    await page.locator('main').getByRole('button', { name: 'New endeavor', exact: true }).click();
    const draft = page.getByRole('region', { name: 'New endeavor' });
    await expect(draft.getByRole('textbox', { name: 'First message' })).toBeFocused();
    const selector = draft.getByRole('button', { name: 'Project: Alpha', exact: true });
    const composerBox = (await draft.locator('.composer').boundingBox())!;
    const selectorBox = (await selector.boundingBox())!;
    expect(selectorBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height);
    expect(selectorBox.x).toBeCloseTo(composerBox.x);
    await selector.click();
    const picker = page.getByRole('dialog', { name: 'Project: Alpha', exact: true });
    await expect(picker.getByRole('searchbox')).toBeFocused();
    const pickerBox = (await picker.boundingBox())!;
    expect(pickerBox.y + pickerBox.height).toBeLessThan(selectorBox.y);
    await page.keyboard.press('Escape');
    await expect(selector).toBeFocused();
    await page.goBack();
    await page
      .locator('main')
      .getByRole('link', { name: /open-goal/ })
      .click();
    await expect(page.getByRole('region', { name: 'Endeavor goal' })).toBeVisible();
    const stateBox = (await page
      .getByRole('region', { name: 'Endeavor goal' })
      .locator('strong')
      .boundingBox())!;
    const editBox = (await page
      .getByRole('button', { name: 'Edit goal', exact: true })
      .boundingBox())!;
    expect(
      stateBox.x + stateBox.width <= editBox.x ||
        stateBox.y + stateBox.height <= editBox.y ||
        editBox.y + editBox.height <= stateBox.y
    ).toBe(true);
    const box = await page.getByRole('button', { name: 'Confirm goal done' }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await captureReviewScreenshot(page, { path: `/tmp/ca102-goal-${width}.png` });
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 320]) {
  test(`project sidebar: hierarchy, navigation and request context at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state, errors } = await fixture(page, 'dark');
    state.conversations.find((c) => c.id === 'other')!.unreadCount = 7;
    await page.goto('/app/#/conversations/open');
    await expect(page.getByRole('heading', { name: 'open-goal', exact: true })).toBeVisible();
    if (width < 700) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBe(264);
    const tree = sidebar.getByRole('region', { name: 'Projects', exact: true });
    await expect(sidebar.getByRole('link', { name: 'Endeavors', exact: true })).toHaveCount(0);
    await expect(sidebar.getByText('Recent', { exact: true })).toHaveCount(0);
    const alpha = tree
      .locator('.sidebar-project')
      .filter({
        has: page.getByRole('button', { name: 'Project options for Alpha', exact: true })
      });
    const beta = tree
      .locator('.sidebar-project')
      .filter({ has: page.getByRole('button', { name: 'Project options for Beta', exact: true }) });
    await expect(alpha.getByRole('link', { name: '#open-goal', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(beta.getByRole('link', { name: /other-project/ })).toBeHidden();
    await expect(beta.getByLabel('7 unread', { exact: true })).toBeVisible();
    const projectBox = (await alpha.locator('.sidebar-project-toggle').boundingBox())!;
    const endeavorBox = (await alpha
      .getByRole('link', { name: '#open-goal', exact: true })
      .boundingBox())!;
    expect(endeavorBox.x).toBeGreaterThan(projectBox.x);
    expect(endeavorBox.x + endeavorBox.width).toBeLessThanOrEqual(
      (await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width
    );
    await alpha.getByRole('button', { name: 'Collapse Alpha', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(alpha.getByRole('link', { name: '#open-goal', exact: true })).toBeHidden();
    await page.keyboard.press('Enter');
    await beta.getByRole('button', { name: 'Expand Beta', exact: true }).click();
    await beta.getByRole('link', { name: /other-project/ }).click();
    await expect(page).toHaveURL(/conversations\/other$/);
    if (width < 700) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await expect(beta.locator('.count-badge')).toHaveCount(0);
    await beta.getByRole('button', { name: 'New endeavor in Beta', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'What should we work on in Beta?' })
    ).toBeVisible();
    if (width < 700) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await beta.getByRole('button', { name: 'Project options for Beta', exact: true }).click();
    await page.getByRole('link', { name: 'Open project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
    if (width < 700) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await sidebar.getByRole('link', { name: 'Agents', exact: true }).click();
    if (width < 700) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await expect(tree).toBeVisible();
    await expect(alpha.getByRole('link', { name: '#open-goal', exact: true })).toBeVisible();
    await captureReviewScreenshot(page, { path: `/tmp/ca110-sidebar-${width}.png` });
    await sidebar.getByRole('link', { name: 'Manage projects', exact: true }).click();
    await expect(
      page.locator('main').getByRole('button', { name: 'New project', exact: true })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('project sidebar: search expands its project and a project-list failure retains endeavor links', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  await page.goto('/app/#/conversations/open');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar.getByRole('button', { name: 'Expand Beta', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await page.getByRole('button', { name: 'Search endeavors', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Find an endeavor' });
  await search.getByLabel('Search endeavors', { exact: true }).fill('other-project');
  await search.getByLabel('Search endeavors', { exact: true }).press('Enter');
  await expect(sidebar.getByRole('link', { name: '#other-project', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(sidebar.getByRole('button', { name: 'Collapse Beta', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  state.failProjects = true;
  await page.reload();
  await expect(sidebar.getByText('Projects unavailable', { exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '#other-project', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'New endeavor', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('project menu edits identity and the composer picker switches scope without losing the draft', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  await page.goto('/app/#/conversations/open');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  const menu = sidebar.getByRole('button', { name: 'Project options for Beta', exact: true });
  await expect(menu.locator('..')).toHaveCSS('opacity', '0');
  await menu.locator('..').locator('..').hover();
  await expect(menu.locator('..')).toHaveCSS('opacity', '1');
  await menu.click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit project', exact: true });
  await editor.getByLabel('Project name').fill('Web platform');
  await editor.getByRole('button', { name: 'Code', exact: true }).click();
  const colors = editor.getByRole('group', { name: 'Color', exact: true });
  await expect(colors.getByRole('button')).toHaveCount(10);
  await colors.getByRole('button', { name: 'Orange', exact: true }).click();
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toHaveCount(0);
  expect(state.writes.find((write) => write.path === '/projects/beta')?.body).toEqual({
    name: 'Web platform',
    icon: 'code',
    color: 'orange'
  });

  await sidebar.getByRole('button', { name: 'New endeavor', exact: true }).click();
  const draft = page.getByRole('region', { name: 'New endeavor' });
  const input = draft.getByRole('textbox', { name: 'First message' });
  await input.fill('Review the homepage');
  await draft.getByRole('button', { name: 'Project: Standalone' }).click();
  const picker = page.getByRole('dialog', { name: 'Project: Standalone' });
  await picker.getByRole('searchbox').fill('platform');
  await picker.getByRole('button', { name: 'Web platform', exact: true }).click();
  const context = draft.getByRole('button', { name: 'Project: Web platform' });
  await expect(context.locator('.project-glyph')).toHaveAttribute('data-project-color', 'orange');
  await expect(context.locator('.project-glyph')).toHaveText('code');
  await expect(input).toHaveValue('Review the homepage');
  await input.press('Enter');
  await expect(page).toHaveURL(/conversations\/created$/);
  expect(state.writes.find((write) => write.path === '/conversations')?.body).toEqual({
    projectId: 'beta',
    title: 'review-the-homepage'
  });
  expect(errors).toEqual([]);
});
