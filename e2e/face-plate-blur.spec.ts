import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Proves the on-device face-detection model (served locally from public/models/, no
// external network call) actually loads and runs in a real browser, and that the
// canvas-based redaction pipeline produces a downloadable result — the island-hydration
// and WASM-loading regressions unit/component tests can't see.
test.describe('Face & Plate Blur', () => {
  test('detects every face in the bundled sample photo and renders a blurred result', async ({ page }) => {
    await gotoTool(page, 'face-plate-blur');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    // The bundled sample is a four-person NASA crew portrait — proves multi-face detection,
    // not just "found something".
    await expect(tool.getByTitle(/automatically detected face/i)).toHaveCount(4, { timeout: 20_000 });
    await expect(tool.getByRole('button', { name: /download/i })).toBeVisible({ timeout: 20_000 });
  });

  test('lets a manual box be added and redacted as a solid black box', async ({ page }) => {
    await gotoTool(page, 'face-plate-blur');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await tool.getByRole('button', { name: /add box/i }).click();
    await expect(tool.getByTitle(/manually added region/i)).toBeVisible();

    // Each region has its own style picker, so with 4 auto-detected faces plus this manual
    // box there are 5 "Solid box" buttons — the manual region's is the last one, since it's
    // appended to the end of the region list.
    const solidBoxButtons = tool.getByRole('button', { name: /^solid box$/i });
    await solidBoxButtons.last().click();
    await expect(solidBoxButtons.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(tool.getByRole('button', { name: /download/i })).toBeVisible({ timeout: 20_000 });
  });
});
