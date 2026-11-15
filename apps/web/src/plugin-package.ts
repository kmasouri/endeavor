import { parse } from 'yaml';

type PackageFile = Pick<File, 'size' | 'text' | 'webkitRelativePath'>;
type JsonObject = Record<string, unknown>;

const schemaRoot = 'https://agent-plugins.org/schemas/1.0.0/';
const manifestPaths = ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json'] as const;
const formats = ['Agent Plugins 1.0', 'Codex', 'Claude Code'] as const;
const metadata = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];

export type PluginSkill = { path: string; name: string; description: string; instructions: string };
export type PluginServer = { name: string; url: string };
export type PluginPackage = {
  name: string;
  version?: string;
  description?: string;
  format: (typeof formats)[number];
  skills: PluginSkill[];
  servers: PluginServer[];
  notices: string[];
};

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withinFolder(path: string) {
  return path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.includes('\\'));
}

function localPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('./')) return;
  const path = value.slice(2).replace(/\/$/, '');
  return withinFolder(path) ? path : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function skillFrom(path: string, text: string, notices: string[]): PluginSkill {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error('Expected YAML frontmatter and instructions.');
  const fields: unknown = parse(match[1], { maxAliasCount: 0, schema: 'core', logLevel: 'silent' });
  const instructions = match[2].trim();
  const folder = path.split('/').at(-2);
  if (!object(fields) || !nonempty(fields.name) || fields.name !== folder ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name) || fields.name.length > 64 ||
    !nonempty(fields.description) || fields.description.length > 1024 || !instructions) {
    throw new Error('Expected a valid skill name matching its folder, a description, and instructions.');
  }
  for (const field of Object.keys(fields)) {
    if (field !== 'name' && field !== 'description') {
      notices.push(`${path}: frontmatter field "${field}" is not imported.`);
    }
  }
  return { path, name: fields.name, description: fields.description.trim(), instructions };
}

