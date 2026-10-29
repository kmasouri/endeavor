import { expect, test } from '@playwright/test';
import type { Message } from '../src/api';
import { fixture, createdAt } from './chat-fixture';

function history(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `history-${String(i + 1).padStart(4, '0')}`,
    conversationId: 'brief',
    authorType: 'human',
    authorId: 'person',
    body: `Message ${i + 1}: research notes and supporting evidence for this discussion.`,
    mentions: [],
    taskId: null,
    inReplyToMessageId: null,
    createdAt: new Date(Date.parse(createdAt) + i * 1000).toISOString()
  }));
}

for (const width of [1440, 390])
  test(`incremental chat at ${width}px: latest window, anchored history, appended bursts and visible reads`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { state, errors, unexpected } = await fixture(page);
    state.messages = history(620);
    await page.goto('/app/#/conversations/brief');
    const scroller = page.locator('.conversation-scroll');
    await expect(page.locator('.message')).toHaveCount(50);
    await expect(page.locator('#m-history-0620')).toBeInViewport();
    expect(state.queries[0]).toBe('?limit=50&latest=true');
    expect(state.queries.some((q) => q.includes('beforeId'))).toBe(false);
    await expect.poll(() => state.reads.at(-1)).toBe('history-0620');
    // The top boundary triggers one older page. Preserve the first visible message's position.
    const before = await scroller.evaluate((element) => {
      element.scrollTop = 5;
      return document.getElementById('m-history-0571')!.getBoundingClientRect().top;
    });
    await expect(page.locator('.message')).toHaveCount(100);
    expect(
      Math.abs((await page.locator('#m-history-0571').boundingBox())!.y - before)
    ).toBeLessThan(2);
    expect(state.queries.filter((q) => q.includes('beforeId'))).toHaveLength(1);
    // More than two pages arrive while reading older history. No forced jump or premature read.
    state.messages = history(745);
    await expect(page.locator('.message')).toHaveCount(225, { timeout: 10000 });
    await expect(page.getByRole('button', { name: '125 new messages ↓' })).toBeVisible();
    expect(state.reads).not.toContain('history-0745');
    expect(
      Math.abs((await page.locator('#m-history-0571').boundingBox())!.y - before)
    ).toBeLessThan(2);
    expect(state.queries.filter((q) => q.includes('afterId=history-0670'))).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath(`incremental-chat-unread-${width}.png`) });
    await page.getByRole('button', { name: '125 new messages ↓' }).click();
    await expect(page.locator('#m-history-0745')).toBeInViewport();
    await expect.poll(() => state.reads.at(-1)).toBe('history-0745');
    // At the bottom, the next arrival follows automatically; posting also refreshes the cursor.
    state.messages = history(746);
    await expect(page.locator('#m-history-0746')).toBeInViewport({ timeout: 10000 });
    await page.locator('.composer textarea').fill('Reply beyond the old cutoff');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('Reply beyond the old cutoff', { exact: true })).toBeVisible();
    expect(
      await page
        .locator('.message')
        .evaluateAll((elements) => new Set(elements.map((e) => e.id)).size)
    ).toBe(227);
    await page.screenshot({ path: testInfo.outputPath(`incremental-chat-${width}.png`) });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });

test('incremental chat retries initial and older failures without dropping loaded messages', async ({
  page
}) => {
  const { state, errors, unexpected } = await fixture(page);
  state.messages = history(620);
  state.failMessages = true;
  await page.goto('/app/#/conversations/brief');
  await expect(page.getByText('Messages unavailable')).toBeVisible();
  state.failMessages = false;
  await page.getByRole('button', { name: 'Retry messages' }).click();
  await expect(page.locator('.message')).toHaveCount(50);
  state.failHistory = true;
  await page.locator('.conversation-scroll').evaluate((el) => (el.scrollTop = 0));
  await expect(page.getByText('History unavailable')).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(50);
  state.failHistory = false;
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.locator('.message')).toHaveCount(100);
  await expect(page.getByText('History unavailable')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('incremental chat ignores delayed history after navigating to another conversation', async ({
  page
}) => {
  const { state, errors } = await fixture(page);
  state.messages = history(620);
  state.holdHistory = true;
  await page.route('**/conversations/other**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/other')
      ? { id: 'other', title: 'other', members: [], createdAt }
      : path.endsWith('/messages')
        ? [{ ...history(1)[0], id: 'other-message', body: 'Fresh conversation' }]
        : path.endsWith('/costs')
          ? {
              total: { costUsd: 0, tokens: 0, unpricedCalls: 0 },
              thisMonth: { costUsd: 0 },
              tasks: []
            }
          : [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.goto('/app/#/conversations/brief');
  await expect(page.locator('.message')).toHaveCount(50);
  await page.locator('.conversation-scroll').evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => state.queries.some((query) => query.includes('beforeId'))).toBe(true);
  await page.evaluate(() => (window.location.hash = '/conversations/other'));
  await expect(page.getByText('Fresh conversation', { exact: true })).toBeVisible();
  const completed = page.waitForResponse((response) => response.url().includes('beforeId='));
  state.releaseHistory();
  await completed;
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.locator('#m-history-0571')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('incremental chat retains messages on poll failure and retries failed visible read markers', async ({
  page
}) => {
  const { state, errors, unexpected } = await fixture(page);
  state.messages = history(620);
  state.failRead = true;
  await page.goto('/app/#/conversations/brief');
  await expect.poll(() => state.reads.length).toBeGreaterThan(0);
  state.failRead = false;
  await expect.poll(() => state.reads.length, { timeout: 7000 }).toBeGreaterThan(1);
  state.failMessages = true;
  await expect(page.getByText('Messages unavailable')).toBeVisible({ timeout: 7000 });
  await expect(page.locator('.message')).toHaveCount(50);
  state.failMessages = false;
  state.messages = history(621);
  await page.getByRole('button', { name: 'Retry messages' }).click();
  await expect(page.locator('#m-history-0621')).toBeInViewport();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('incremental chat loads a replied-to message outside the recent window only when requested', async ({
  page
}) => {
  const { state, errors, unexpected } = await fixture(page);
  state.messages = history(620);
  state.messages[614].inReplyToMessageId = 'history-0550';
  await page.goto('/app/#/conversations/brief');
  await expect(page.locator('.message')).toHaveCount(50);
  const link = page.getByRole('link', { name: 'Load replied-to message' });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page.locator('#m-history-0550')).toBeInViewport();
  await expect(page.locator('.message')).toHaveCount(100);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
