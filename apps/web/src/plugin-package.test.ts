import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPluginPackage } from './plugin-package.ts';

const schema = 'https://agent-plugins.org/schemas/1.0.0/';
const instructions = '---\nname: report\ndescription: >-\n  Write a short report\n  with citations.\n---\nCite the source.\n';
const folder = (files: Record<string, object | string>) =>
  Object.entries(files).map(([path, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { webkitRelativePath: `bundle/${path}`, size: text.length, text: async () => text };
  });

test('reads portable components without loading client extensions, assets, or local servers', async () => {
  const files = folder({
    'plugin.json': { $schema: schema + 'plugin.schema.json', name: 'acme.docs', extensions: { 'com.example': {} } },
    '.codex-plugin/plugin.json': { name: 'compatibility' },
    'skills/report/SKILL.md': instructions,
    'skills/report/scripts/report.sh': 'example',
    'skills/other/nested/SKILL.md': instructions,
    'mcp.json': {
      $schema: schema + 'mcp.schema.json',
      mcpServers: {
        docs: { type: 'streamable-http', url: 'https://docs.example/mcp', headers: { Auth: 'test-secret' } },
        events: { type: 'sse', url: 'https://docs.example/sse' },
        script: { type: 'stdio', command: 'test-command' },
        template: { type: 'streamable-http', url: 'https://docs.example/${PLUGIN_ROOT}' }
      }
    }
  });
  for (const file of files.filter((entry) => /\/scripts\/|\/nested\//.test(entry.webkitRelativePath))) {
    file.text = async () => { throw new Error('Unexpected read'); };
  }
  const pack = await readPluginPackage(files);
  assert.equal(pack.name, 'acme.docs');
  assert.equal(pack.format, 'Agent Plugins 1.0');
  assert.deepEqual(pack.skills, [{
    path: 'skills/report/SKILL.md',
    name: 'report',
    description: 'Write a short report with citations.',
    instructions: 'Cite the source.'
  }]);
  assert.deepEqual(pack.servers, [{ name: 'docs', url: 'https://docs.example/mcp' }]);
  for (const name of ['com.example', 'headers', 'events', 'script', 'template']) {
    assert.ok(pack.notices.some((notice) => notice.includes(name)), name);
  }
  assert.doesNotMatch(JSON.stringify(pack), /test-secret|test-command/);
});

test('loads the documented Codex scaffold layout', async () => {
  const pack = await readPluginPackage(folder({
    '.codex-plugin/plugin.json': { name: 'codex-docs', skills: './skills/', mcpServers: './.mcp.json', apps: './.app.json' },
    '.mcp.json': { mcpServers: { docs: { url: 'https://docs.example/mcp' } } },
    '.app.json': { apps: { docs: { id: 'app-docs' } } },
    'skills/report/SKILL.md': instructions
  }));
  assert.equal(pack.format, 'Codex');
  assert.equal(pack.skills.length, 1);
  assert.deepEqual(pack.servers, [{ name: 'docs', url: 'https://docs.example/mcp' }]);
  assert.ok(pack.notices.some((notice) => notice.includes('apps')));
});

test('loads Claude Code skill directories and resolves local and inline MCP declarations in order', async () => {
  const pack = await readPluginPackage(folder({
    '.claude-plugin/plugin.json': {
      name: 'claude-docs',
      skills: ['./extra-skills/'],
      mcpServers: ['./mcp/servers.json', { docs: { type: 'http', url: 'https://new.example/mcp' } }],
      hooks: './hooks/hooks.json'
    },
    '.mcp.json': { default: { type: 'http', url: 'https://default.example/mcp' } },
    'mcp/servers.json': { docs: { type: 'http', url: 'https://old.example/mcp' } },
    'extra-skills/report/SKILL.md': instructions,
    'hooks/hooks.json': {}
  }));
  assert.equal(pack.format, 'Claude Code');
  assert.equal(pack.skills.length, 1);
  assert.deepEqual(pack.servers, [
    { name: 'default', url: 'https://default.example/mcp' },
    { name: 'docs', url: 'https://new.example/mcp' }
  ]);
  assert.ok(pack.notices.some((notice) => notice.includes('hooks')));
});

test('rejects unsafe package paths and keeps skills when the MCP declaration is invalid', async () => {
  await assert.rejects(readPluginPackage(folder({ '../plugin.json': {} })), /Choose one plugin folder/);
  await assert.rejects(readPluginPackage(folder({ 'plugin.json': { name: 'missing-schema' } })), /Agent Plugins 1.0 schema/);
  const pack = await readPluginPackage(folder({
    'plugin.json': { $schema: schema + 'plugin.schema.json', name: 'docs' },
    'mcp.json': { $schema: 'https://example.test/mcp.schema.json', mcpServers: {} },
    'skills/report/SKILL.md': instructions,
    'skills/invalid/SKILL.md': '---\nname: invalid\ndescription: &d hi\nlicense: *d\n---\nInstructions.'
  }));
  assert.deepEqual(pack.skills.map(({ name }) => name), ['report']);
  assert.deepEqual(pack.servers, []);
  assert.ok(pack.notices.some((notice) => notice.includes('mcp.json')));
  assert.ok(pack.notices.some((notice) => notice.includes('invalid/SKILL.md')));
});
