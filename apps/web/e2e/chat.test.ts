import { expect, test, type Page } from '@playwright/test';
import type { Message } from '../src/api';

const createdAt = '2026-10-27T12:00:00Z';
const researcher = { id: 'researcher', name: 'Researcher', purpose: 'Find evidence' };
const reviewer = { id: 'reviewer', name: 'Reviewer', purpose: 'Check evidence' };

// All network traffic is intercepted, including read markers and failed writes. No live API.
async function fixture(page: Page, theme = 'dark', empty = false) {
  const state = {
    failSend: false,
    failMembers: false,
    failMessages: false,
    holdSend: false,
    releaseSend: () => {},
    added: false,
    posts: [] as Record<string, unknown>[],
    memberPosts: [] as Record<string, unknown>[],
    messages: empty
      ? []
      : ([
          {
            id: 'question',
            authorType: 'human',
            authorId: 'person',
            body: 'Which sources should we use?',
            taskId: null,
            mentions: [],
            inReplyToMessageId: null,
            createdAt
          }
        ] as Message[])
  };
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(createdAt));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'person'));
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
    const list = (data: unknown[]) =>
      reply({ data, page: { total: data.length, limit: 100, offset: 0 } });
    const path = url.pathname;
    if (req.method() === 'POST' && path === '/conversations/brief/messages') {
      const body = req.postDataJSON();
      state.posts.push(body);
      if (state.holdSend)
        await new Promise<void>((resolve) => {
          state.releaseSend = resolve;
        });
      if (state.failSend) return reply({ error: { message: 'Message not sent. Try again.' } }, 503);
      const message: Message = {
        ...body,
        id: `sent-${state.posts.length}`,
        authorType: 'human',
        authorId: 'person',
        taskId: null,
        inReplyToMessageId: body.inReplyToMessageId ?? null,
        createdAt
      };
      state.messages.push(message);
      return reply({ data: message }, 201);
    }
    if (req.method() === 'POST' && path === '/conversations/brief/members') {
      state.memberPosts.push(req.postDataJSON());
      if (state.failMembers) return reply({ error: { message: 'Could not add Reviewer' } }, 503);
      state.added = true;
      return reply({ data: {} }, 201);
    }
    if (req.method() === 'PUT' && path === '/conversations/brief/read') return reply({ data: {} });
    if (req.method() !== 'GET') {
      unexpected.push(`${req.method()} ${path}`);
      return reply({ error: { message: 'Unexpected write' } }, 500);
    }
    if (path === '/humans')
      return reply({ data: [{ id: 'person', name: 'Kayvan', preferences: { theme } }] });
    if (path === '/directory') return reply({ data: [researcher, reviewer] });
    if (path === '/agents') return list([researcher, reviewer]);
    if (path === '/conversations') return list([{ id: 'brief', title: 'source-brief', createdAt }]);
    if (path === '/conversations/brief')
      return reply({
        data: {
          id: 'brief',
          title: 'source-brief',
          createdAt,
          members: [
            { participant: { type: 'human', id: 'person' }, name: 'Kayvan', historyFrom: null },
            ...[researcher, ...(state.added ? [reviewer] : [])].map((a) => ({
              participant: { type: 'agent', id: a.id },
              name: a.name,
              purpose: a.purpose,
              historyFrom: null
            }))
          ]
        }
      });
    if (path === '/conversations/brief/messages') {
      if (state.failMessages) return reply({ error: { message: 'Messages unavailable' } }, 503);
      return list(state.messages);
    }
    if (path === '/conversations/brief/costs')
      return reply({
        data: {
          total: { costUsd: 0, tokens: 0, unpricedCalls: 0 },
          thisMonth: { costUsd: 0 },
          budgetUsd: null,
          tasks: []
        }
      });
    if (
      [
        '/tasks',
        '/responsibilities',
        '/approvals',
        '/conversations/brief/outputs',
        '/conversations/brief/documents'
      ].includes(path)
    )
      return list([]);
    unexpected.push(`GET ${path}`);
    return reply({ error: { message: 'Unexpected read' } }, 500);
  });
  return { state, errors, unexpected };
}

