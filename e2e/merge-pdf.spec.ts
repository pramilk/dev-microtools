import { readFile } from 'node:fs/promises';
import { test, expect, type Locator } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { gotoTool, widget } from './support/toolPage';

// pdf-lib runs inside a module Web Worker that unit tests can only fake, and drag-to-reorder
// uses real HTML drag and drop, which jsdom can't position. This proves the worker bundle
// loads, the merge produces a valid PDF, and a real drag lands where the pointer says.
const rowNames = (tool: Locator) => tool.getByTestId('merge-row').locator('.mergepdf-row__name').allTextContents();

test.describe('Merge PDF', () => {
  test('merges the example files in its worker and downloads a valid PDF', async ({ page }) => {
    await gotoTool(page, 'merge-pdf');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    const result = tool.getByTestId('merge-result');
    await expect(result).toContainText(/6 pages from 3 files/, { timeout: 30_000 });
    await expect(result).toContainText(/7 bookmarks · 1 form field kept fillable/);
    await expect(tool.getByTitle('Merged PDF preview')).toHaveAttribute('src', /^blob:.*#view=FitH$/);

    await tool.getByLabel(/file name for the merged pdf/i).fill('board pack');
    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: /download merged pdf/i }).click()]);
    expect(download.suggestedFilename()).toBe('board pack.pdf');
    const path = await download.path();
    const merged = await PDFDocument.load(await readFile(path));
    expect(merged.getPageCount()).toBe(6);
    expect(merged.getForm().getFields().map((field) => field.getName())).toEqual(['reviewer']);
  });

  test('reorders files by dragging a handle, and re-merges', async ({ page }) => {
    // Tall enough that the whole list is on screen at once — a pointer can't drag onto a row
    // below the viewport.
    await page.setViewportSize({ width: 1280, height: 1600 });
    await gotoTool(page, 'merge-pdf');
    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('merge-result')).toBeVisible({ timeout: 30_000 });

    const rows = tool.getByTestId('merge-row');
    const target = rows.nth(2);
    const box = await target.boundingBox();
    if (!box) throw new Error('target row has no box');
    // Lower half of the last row: "insert after it".
    await rows.nth(0).locator('.mergepdf-row__handle').dragTo(target, { targetPosition: { x: 40, y: box.height - 6 } });
    await expect.poll(() => rowNames(tool)).toEqual(['quarterly-report.pdf', 'appendix.pdf', 'cover-letter.pdf']);
    await expect(tool.getByTestId('merge-result')).toContainText(/6 pages/, { timeout: 30_000 });
  });

  test('validates a page range and merges only the chosen pages', async ({ page }) => {
    await gotoTool(page, 'merge-pdf');
    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('merge-result')).toContainText(/6 pages/, { timeout: 30_000 });

    const range = tool.getByLabel('Pages to include from quarterly-report.pdf');
    await range.fill('7');
    await expect(range).toHaveAttribute('aria-invalid', 'true');
    await expect(tool.getByText(/Page 7 doesn’t exist/)).toBeVisible();
    await expect(tool.getByTestId('merge-result')).toBeHidden();

    await range.fill('2-');
    await expect(tool.getByTestId('merge-result')).toContainText(/5 pages from 3 files/, { timeout: 30_000 });
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'merge-pdf');
    const tool = widget(page);
    await tool.getByLabel(/choose pdfs to merge/i).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(tool.getByRole('alert')).toContainText(/isn't a PDF/);
  });
});
