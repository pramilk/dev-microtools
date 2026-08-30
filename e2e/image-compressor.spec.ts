import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Both PNG-specific passes (Oxipng lossless re-compression, image-q lossy quantization)
// now run inside a Web Worker (see 12.5 in PLAN.md) — this proves the worker module,
// including its own WASM/JS dynamic imports, actually loads and runs in a browser.
test.describe('Image Compressor', () => {
  test('compresses a generated PNG losslessly via its worker', async ({ page }) => {
    await gotoTool(page, 'image-compressor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^png$/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('selected-job-stats')).toBeVisible({ timeout: 10_000 });
  });

  test('compresses a generated PNG lossily via the same worker', async ({ page }) => {
    await gotoTool(page, 'image-compressor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^png$/i }).click();
    await tool.getByRole('button', { name: /lossy \(smaller\)/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('selected-job-stats')).toBeVisible({ timeout: 10_000 });
  });
});
