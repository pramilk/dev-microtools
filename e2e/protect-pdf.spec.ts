import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// The cipher and pdf-lib run in a module Web Worker that unit tests can only fake. This proves
// the worker bundle loads in a real browser and produces a file that really is encrypted.
test.describe('Protect PDF', () => {
  test('protects the generated example PDF in its worker', async ({ page }) => {
    await gotoTool(page, 'protect-pdf');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/3 pages ·/)).toBeVisible({ timeout: 30_000 });
    await expect(tool.getByLabel('Open password')).toHaveValue('Sample-Pass-42');

    await tool.getByRole('button', { name: /protect pdf/i }).click();
    const result = tool.getByTestId('pdf-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/Protected with AES-256/);
    await expect(result).toContainText(/Restricted: Copying text and images, Editing content/);

    const download = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download quarterly-report-protected\.pdf/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('quarterly-report-protected.pdf');
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'protect-pdf');
    const tool = widget(page);

    await tool.getByLabel(/choose a pdf to protect/i).setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await expect(tool.getByRole('alert')).toContainText(/PDF header/, { timeout: 15_000 });
  });
});
