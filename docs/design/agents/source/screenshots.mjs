// Takes the PNGs in ../ from ../agents.html. Run build.mjs first.
// Run from the repo root: node docs/design/agents/source/screenshots.mjs
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..');
const preview = pathToFileURL(join(out, 'agents.html')).href;

const shots = [
  // [file name, screen, width, theme, action]
  ['agents', 'Main', 1440, 'dark'],
  ['agents-light', 'Main', 1440, 'light'],
  ['agents-mobile', 'Main', 390, 'dark'],
  ['agents-empty', 'AgentsEmpty', 1440, 'dark'],
  ['agents-empty-light', 'AgentsEmpty', 1440, 'light'],
  ['agent-overview', 'AgentDetail', 1440, 'dark'],
  ['agent-overview-light', 'AgentDetail', 1440, 'light'],
  ['agent-overview-mobile', 'AgentDetail', 390, 'dark'],
  ['agent-configuration', 'AgentConfig', 1440, 'dark'],
  ['agent-configuration-light', 'AgentConfig', 1440, 'light'],
  ['agent-configuration-removing', 'AgentConfig', 1440, 'dark', 'remove'],
  ['agent-versions', 'AgentVersions', 1440, 'dark'],
  ['new-agent', 'NewAgent', 1440, 'dark'],
  ['new-agent-mobile', 'NewAgent', 390, 'dark'],
  ['picker-search', 'Picker', 820, 'dark', 'search']
];

const browser = await chromium.launch();
const problems = [];
for (const [name, screen, width, theme, action] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  await page.goto(`${preview}?bare=1&screen=${screen}&theme=${theme}`);
  await page.waitForSelector('html[data-rendered]');
  if (action === 'remove') {
    await page.getByRole('button', { name: 'Remove Web search' }).click();
    await page.getByRole('button', { name: 'Remove Plain-language briefs' }).click();
  }
  if (action === 'search') {
    await page.getByRole('combobox', { name: 'Add a skill…' }).click();
    await page.keyboard.type('re');
  }
  // Grow the window to the page so sticky bars sit at the real bottom.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.max(screen === 'Picker' ? 560 : 1000, height) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) problems.push(`${name}: scrolls sideways by ${overflow}px`);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
}
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
