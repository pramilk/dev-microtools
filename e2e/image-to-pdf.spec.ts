import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { gotoTool, widget } from './support/toolPage';

// The pipeline — pdf-lib plus the browser's createImageBitmap/OffscreenCanvas decoder — runs
// in a module Web Worker that unit tests can only fake. This proves the worker loads, the
// canvas-drawn example images decode, and the downloaded file is a real PDF whose pages have
// the shapes the options asked for (including the sideways phone photo turned upright).
test.describe('Image to PDF', () => {
  test('builds the example images into a PDF and downloads it', async ({ page }) => {
    await gotoTool(page, 'image-to-pdf');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    const result = tool.getByTestId('image-pdf-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/3 pages/);
    await expect(result).toContainText(/2 JPEGs embedded as-is/);
    await expect(result).toContainText(/1 photo turned upright/);
    await expect(tool.getByTitle('PDF preview')).toHaveAttribute('src', /^blob:/);

    const download = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download pdf/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('images.pdf');
    const path = await file.path();
    const { readFile } = await import('node:fs/promises');
    const doc = await PDFDocument.load(await readFile(path));
    const sizes = doc.getPages().map((p) => p.getSize()).map(({ width, height }) => (width > height ? 'landscape' : 'portrait'));
    expect(sizes).toEqual(['landscape', 'landscape', 'portrait']);
  });

  test('rebuilds when the page size changes', async ({ page }) => {
    await gotoTool(page, 'image-to-pdf');
    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('image-pdf-result')).toBeVisible({ timeout: 30_000 });
    const before = await tool.getByTitle('PDF preview').getAttribute('src');

    await tool.getByRole('button', { name: 'Fit to image' }).click();
    await expect(tool.getByRole('button', { name: 'Auto' })).toBeDisabled();
    await expect.poll(() => tool.getByTitle('PDF preview').getAttribute('src'), { timeout: 15_000 }).not.toBe(before);
  });

  test('rejects a non-image file with a visible error', async ({ page }) => {
    await gotoTool(page, 'image-to-pdf');
    const tool = widget(page);
    await tool.getByLabel(/choose images to convert to pdf/i).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(tool.getByRole('alert')).toContainText(/isn't an image/);
  });
});
