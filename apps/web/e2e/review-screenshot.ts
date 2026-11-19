import { basename } from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';

// Review images are optional. Playwright still captures every failure automatically.
export async function captureReviewScreenshot(
  target: Page | Locator,
  options: NonNullable<Parameters<Page['screenshot']>[0]>
) {
  if (process.env.E2E_SCREENSHOTS !== '1') return;
  await target.screenshot({
    ...options,
    path: test.info().outputPath(basename(options.path ?? 'review.png'))
  });
}