test('keyboard mentions, multiline messages and replies send exact references and appear in chat', async ({
  page
}) => {
  const api = await fixture(page);
  await page.goto('/app/#/conversations/brief');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await input.fill('@Res');
  const picker = page.getByRole('listbox', { name: 'People and agents' });
  await expect(picker.getByRole('option')).toHaveCount(1);
  await input.fill('@');
  await expect(picker.getByRole('option')).toHaveCount(3);
  await input.press('ArrowDown');
  await expect(picker.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(input).toHaveValue('@Researcher ');
  await expect(picker).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(api.state.posts).toEqual([]);
  await input.pressSequentially('Find sources');
  await input.press('Shift+Enter');
  await input.pressSequentially('Include dates');
  expect(api.state.posts).toEqual([]);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.message-body').last()).toContainText('Include dates');
  expect(api.state.posts[0]).toEqual({
    body: '@Researcher Find sources\nInclude dates',
    mentions: [{ type: 'agent', id: 'researcher' }],
    clientKey: expect.any(String)
  });

  await page.locator('#m-question').hover();
  await page.locator('#m-question').getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(page.locator('.reply-bar')).toContainText('Replying to Kayvan');
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(page.locator('.reply-bar')).toHaveCount(0);
  await page.locator('#m-question').hover();
  await page.locator('#m-question').getByRole('button', { name: 'Reply', exact: true }).click();
  await input.fill('Use the approved sources.');
  await input.press('Enter');
  await expect(page.locator('#m-sent-2')).toContainText('Use the approved sources.');
  await expect(
    page.locator('#m-sent-2').getByRole('link', { name: /^Reply to Kayvan/ })
  ).toHaveAttribute('href', '#m-question');
  expect(api.state.posts[1]).toEqual({
    body: 'Use the approved sources.',
    mentions: [],
    inReplyToMessageId: 'question',
    clientKey: expect.any(String)
  });
  await expect(page.locator('.reply-bar')).toHaveCount(0);
  expect(api.errors).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('failed reply retains draft and reference, blocks duplicate submissions and retries', async ({
  page
}) => {
  const api = await fixture(page);
  api.state.failSend = true;
  api.state.holdSend = true;
  await page.goto('/app/#/conversations/brief');
  await page.locator('#m-question').hover();
  await page.locator('#m-question').getByRole('button', { name: 'Reply', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('@Researcher Please check this.');
  await input.press('Enter');
  await expect.poll(() => api.state.posts.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await input.press('Enter');
  expect(api.state.posts).toHaveLength(1);
  api.state.releaseSend();
  await expect(page.getByText('Message not sent. Try again.', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('@Researcher Please check this.');
  await expect(page.locator('.reply-bar')).toContainText('Replying to Kayvan');
  await expect(page.locator('.message')).toHaveCount(1);
  api.state.failSend = false;
  api.state.holdSend = false;
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.message')).toHaveCount(2);
  expect(api.state.posts).toHaveLength(2);
  expect(api.state.posts[1]).toMatchObject({
    body: api.state.posts[0].body,
    mentions: [{ type: 'agent', id: 'researcher' }],
    inReplyToMessageId: 'question'
  });
  await expect(page.getByText('Message not sent. Try again.', { exact: true })).toHaveCount(0);
  expect(api.errors).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('mentioning a new specialist requires a successful membership write before sending', async ({
  page
}) => {
  const api = await fixture(page);
  api.state.failMembers = true;
  await page.goto('/app/#/conversations/brief');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('@Nobody');
  await expect(page.getByText('No matches.', { exact: true })).toBeVisible();
  await input.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.fill('@Rev');
  await input.press('ArrowDown');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page.getByText('Could not add Reviewer', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('@Rev');
  expect(api.state.posts).toEqual([]);
  api.state.failMembers = false;
  await input.press('Enter');
  await expect(input).toHaveValue('@Reviewer ');
  expect(api.state.memberPosts).toEqual([
    { type: 'agent', id: 'reviewer' },
    { type: 'agent', id: 'reviewer' }
  ]);
  await input.pressSequentially('Check these sources.');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  expect(api.state.posts[0]).toMatchObject({ mentions: [{ type: 'agent', id: 'reviewer' }] });
  expect(api.errors).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('failed message loading is visible and polling recovers to the empty state', async ({
  page
}) => {
  const api = await fixture(page, 'dark', true);
  api.state.failMessages = true;
  await page.clock.install();
  await page.goto('/app/#/conversations/brief');
  await expect(page.getByText('Messages unavailable', { exact: true })).toBeVisible();
  api.state.failMessages = false;
  await page.clock.fastForward(2501);
  await expect(page.getByText('Messages unavailable', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('No messages yet. Say hello, and mention an agent to ask it.')
  ).toBeVisible();
  expect(api.errors).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

for (const theme of ['dark', 'light']) {
  for (const width of [1440, 390]) {
    test(`chat composer, mention picker and reply geometry in ${theme} at ${width}px`, async ({
      page
    }, info) => {
      const api = await fixture(page, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/#/conversations/brief');
      await page.locator('#m-question').hover();
      await page.locator('#m-question').getByRole('button', { name: 'Reply', exact: true }).click();
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('@');
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator('.composer').evaluate((element) => {
        const box = element.getBoundingClientRect();
        const attach = element
          .querySelector('[aria-label="Attach a document"]')!
          .getBoundingClientRect();
        const input = element.querySelector('textarea')!.getBoundingClientRect();
        const send = element.querySelector('[aria-label="Send message"]')!.getBoundingClientRect();
        const picker = element.querySelector('.mention-picker')!;
        const bounds = picker.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          controlsInside: attach.left >= box.left && send.right <= box.right,
          ordered: attach.right <= input.left && input.right <= send.left,
          aligned: Math.abs(attach.top - send.top) < 2,
          pickerInside:
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            bounds.top >= 0 &&
            bounds.bottom <= box.top + 1,
          optionsFit: [...picker.querySelectorAll('button')].every(
            (option) => option.scrollWidth <= option.clientWidth
          )
        };
      });
      expect(geometry).toEqual({
        overflow: false,
        controlsInside: true,
        ordered: true,
        aligned: true,
        pickerInside: true,
        optionsFit: true
      });
      await page.screenshot({ path: info.outputPath('chat-mention-reply.png'), fullPage: true });
      expect(api.errors).toEqual([]);
      expect(api.unexpected).toEqual([]);
    });
  }
}
