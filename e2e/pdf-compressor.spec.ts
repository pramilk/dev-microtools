import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// The whole pipeline — pdf-lib, fflate and the OffscreenCanvas JPEG codec — runs inside a
// module Web Worker that unit tests can only fake. This proves the worker bundle (and its
// canvas codec) actually loads and produces a smaller PDF in a real browser.
test.describe('PDF Compressor', () => {
  test('compresses the generated example PDF in its worker', async ({ page }) => {
    await gotoTool(page, 'pdf-compressor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    const result = tool.getByTestId('pdf-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/% smaller/);
    await expect(result).toContainText(/1 of 1 image re-encoded/);
    await expect(tool.getByRole('button', { name: /download pdf/i })).toBeEnabled();
    await expect(tool.getByTitle('Compressed PDF preview')).toHaveAttribute('src', /^blob:/);
    await tool.getByRole('button', { name: 'Original' }).click();
    await expect(tool.getByTitle('Original PDF preview')).toBeVisible();
  });

  test('re-compresses when an advanced option changes', async ({ page }) => {
    await gotoTool(page, 'pdf-compressor');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('pdf-result')).toBeVisible({ timeout: 30_000 });

    await tool.getByText(/advanced options/i).click();
    await tool.getByRole('button', { name: 'Lossless' }).click();
    await expect(tool.getByText(/custom settings/i)).toBeVisible();
    await expect(tool.getByTestId('pdf-result')).toContainText(/image/, { timeout: 30_000 });
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'pdf-compressor');
    const tool = widget(page);

    await tool.getByLabel(/choose a pdf to compress/i).setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await expect(tool.getByRole('alert')).toContainText(/PDF header/, { timeout: 15_000 });
  });
});
