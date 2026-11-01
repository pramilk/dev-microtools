import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

/** The preview server doesn't apply `public/_headers`, so this page's real CSP is read from
 *  there and added to the document response (see split-pdf.spec.ts). */
async function pageCsp(): Promise<string> {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf-8');
  const block = headers.split(/\r?\n\/pdf-to-image\/\r?\n/)[1] ?? '';
  const csp = /^\s+Content-Security-Policy: (.+)$/m.exec(block)?.[1];
  if (!csp) throw new Error('no Content-Security-Policy for /pdf-to-image/ in public/_headers');
  return csp.trim();
}

// pdf.js (its own worker, same-origin data files) draws on a real canvas, which jsdom can't do.
// This proves the pages are really drawn, encoded as JPEG/PNG, and downloadable under the
// page's real CSP.
test.describe('PDF to Image', () => {
  const cspViolations: string[] = [];

  test.beforeEach(async ({ page }) => {
    cspViolations.length = 0;
    const csp = await pageCsp();
    await page.route('**/pdf-to-image/', async (route) => {
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

  test('converts the example to JPEG and downloads a real JPEG', async ({ page }) => {
    await gotoTool(page, 'pdf-to-image');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/^4 pages · /)).toBeVisible({ timeout: 30_000 });
    await expect(tool.getByRole('radio', { name: 'JPEG' })).toBeChecked();

    await tool.getByRole('button', { name: /convert 4 pages/i }).click();
    await expect(tool.getByTestId('p2i-image')).toHaveCount(4, { timeout: 60_000 });
    await expect(tool.getByTestId('p2i-result')).toContainText(/1240 × 1754 px/);

    const download = page.waitForEvent('download');
    await tool.getByTestId('p2i-image').first().getByRole('button', { name: /download/i }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('product-brief-page-1.jpg');
    const path = await saved.path();
    const bytes = await readFile(path);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  test('converts only chosen pages to PNG and offers a ZIP', async ({ page }) => {
    await gotoTool(page, 'pdf-to-image');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/^4 pages · /)).toBeVisible({ timeout: 30_000 });
    await tool.getByRole('radio', { name: 'PNG' }).check();
    await tool.getByLabel('Resolution').selectOption('72');
    await tool.getByRole('radio', { name: /choose pages/i }).check();
    await tool.getByTestId('p2i-page').nth(1).click();
    await tool.getByTestId('p2i-page').nth(3).click();
    await expect(tool.getByLabel('Page numbers')).toHaveValue('2, 4');

    await tool.getByRole('button', { name: /convert 2 pages/i }).click();
    await expect(tool.getByTestId('p2i-image')).toHaveCount(2, { timeout: 60_000 });
    await expect(tool.getByTestId('p2i-result')).toContainText(/595 × 842 px/);

    const download = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download all \(2\) as zip/i }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('product-brief-images.zip');
    const bytes = await readFile(await saved.path());
    expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'pdf-to-image');
    const tool = widget(page);
    await tool.getByLabel(/choose a pdf to convert/i).setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await expect(tool.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  });
});
