import { expect, test } from '@playwright/test';
import { fixture, createdAt } from './chat-fixture';

for (const failure of [false, true])
  test(`pending send ${failure ? 'failure' : 'success'} preserves later draft, mentions and reply`, async ({
    page
  }) => {
    const { state, errors, unexpected } = await fixture(page);
    state.messages.push({
      ...state.messages[0],
      id: 'second',
      body: 'Another question',
      createdAt
    });
    await page.goto('/app/#/conversations/brief');
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await page.locator('#m-question').hover();
    await page.locator('#m-question').getByRole('button', { name: 'Reply', exact: true }).click();
    await input.fill('@Researcher draft A');
    state.holdSend = true;
    state.failSend = failure;
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => state.posts.length).toBe(1);
    await page.getByRole('button', { name: 'Cancel reply', exact: true }).click();
    await page.locator('#m-second').hover();
    await page.locator('#m-second').getByRole('button', { name: 'Reply', exact: true }).click();
    await input.fill('@Kayvan draft B');
    state.holdSend = false;
    state.releaseSend();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(input).toHaveValue('@Kayvan draft B');
    await expect(page.locator('.reply-bar')).toContainText('Another question');
    expect(state.posts[0]).toMatchObject({
      body: '@Researcher draft A',
      mentions: [{ type: 'agent', id: 'researcher' }],
      inReplyToMessageId: 'question'
    });
    state.failSend = false;
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(input).toHaveValue('');
    expect(state.posts[1]).toMatchObject({
      body: '@Kayvan draft B',
      mentions: [{ type: 'human', id: 'person' }],
      inReplyToMessageId: 'second'
    });
    expect(state.posts[1].clientKey).not.toBe(state.posts[0].clientKey);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });

test('message retry after a committed response loss reuses the original key and stored message', async ({
  page
}) => {
  const { state, errors, unexpected } = await fixture(page);
  await page.goto('/app/#/conversations/brief');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  state.loseSendResponse = true;
  await input.fill('@Researcher check once');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(input).toHaveValue('@Researcher check once');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(input).toHaveValue('');
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]).toEqual(state.posts[0]);
  expect(state.messages.filter((m) => m.body === '@Researcher check once')).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('editing a failed send is a distinct submission and known successful text can be sent again', async ({
  page
}) => {
  const { state, errors, unexpected } = await fixture(page);
  await page.goto('/app/#/conversations/brief');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  state.failSend = true;
  await input.fill('Original draft');
  await send.click();
  await expect(page.getByText('Message not sent. Try again.')).toBeVisible();
  state.failSend = false;
  await input.fill('Edited draft');
  await send.click();
  await expect(input).toHaveValue('');
  await input.fill('Edited draft');
  await send.click();
  await expect(input).toHaveValue('');
  expect(new Set(state.posts.map((p) => p.clientKey)).size).toBe(3);
  expect(state.messages.filter((m) => m.body === 'Edited draft')).toHaveLength(2);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
