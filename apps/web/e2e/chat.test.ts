import { expect, test } from '@playwright/test';
import { fixture } from './chat-fixture';

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
