import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
// Local checks need a browser download once. CI also installs its Linux system libraries.
for (const args of [
  // Operator-built execution images already contain browsers and their system libraries.
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH
    ? []
    : [['install', ...(process.env.CI ? ['--with-deps'] : []), 'chromium']]),
  ['test', ...process.argv.slice(2)]
]) {
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
