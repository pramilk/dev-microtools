import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

/** The preview server doesn't apply `public/_headers`, so this page's real CSP is read from
 *  there and added to the document response (see organize-pdf.spec.ts). */
async function pageCsp(): Promise<string> {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf-8');
  const block = headers.split(/\r?\n\/unlock-pdf\/\r?\n/)[1] ?? '';
  const csp = /^\s+Content-Security-Policy: (.+)$/m.exec(block)?.[1];
  if (!csp) throw new Error('no Content-Security-Policy for /unlock-pdf/ in public/_headers');
  return csp.trim();
}

// The cipher and pdf-lib run in a module Web Worker that unit tests can only fake. This proves
// the worker bundle loads in a real browser, decrypts a file with a password, and that the
// page's real CSP lets the browser's PDF viewer show the result.
test.describe('Unlock PDF', () => {
  const cspViolations: string[] = [];

  test.beforeEach(async ({ page }) => {
    cspViolations.length = 0;
    const csp = await pageCsp();
    await page.route('**/unlock-pdf/', async (route) => {
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

  test('unlocks the generated example PDF in its worker and previews it', async ({ page }) => {
    await gotoTool(page, 'unlock-pdf');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/Encryption:/)).toBeVisible({ timeout: 30_000 });
    await expect(tool.getByLabel('Password')).toHaveValue('Sample-Pass-42');

    await tool.getByRole('button', { name: /unlock pdf/i }).click();
    const result = tool.getByTestId('pdf-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/Unlocked · 3 pages/);
    await expect(tool.getByTitle('Unlocked PDF preview')).toHaveAttribute('src', /^blob:/);

    const download = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download quarterly-report-protected-unlocked\.pdf/i }).click();
    expect((await download).suggestedFilename()).toBe('quarterly-report-protected-unlocked.pdf');
  });

  test('says so when the password is wrong', async ({ page }) => {
    await gotoTool(page, 'unlock-pdf');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/Encryption:/)).toBeVisible({ timeout: 30_000 });
    await tool.getByLabel('Password').fill('not-the-password');
    await tool.getByRole('button', { name: /unlock pdf/i }).click();
    await expect(tool.getByRole('alert')).toContainText(/doesn’t open this PDF/, { timeout: 30_000 });
  });

  test('rejects a file that is not a PDF with a visible error', async ({ page }) => {
    await gotoTool(page, 'unlock-pdf');
    const tool = widget(page);

    await tool.getByLabel(/choose a pdf to unlock/i).setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await expect(tool.getByRole('alert')).toContainText(/PDF header/, { timeout: 15_000 });
  });
});
