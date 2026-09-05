import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Proves the Lanczos resample actually runs inside its Web Worker in a real browser, and
// that switching multipliers re-runs it and produces a downloadable result — the
// island-hydration and worker-loading regressions unit/component tests can't see.
test.describe('Image Upscaler', () => {
  test('upscales the bundled sample image 4x by default and offers a download', async ({ page }) => {
    await gotoTool(page, 'image-upscaler');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    await expect(tool.getByText(/300×225px.*→.*1,200×900px/)).toBeVisible({ timeout: 10_000 });
    await expect(tool.getByRole('button', { name: /download/i })).toBeVisible({ timeout: 10_000 });
    await expect(tool.getByText('300 × 225 px')).toBeVisible();
    await expect(tool.getByText('1,200 × 900 px')).toBeVisible();
  });

  test('switching to 2x re-runs the resample and shows the new projected size', async ({ page }) => {
    await gotoTool(page, 'image-upscaler');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByRole('button', { name: /download/i })).toBeVisible({ timeout: 10_000 });

    await tool.getByRole('button', { name: '2×' }).click();

    await expect(tool.getByText(/300×225px.*→.*600×450px/)).toBeVisible({ timeout: 10_000 });
    await expect(tool.getByText('600 × 450 px')).toBeVisible({ timeout: 10_000 });
  });
});
