import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Hash Generator now computes every digest inside a Web Worker (see 12.5 in PLAN.md) —
// this is the class of regression a unit test (which mocks the worker) cannot see: the
// worker module must actually load, run, and postMessage back a result in a real browser.
test.describe('Hash Generator', () => {
  test('hashes typed text via its worker and shows the SHA-256 digest', async ({ page }) => {
    await gotoTool(page, 'hash-generator');
    const tool = widget(page);

    await tool.getByLabel(/text to hash/i).fill('abc');
    await expect(tool.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBeVisible();
  });

  test('hashes an uploaded file via the same worker', async ({ page }) => {
    await gotoTool(page, 'hash-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^file$/i }).click();
    await tool.getByLabel(/choose a file to hash/i).setInputFiles({
      name: 'sample.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('abc'),
    });
    await expect(tool.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBeVisible();
  });
});
