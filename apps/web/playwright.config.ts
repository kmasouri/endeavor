import { defineConfig } from '@playwright/test';

// Exercise the production bundle: CSS order can differ from Vite's development server.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  globalTimeout: 300_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5190',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'vite preview --host 127.0.0.1 --port 5190 --strictPort',
    url: 'http://127.0.0.1:5190/app/',
    reuseExistingServer: false
  }
});
