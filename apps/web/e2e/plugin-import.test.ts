import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-screenshot';

test('review a plugin, choose catalog entries, and explicitly grant access on an agent', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 940 });
  const dir = info.outputPath('reference-plugin');
  const files: Record<string, string> = {
    '.codex-plugin/plugin.json': JSON.stringify({
      name: 'reference-plugin', skills: './skills/', mcpServers: './.mcp.json', hooks: './hooks/hooks.json'
    }),
    '.mcp.json': JSON.stringify({
      mcpServers: {
        docs: { url: 'https://remote.example/docs', headers: { Authorization: 'Bearer package-secret' } },
        references: { url: 'https://remote.example/references' },
        local: { command: 'test-command' }
      }
    }),
    'skills/cite/SKILL.md': '---\nname: cite\ndescription: Add citations.\n---\nCite each source.',
    'hooks/hooks.json': '{}'
  };
  for (const [path, value] of Object.entries(files)) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, value);
  }

  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'p1'));
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let rejectSkill = true;
  const skills: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [{
    id: 'c1', name: 'Reference service', description: 'Find references', kind: 'mcp',
    baseUrl: 'https://remote.example/references', disabledAt: null, allowedTools: ['search']
  }];
  const version = {
    id: 'v1', version: 1, model: 'test-model', provider: 'openai', instructions: 'Write a report.',
    skillIds: [], skillVersionIds: [], connectionIds: [], limits: {}
  };
  const agent = {
    id: 'a1', name: 'Researcher', purpose: 'Find sources', providerReady: true, disabledAt: null,
    currentVersion: version, currentVersionId: version.id
  };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') {
      if (url.origin !== 'https://fonts.googleapis.com') external.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      if (url.pathname === '/skills' && rejectSkill) {
        rejectSkill = false;
        return reply({ error: { message: 'Skill save unavailable' } }, 503);
      }
      const entry = { ...body, id: url.pathname === '/skills' ? 's1' : 'c2', disabledAt: null };
      if (url.pathname === '/skills') skills.push(entry);
      if (url.pathname === '/connections') connections.push(entry);
      return reply({ data: entry }, 201);
    }
    if (url.pathname === '/agents/a1') return reply({ data: agent });
    const data = ({
      '/humans': [{ id: 'p1', name: 'Kayvan', preferences: { theme: 'dark', timeFormat: '12h' } }],
      '/agents': [agent], '/agents/a1/versions': [version], '/skills': skills, '/connections': connections,
      '/providers': [{ provider: 'openai', ready: true, setup: 'Ready' }]
    })[url.pathname] ?? [];
    return reply({ data, page: { total: data.length, limit: 100, offset: 0 } });
  });

  await page.goto('/app/#/skills');
  await page.getByRole('link', { name: 'Plugins catalog' }).click();
  const preview = page.getByRole('region', { name: 'Package preview' });
  await page.getByLabel('Plugin folder').setInputFiles(dir);
  await expect(preview.getByRole('heading', { name: 'reference-plugin', exact: true })).toBeFocused();
  await expect(preview.getByText(/local was skipped/)).toBeVisible();
  await expect(preview.getByText(/Manifest field "hooks"/)).toBeVisible();
  await expect(preview.getByText(/bundled headers/)).toBeVisible();
  await expect(preview.getByText(/package-secret/)).toHaveCount(0);
  const skill = preview.getByRole('region', { name: 'cite', exact: true });
  await skill.getByText('Read instructions').click();
  await expect(skill.getByText('Cite each source.')).toBeVisible();
  expect(writes).toEqual([]);
  const discoverable = skill.getByRole('checkbox', { name: 'Let agents find this and request access' });
  await expect(discoverable).toBeChecked();
  await discoverable.uncheck();
  await skill.getByRole('button', { name: 'Import skill' }).click();
  await expect(skill.getByText('Skill save unavailable')).toBeVisible();
  await expect(discoverable).not.toBeChecked();
  await expect(skill.getByText('Cite each source.')).toBeVisible();
  await skill.getByRole('button', { name: 'Import skill' }).click();
  await expect(skill.getByRole('link', { name: 'cite' })).toHaveAttribute('href', '#/skills/s1');

  const mapped = preview.getByRole('region', { name: 'references', exact: true });
  await expect(mapped.getByRole('button', { name: 'Use selected connection' })).toBeDisabled();
  await mapped.getByLabel('Existing MCP connection').selectOption('c1');
  await mapped.getByRole('button', { name: 'Use selected connection' }).click();
  await expect(mapped.getByRole('link', { name: 'Reference service' })).toHaveAttribute('href', '#/connections/c1');
  expect(writes).toHaveLength(2);

  const remote = preview.getByRole('region', { name: 'docs', exact: true });
  await remote.getByRole('button', { name: 'Configure new connection' }).click();
  await expect(remote.getByLabel('MCP endpoint URL')).toHaveValue('https://remote.example/docs');
  await expect(remote.getByLabel('Authentication method')).toHaveValue('none');
  await expect(remote.getByLabel(/^Allowed tools/)).toHaveValue('');
  await remote.getByLabel(/^Allowed tools/).fill('search\nfetch');
  await remote.getByLabel(/^Tools that can run without approval/).fill('search');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureReviewScreenshot(page, { path: info.outputPath('plugin-preview.png'), fullPage: true });
  await remote.getByRole('button', { name: 'Create connection', exact: true }).click();
  await expect(remote.getByRole('link', { name: 'docs' })).toHaveAttribute('href', '#/connections/c2');
  expect(writes).toEqual([
    ...[0, 1].map(() => ({
      path: '/skills', body: { name: 'cite', description: 'Add citations.', instructions: 'Cite each source.', discoverable: false }
    })),
    { path: '/connections', body: {
      name: 'docs', description: 'MCP server declared by the plugin: docs.', baseUrl: 'https://remote.example/docs',
      discoverable: true, authMethod: 'none', kind: 'mcp', allowedTools: ['search', 'fetch'], approvalTools: ['fetch']
    }}
  ]);

  await preview.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('a1');
  await preview.getByRole('link', { name: 'Open agent configuration' }).click();
  const addSkills = page.getByRole('searchbox', { name: 'Add skills' });
  const addConnections = page.getByRole('searchbox', { name: 'Add connections' });
  await expect(addSkills).toBeVisible();
  await expect(page.getByText('No skills chosen.')).toBeVisible();
  await expect(page.getByText('No connections chosen.')).toBeVisible();
  await addSkills.fill('cite');
  await page.getByRole('region', { name: 'skill matches' }).getByRole('button', { name: /cite/ }).click();
  await addConnections.fill('Reference service');
  await page.getByRole('region', { name: 'connection matches' }).getByRole('button', { name: /Reference service/ }).click();
  expect(writes).toHaveLength(3);
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect.poll(() => writes.at(-1)?.path).toBe('/agents/a1/config');
  expect(writes.at(-1)?.body).toMatchObject({ skillIds: ['s1'], connectionIds: ['c1'] });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