function remoteUrl(value: unknown) {
  if (!nonempty(value) || !/^https?:\/\//i.test(value) || /\$\{|\{\{/.test(value)) return;
  const url = URL.parse(value);
  if (url && !url.username && !url.password && !url.hash) return url.href;
}

export async function readPluginPackage(selected: Iterable<PackageFile>): Promise<PluginPackage> {
  const files = new Map<string, PackageFile>();
  let root: string | undefined;
  for (const file of selected) {
    const [folder, ...parts] = file.webkitRelativePath.split('/');
    const path = parts.join('/');
    if (!folder || (root && root !== folder) || !withinFolder(path) || files.has(path)) {
      throw new Error('Choose one plugin folder.');
    }
    root = folder;
    files.set(path, file);
  }
  let bytes = 0;
  const read = async (path: string) => {
    const file = files.get(path);
    if (!file) throw new Error(`Missing ${path}.`);
    bytes += file.size;
    if (file.size > 1024 * 1024 || bytes > 12 * 1024 * 1024) {
      throw new Error('Package text exceeds the import limit (1 MiB per file, 12 MiB total).');
    }
    return file.text();
  };
  const json = async (path: string) => {
    const text = await read(path);
    let value: unknown;
    try {
      value = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(`${path} contains invalid JSON.`);
    }
    if (!object(value)) throw new Error(`${path} must contain a JSON object.`);
    return value;
  };

  const manifestPath = manifestPaths.find((path) => files.has(path));
  if (!manifestPath) throw new Error('No plugin manifest found. Choose the root of an Agent Plugins, Codex, or Claude Code package.');
  const portable = manifestPath === 'plugin.json';
  const manifest = await json(manifestPath);
  if (portable && manifest.$schema !== schemaRoot + 'plugin.schema.json') {
    throw new Error('This portable manifest must use the Agent Plugins 1.0 schema.');
  }
  if (!nonempty(manifest.name) || manifest.name.length > 80 ||
    (portable && !/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(manifest.name))) {
    throw new Error('The plugin manifest needs a valid name.');
  }
  if (portable && (
    ['version', 'description', 'homepage', 'repository', 'license'].some((key) => key in manifest && typeof manifest[key] !== 'string') ||
    ('author' in manifest && (!object(manifest.author) || Object.entries(manifest.author).some(([key, value]) =>
      !['name', 'email', 'url'].includes(key) || typeof value !== 'string'))) ||
    ('keywords' in manifest && (!Array.isArray(manifest.keywords) || manifest.keywords.some((value) => typeof value !== 'string')))
  )) throw new Error('The portable manifest contains invalid metadata.');

  const notices: string[] = [];
  const skills: PluginSkill[] = [];
  const servers: PluginServer[] = [];
  const supported = [...metadata, ...(portable ? ['$schema', 'extensions'] : ['skills', 'mcpServers', 'displayName', 'interface'])];
  for (const key of Object.keys(manifest)) {
    if (!supported.includes(key)) notices.push(`Manifest field "${key}" is not imported.`);
  }
  if ('extensions' in manifest) {
    if (object(manifest.extensions)) {
      for (const key of Object.keys(manifest.extensions)) notices.push(`Client extension "${key}" is not imported.`);
    } else if (portable) notices.push('Invalid client extensions were ignored.');
  }

  const roots = new Set(['skills']);
  if (!portable && manifest.skills !== undefined) {
    for (const value of Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills]) {
      if (value === '.' || value === './') roots.add('');
      else {
        const path = localPath(value);
        if (path) roots.add(path);
        else notices.push('An unsupported skill directory declaration was skipped.');
      }
    }
  }
  for (const path of files.keys()) {
    if (!path.endsWith('/SKILL.md')) continue;
    const parent = path.split('/').slice(0, -2).join('/');
    if (!roots.has(parent)) continue;
    try {
      skills.push(skillFrom(path, await read(path), notices));
    } catch {
      notices.push(`${path} was skipped. Check its frontmatter, instructions, and file size.`);
    }
  }

  const coveredFiles = new Set<string>(manifestPaths);
  const serverEntries = new Map<string, unknown>();
  const addServers = (entries: JsonObject) => {
    for (const [name, value] of Object.entries(entries)) serverEntries.set(name, value);
  };
  const addMcpFile = async (path: string) => {
    coveredFiles.add(path);
    try {
      const config = await json(path);
      if (portable && (config.$schema !== schemaRoot + 'mcp.schema.json' ||
        !object(config.mcpServers) || Object.keys(config).some((key) => key !== '$schema' && key !== 'mcpServers'))) {
        throw new Error('Expected a matching Agent Plugins 1.0 MCP schema and an mcpServers object.');
      }
      addServers(object(config.mcpServers) ? config.mcpServers : config);
    } catch (error) {
      notices.push(`${path} was skipped. ${(error as Error).message}`);
    }
  };
  const defaultMcp = portable ? 'mcp.json' : '.mcp.json';
  if (files.has(defaultMcp)) await addMcpFile(defaultMcp);
  if (!portable && manifest.mcpServers !== undefined) {
    for (const value of Array.isArray(manifest.mcpServers) ? manifest.mcpServers : [manifest.mcpServers]) {
      const path = localPath(value);
      if (object(value)) addServers(value);
      else if (path?.endsWith('.json')) {
        if (path !== defaultMcp) await addMcpFile(path);
      } else notices.push('An unsupported MCP declaration was skipped. Use a local JSON file or an inline server map.');
    }
  }

  for (const [name, value] of serverEntries) {
    if (!object(value) || !nonempty(name) || name.length > 80) {
      notices.push('An invalid MCP server entry was skipped.');
      continue;
    }
    const supportedTransport = value.type === 'streamable-http' ||
      (!portable && (value.type === 'http' || (value.type === undefined && !('command' in value))));
    const url = supportedTransport ? remoteUrl(value.url) : undefined;
    if (!url) {
      notices.push(`${name} was skipped. Only Streamable HTTP servers with a literal HTTP or HTTPS URL are supported.`);
      continue;
    }
    if (Object.keys(value).some((key) => !['type', 'url'].includes(key))) {
      notices.push(`${name}: bundled headers and other server settings are not imported. Configure authentication in Endeavor.`);
    }
    servers.push({ name, url });
  }

  const extras = new Set<string>();
  const skillFiles = new Set(skills.map(({ path }) => path));
  for (const path of files.keys()) {
    if (coveredFiles.has(path) || skillFiles.has(path) || /^(?:README|LICENSE|CHANGELOG)(?:[.-]|$)/i.test(path)) continue;
    if (path.endsWith('/SKILL.md') && roots.has(path.split('/').slice(0, -2).join('/'))) continue;
    extras.add(path.split('/')[0]);
  }
  for (const name of extras) notices.push(`Additional files under "${name}" are not imported.`);

  return {
    name: manifest.name.trim(),
    version: nonempty(manifest.version) ? manifest.version.trim() : undefined,
    description: nonempty(manifest.description) ? manifest.description.trim() : undefined,
    format: formats[manifestPaths.indexOf(manifestPath)],
    skills,
    servers,
    notices: [...new Set(notices)]
  };
}
