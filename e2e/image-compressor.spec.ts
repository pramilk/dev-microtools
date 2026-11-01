import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Both PNG-specific passes (Oxipng lossless re-compression, image-q lossy quantization)
// now run inside a Web Worker (see 12.5 in PLAN.md) — this proves the worker module,
// including its own WASM/JS dynamic imports, actually loads and runs in a browser.
// "Load example" downloads a static sample from public/samples/image-compressor/.
test.describe('Image Compressor', () => {
  test('compresses the sample PNG losslessly via its worker', async ({ page }) => {
    await gotoTool(page, 'image-compressor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^png$/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('selected-job-stats')).toBeVisible({ timeout: 10_000 });
  });

  test('compresses the sample PNG lossily via the same worker', async ({ page }) => {
    await gotoTool(page, 'image-compressor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^png$/i }).click();
    await tool.getByRole('button', { name: /lossy \(smaller\)/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('selected-job-stats')).toBeVisible({ timeout: 10_000 });
  });

  for (const [format, file] of [
    ['JPEG', 'sample.jpg'],
    ['WebP', 'sample.webp'],
  ] as const) {
    test(`downloads and compresses the ${format} sample`, async ({ page }) => {
      await gotoTool(page, 'image-compressor');
      const tool = widget(page);

      await tool.getByRole('button', { name: new RegExp(`^${format}$`, 'i') }).click();
      const sample = page.waitForResponse((response) => response.url().endsWith(`/samples/image-compressor/${file}`));
      await tool.getByRole('button', { name: /load example/i }).click();
      expect((await sample).ok()).toBe(true);
      // The job row's name specifically — the auto-selected detail panel shows it too.
      await expect(tool.locator('.job__name', { hasText: file })).toBeVisible();
      await expect(tool.getByTestId('selected-job-stats')).toBeVisible({ timeout: 10_000 });
    });
  }
});
