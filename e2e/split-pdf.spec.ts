import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { gotoTool, widget } from './support/toolPage';

// pdf-lib runs inside a module Web Worker that unit tests can only fake, "Download all"
// lazily loads fflate, and "Pick pages" draws thumbnails with pdf.js (its own worker, plus
// same-origin data files) — none of which jsdom can run. This proves all three load and work.
const partNames = (page: import('@playwright/test').Page) => widget(page).getByTestId('split-part').locator('.splitpdf-row__name').allTextContents();

/**
 * The preview server doesn't apply `public/_headers`, so this page's real Content-Security-
 * Policy is read from there and added to the document response — a policy that blocks the
 * PDF workers, the blob: preview or pdf.js's WebAssembly then fails here instead of in
 * production.
 */
async function pageCsp(): Promise<string> {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf-8');
  const block = headers.split(/\r?\n\/split-pdf\/\r?\n/)[1] ?? '';
  const csp = /^\s+Content-Security-Policy: (.+)$/m.exec(block)?.[1];
  if (!csp) throw new Error('no Content-Security-Policy for /split-pdf/ in public/_headers');
  return csp.trim();
}

test.describe('Split PDF', () => {
  const cspViolations: string[] = [];

  test.beforeEach(async ({ page }) => {
    cspViolations.length = 0;
    const csp = await pageCsp();
    await page.route('**/split-pdf/', async (route) => {
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

  test('splits the example in its worker and downloads a valid part', async ({ page }) => {
    await gotoTool(page, 'split-pdf');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    const result = tool.getByTestId('split-result');
    await expect(result).toContainText(/3 files from 6 pages/, { timeout: 30_000 });
    expect(await partNames(page)).toEqual(['employee-handbook-page-1.pdf', 'employee-handbook-pages-2-3.pdf', 'employee-handbook-pages-4-6.pdf']);
    await expect(tool.getByTitle('Preview of employee-handbook-page-1.pdf')).toHaveAttribute('src', /^blob:.*#view=FitH$/);

    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: 'Download employee-handbook-pages-4-6.pdf' }).click()]);
    expect(download.suggestedFilename()).toBe('employee-handbook-pages-4-6.pdf');
    const doc = await PDFDocument.load(await readFile(await download.path()));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getForm().getFields().map((field) => field.getName())).toEqual(['employee-name']);
  });

  test('downloads every part as a ZIP', async ({ page }) => {
    await gotoTool(page, 'split-pdf');
    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('split-result')).toContainText(/3 files/, { timeout: 30_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: /download all \(\.zip\)/i }).click()]);
    expect(download.suggestedFilename()).toBe('employee-handbook-split.zip');
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
  });

  test('switches to By bookmarks and validates ranges', async ({ page }) => {
    await gotoTool(page, 'split-pdf');
    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('split-result')).toContainText(/3 files/, { timeout: 30_000 });

    const ranges = tool.getByLabel(/page ranges — one file each/i);
    await ranges.fill('1, 12');
    await expect(ranges).toHaveAttribute('aria-invalid', 'true');
    await expect(tool.getByText(/Page 12 doesn’t exist/)).toBeVisible();
    await expect(tool.getByTestId('split-result')).toBeHidden();

    await tool.getByRole('button', { name: 'By bookmarks' }).click();
    await expect(tool.getByTestId('split-result')).toContainText(/4 files from 6 pages/, { timeout: 30_000 });
  });

  test('Pick pages draws real thumbnails with pdf.js and extracts the picked pages', async ({ page }) => {
    const failedAssets: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/vendor/pdfjs-') && !response.ok()) failedAssets.push(`${response.status()} ${response.url()}`);
    });
    await gotoTool(page, 'split-pdf');
    // Proves the production policy really is in force (it only allows same-origin, data: and
    // blob: images), so "no violations" below means pdf.js works under it — not that no policy
    // was applied. An image, not eval: Playwright's evaluate() is exempt from eval rules.
    const blockedDirective = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener('securitypolicyviolation', (event) => resolve(event.violatedDirective), { once: true });
          const probe = document.createElement('img');
          probe.src = 'https://example.invalid/csp-probe.png';
          document.body.append(probe);
          window.setTimeout(() => resolve('not blocked'), 2000);
        })
    );
    expect(blockedDirective).toBe('img-src');
    cspViolations.length = 0; // That refusal was the point; anything after it is a real problem.

    const tool = widget(page);
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByTestId('split-result')).toContainText(/3 files/, { timeout: 30_000 });

    await tool.getByRole('button', { name: 'Pick pages' }).click();
    const thumbnails = tool.locator('img.pdf-thumb__img');
    await expect(thumbnails).toHaveCount(6, { timeout: 30_000 });
    // Actually drawn, not just present: every image decoded to real pixels.
    await expect.poll(() => thumbnails.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);

    // The zoom button shows a page full size, without picking it.
    await tool.getByRole('button', { name: 'View page 3 full size' }).click();
    const large = page.getByRole('dialog', { name: 'Page 3 of 6' }).getByRole('img');
    await expect.poll(() => large.evaluate((element) => (element as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(400);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(tool.getByText(/Click the pages you want/)).toBeVisible();

    await tool.getByTestId('split-page').nth(1).click();
    await tool.getByTestId('split-page').nth(4).click();
    await expect(tool.getByText(/2 of 6 pages picked/)).toBeVisible();
    await expect(tool.getByTestId('split-result')).toContainText(/1 file from 6 pages/, { timeout: 30_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: /^download pdf$/i }).click()]);
    expect(download.suggestedFilename()).toBe('employee-handbook-extracted.pdf');
    expect((await PDFDocument.load(await readFile(await download.path()))).getPageCount()).toBe(2);
    expect(failedAssets).toEqual([]);
  });

  test('serves pdf.js’s WebAssembly decoders same-origin', async ({ page }) => {
    const { version } = JSON.parse(await readFile(new URL('../node_modules/pdfjs-dist/package.json', import.meta.url), 'utf-8')) as { version: string };
    const wasm = await page.request.get(`/vendor/pdfjs-${version}/wasm/openjpeg.wasm`);
    expect(wasm.ok()).toBe(true);
    expect((await wasm.body()).subarray(0, 4).toString('hex')).toBe('0061736d');
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'split-pdf');
    const tool = widget(page);
    await tool.getByLabel(/choose a pdf to split/i).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(tool.getByRole('alert')).toContainText(/isn't a PDF/);
  });
});
