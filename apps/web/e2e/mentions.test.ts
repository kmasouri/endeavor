import { expect, test } from '@playwright/test';
import { fixture, createdAt } from './chat-fixture';

for (const theme of ['dark', 'light'])
  for (const width of [390, 1280]) {
    test(`tool-created tags are visible without duplicating written tags in ${theme} at ${width}px`, async ({
      page
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const { state, errors, unexpected } = await fixture(page, theme);
      state.added = true;
      state.messages.push(
        ...[
          {
            id: 'tool-tag',
            body: 'Please check the evidence.',
            mentions: [
              { type: 'agent' as const, id: 'reviewer' },
              { type: 'human' as const, id: 'person' }
            ]
          },
          {
            id: 'written-tag',
            body: '@Reviewer, please check this.',
            mentions: [
              { type: 'agent' as const, id: 'reviewer' },
              { type: 'human' as const, id: 'person' }
            ]
          },
          {
            id: 'formatted-tag',
            body: '**@Reviewer**, please check this.',
            mentions: [{ type: 'agent' as const, id: 'reviewer' }]
          }
        ].map((message) => ({
          ...message,
          authorType: 'agent' as const,
          authorId: 'researcher',
          taskId: null,
          inReplyToMessageId: null,
          createdAt
        }))
      );
      await page.goto('/app/#/conversations/brief');
      const tool = page.locator('#m-tool-tag');
      await expect(tool.locator('mark.mention')).toHaveText('@Reviewer');
      await expect(tool.locator('mark.mention-you')).toHaveText('@Kayvan');
      await expect(page.locator('#m-written-tag mark.mention')).toHaveText('@Reviewer');
      await expect(page.locator('#m-written-tag .message-tags')).toHaveText('@Kayvan');
      await expect(page.locator('#m-formatted-tag .message-tags')).toHaveCount(0);
      await expect(page.locator('#m-formatted-tag strong')).toContainText(['@Reviewer']);
      await page.screenshot({ path: info.outputPath('visible-tags.png'), fullPage: true });
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    });
  }

test('typed and pasted mentions send only the longest matching member, once', async ({ page }) => {
  const { state, errors, unexpected } = await fixture(page);
  state.extraMembers.push(
    ...[
      { name: 'Research', id: 'short' },
      { name: 'Research Bot', id: 'long' }
    ].map(({ name, id }) => ({
      name,
      participant: { type: 'agent' as const, id },
      purpose: null,
      historyFrom: null
    }))
  );
  await page.goto('/app/#/conversations/brief');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await input.fill('@Research Bot please check this. @Research Bot');
  await send.click();
  await expect(input).toHaveValue('');
  expect(state.posts[0].mentions).toEqual([{ type: 'agent', id: 'long' }]);
  await expect(page.locator('#m-sent-1 mark')).toHaveText(['@Research Bot', '@Research Bot']);
  await expect(page.locator('#m-sent-1 .message-tags')).toHaveCount(0);
  await input.pressSequentially('@Research Bot and @Research please');
  await send.click();
  await expect(input).toHaveValue('');
  expect(state.posts[1].mentions).toEqual([
    { type: 'agent', id: 'long' },
    { type: 'agent', id: 'short' }
  ]);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
