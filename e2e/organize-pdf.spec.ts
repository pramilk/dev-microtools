import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { gotoTool, widget } from './support/toolPage';

// pdf-lib runs inside a module Web Worker that unit tests can only fake, compression uses the
// worker's real OffscreenCanvas codec, and the thumbnails, full-size view and blank-page
// detection draw with pdf.js (its own worker, plus same-origin data files) — none of which
// jsdom can run. This proves they all load and work under the page's real CSP.

/** The preview server doesn't apply `public/_headers`, so this page's real CSP is read from
 *  there and added to the document response (see split-pdf.spec.ts). */
async function pageCsp(): Promise<string> {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf-8');
  const block = headers.split(/\r?\n\/organize-pdf\/\r?\n/)[1] ?? '';
  const csp = /^\s+Content-Security-Policy: (.+)$/m.exec(block)?.[1];
  if (!csp) throw new Error('no Content-Security-Policy for /organize-pdf/ in public/_headers');
  return csp.trim();
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** A PDF of text pages with blank ones where `blank` says. */
async function pdfWithBlanks(blank: boolean[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  blank.forEach((isBlank, index) => {
    const page = doc.addPage([595, 842]);
    if (!isBlank) for (let line = 0; line < 20; line++) page.drawText(`Page ${index + 1}, line ${line + 1} of some body text`, { x: 60, y: 760 - line * 24, size: 14, font });
  });
  return Buffer.from(await doc.save());
}

async function loadExample(page: Page) {
  await gotoTool(page, 'organize-pdf');
  const tool = widget(page);
  await tool.getByRole('button', { name: /load example/i }).click();
  await expect(tool.getByTestId('organize-result')).toContainText(/6 pages/, { timeout: 30_000 });
  return tool;
}

test.describe('Organize PDF', () => {
  const cspViolations: string[] = [];

  test.beforeEach(async ({ page }) => {
    cspViolations.length = 0;
    const csp = await pageCsp();
    await page.route('**/organize-pdf/', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) cspViolations.push(message.text());
    });
  });

  test.afterEach(() => {
    expect(cspViolations).toEqual([]);
  });

  test('fixes the example — reorder, rotate, remove, number, compress — and downloads it', async ({ page }) => {
    const tool = await loadExample(page);
    const thumbnails = tool.locator('img.pdf-thumb__img');
    await expect(thumbnails).toHaveCount(6, { timeout: 30_000 });
    await expect.poll(() => thumbnails.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);

    const cards = tool.getByTestId('organize-page');
    await cards.nth(2).locator('.orgpdf-card').click();
    await tool.getByRole('button', { name: /earlier/i }).click();
    await tool.getByRole('button', { name: 'Rotate page 4 left' }).click();
    await tool.getByRole('button', { name: /^remove page 5/i }).click();
    await expect(cards).toHaveCount(5);
    await expect(tool.getByText('reordered · 1 page rotated · 1 page removed')).toBeVisible();

    await tool.getByRole('checkbox', { name: /page numbers/i }).check();
    await tool.getByLabel(/number from page/i).fill('2');
    await tool.getByRole('button', { name: 'Balanced' }).click();
    const result = tool.getByTestId('organize-result');
    await expect(result).toContainText('4 pages numbered', { timeout: 30_000 });
    await expect(result).toContainText(/5 pages/);
    await expect(result.getByText(/Compressed|Already compact/)).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: /download pdf/i }).click()]);
    expect(download.suggestedFilename()).toBe('quarterly-report-organized.pdf');
    const doc = await PDFDocument.load(await readFile(await download.path()));
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(3).getRotation().angle).toBe(0);
  });

  test('shows a page full size from its zoom button', async ({ page }) => {
    const tool = await loadExample(page);
    await tool.getByRole('button', { name: 'View page 2 full size' }).click();
    const dialog = page.getByRole('dialog', { name: 'Page 2 of 6' });
    const image = dialog.getByRole('img', { name: 'Page 2 of 6' });
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(400);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Page 3 of 6' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(tool.getByRole('button', { name: 'View page 2 full size' })).toBeFocused();
  });

  test('finds the blank pages in a scan-like PDF with real pdf.js drawing', async ({ page }) => {
    await gotoTool(page, 'organize-pdf');
    const tool = widget(page);
    await tool.getByLabel(/choose a pdf to organize/i).setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: await pdfWithBlanks([false, true, false, true]) });
    await expect(tool.getByTestId('organize-page')).toHaveCount(4, { timeout: 30_000 });
    await tool.getByRole('button', { name: /find blank pages/i }).click();
    await expect(tool.getByText(/Found 2 blank pages — they’re selected/)).toBeVisible({ timeout: 30_000 });
    await tool.getByRole('button', { name: /remove selected pages/i }).click();
    await expect(tool.getByTestId('organize-page')).toHaveCount(2);
  });

  test('inserts another PDF, and draws a watermark and an image background', async ({ page }) => {
    const tool = await loadExample(page);
    await tool.getByLabel(/insert pages from other pdfs/i).setInputFiles({ name: 'extra.pdf', mimeType: 'application/pdf', buffer: await pdfWithBlanks([false, false]) });
    await expect(tool.getByTestId('organize-page')).toHaveCount(8, { timeout: 30_000 });

    await tool.getByRole('checkbox', { name: /watermark/i }).check();
    await tool.getByRole('button', { name: /^image$/i }).click();
    await tool.getByLabel(/background image/i).setInputFiles({ name: 'paper.png', mimeType: 'image/png', buffer: PNG });
    const result = tool.getByTestId('organize-result');
    await expect(result).toContainText(/8 pages .* from 2 PDFs/, { timeout: 30_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: /download pdf/i }).click()]);
    expect((await PDFDocument.load(await readFile(await download.path()))).getPageCount()).toBe(8);
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'organize-pdf');
    const tool = widget(page);
    await tool.getByLabel(/choose a pdf to organize/i).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(tool.getByRole('alert')).toContainText(/isn't a PDF/);
  });
});
