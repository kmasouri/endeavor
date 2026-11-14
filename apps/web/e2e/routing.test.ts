import { expect, test } from '@playwright/test';
import { fixture } from './chat-fixture';

for (const width of [1280, 390])
  test(`Decision Engine searches all agents and preserves stale choices at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const { errors, unexpected } = await fixture(page);
    let waiting = true;
    let fail = true;
    const posts: unknown[] = [];
    const candidates = [
      { id: 'researcher', name: 'Researcher', purpose: 'Finds sources', recommended: true },
      { id: 'reviewer', name: 'Reviewer', purpose: 'Checks drafts' },
      { id: 'writer', name: 'Writer', purpose: 'Writes reports' },
      { id: 'planner', name: 'Planner', purpose: 'Plans delivery' },
      { id: 'analyst', name: 'Analyst', purpose: 'Analyzes data' },
      { id: 'auditor', name: 'Auditor', purpose: 'Security specialist' }
    ];
    const decision = {
      id: 'decision', messageId: 'human-request', decisionMessageId: null,
      kind: 'starter', status: 'waiting', selectedAgentId: null, decidedByHumanId: null,
      outcome: 'ask', reason: 'The request spans research and review. Choose who should start.',
      revision: 1, candidates
    };
    await page.route('**/conversations/brief/routing**', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: [{
          ...decision,
          status: waiting ? 'waiting' : 'resolved',
          selectedAgentId: waiting ? null : 'auditor',
          decidedByHumanId: waiting ? null : 'human-1',
          revision: waiting ? 1 : 2
        }] } });
      posts.push(route.request().postDataJSON());
      if (fail)
        return route.fulfill({ status: 409, json: { error: { message: 'This choice changed. Reload and try again.' } } });
      waiting = false;
      return route.fulfill({ json: { data: { ...decision, status: 'resolved' } } });
    });
    await page.goto('/app/#/conversations/brief');
    const card = page.getByRole('region', { name: 'Decision Engine message' });
    await expect(card.getByText('Recommended')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Assign Researcher' })).toBeVisible();
    await expect(card.getByText('Suggestions: Researcher · Reviewer · Writer · Planner · Analyst')).toBeVisible();
    const frame = await card.boundingBox();
    expect(frame).not.toBeNull();
    expect(frame!.x).toBeGreaterThanOrEqual(0);
    expect(frame!.x + frame!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await card.getByRole('button', { name: 'Leave unassigned' }).click();
    await expect(card.getByRole('alert')).toContainText('This choice changed');
    fail = false;
    await card.getByRole('button', { name: 'Choose another agent' }).click();
    await card.getByRole('searchbox', { name: 'Find an agent' }).fill('security');
    await card.getByRole('button', { name: /Auditor/ }).click();
    const confirmation = page.getByRole('dialog', { name: 'Assign Auditor?' });
    await expect(confirmation).toContainText('Work starts after you confirm');
    await confirmation.getByRole('button', { name: 'Assign Auditor' }).click();
    await expect(card.getByText('Assigned to Auditor')).toBeVisible();
    expect(posts).toEqual([
      { agentId: null, revision: 1 },
      { agentId: 'auditor', revision: 1 }
    ]);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });

test('Decision Engine handles a request without a recommendation', async ({ page }) => {
  const { errors, unexpected } = await fixture(page);
  await page.route('**/conversations/brief/routing**', (route) => route.fulfill({ json: { data: [{
    id: 'decision', messageId: 'human-request', decisionMessageId: null,
    kind: 'starter', status: 'waiting', selectedAgentId: null, decidedByHumanId: null,
    outcome: 'ask', reason: 'The Decision Engine could not recommend an agent.', revision: 1,
    candidates: [{ id: 'reviewer', name: 'Reviewer', purpose: 'Checks drafts' }]
  }] } }));
  await page.goto('/app/#/conversations/brief');
  const card = page.getByRole('region', { name: 'Decision Engine message' });
  await expect(card.getByText('No agent was recommended')).toBeVisible();
  await expect(card.getByRole('button', { name: /^Assign / })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Choose another agent' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
