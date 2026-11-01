import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// The pipeline — pdf-lib plus the OffscreenCanvas PNG codec — runs inside a module Web
// Worker that unit tests can only fake. This proves the worker bundle loads, the sample is
// generated with a real canvas, and the extracted images actually render as <img>s.
test.describe('PDF Image Extractor', () => {
  test('extracts the example PDF into a gallery and opens the viewer', async ({ page }) => {
    await gotoTool(page, 'pdf-image-extractor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    const result = tool.getByTestId('pie-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/4 images from 2 pages/);

    const cards = tool.getByRole('list', { name: /extracted images/i }).getByRole('listitem');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText(/1200×800 · JPEG/);

    // Every thumbnail decoded for real — a broken blob or a bad PNG would leave width 0.
    const thumbs = tool.locator('.pie-card__thumb img');
    await expect(thumbs).toHaveCount(3);
    for (const thumb of await thumbs.all()) {
      await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    }

    await cards.nth(1).getByRole('button', { name: /view image 2/i }).click();
    const viewer = page.getByRole('dialog', { name: /image 2 of 4/i });
    await expect(viewer).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: /image 4 of 4/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('downloads all images as a ZIP', async ({ page }) => {
    await gotoTool(page, 'pdf-image-extractor');
    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('pie-result')).toBeVisible({ timeout: 30_000 });

    const download = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download all \(3\) as zip/i }).click();
    expect((await download).suggestedFilename()).toBe('sample-brochure-images.zip');
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'pdf-image-extractor');
    const tool = widget(page);
    await tool.getByLabel(/choose a pdf to extract images from/i).setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await expect(tool.getByRole('alert')).toContainText(/PDF header/, { timeout: 15_000 });
  });
});
