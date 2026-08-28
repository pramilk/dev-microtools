import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Base Converter', () => {
  test('encodes, decodes, copies and clears', async ({ page }) => {
    await gotoTool(page, 'base-encode-decode');
    const tool = widget(page);
    const input = tool.getByLabel(/plain text/i);

    await input.fill('foobar');
    await expect(tool.locator('pre.output')).toHaveText('Zm9vYmFy');

    await expectCopies(page, tool.getByRole('button', { name: 'Copy', exact: true }), 'Zm9vYmFy');

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toHaveValue('');

    // Decoding the other way round, and a bad alphabet producing a visible error.
    await tool.getByRole('button', { name: 'Decode', exact: true }).click();
    await tool.getByLabel(/base64/i).fill('Zm9vYmFy');
    await expect(tool.locator('pre.output')).toHaveText('foobar');

    await tool.getByLabel(/base64/i).fill('not valid!!');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/alphabet/i);
  });

  test('switches between the three merged formats', async ({ page }) => {
    await gotoTool(page, 'base-encode-decode');
    const tool = widget(page);

    await tool.getByLabel(/plain text/i).fill('foobar');
    await expect(tool.locator('pre.output')).toHaveText('Zm9vYmFy');

    await tool.getByRole('button', { name: 'Base32', exact: true }).click();
    await expect(tool.locator('pre.output')).toHaveText('MZXW6YTBOI======');

    await tool.getByRole('button', { name: 'Base58', exact: true }).click();
    await expect(tool.locator('pre.output')).toHaveText('t1Zv2yaZ');
  });

  test('honours the ?format= deep link left behind by the old Base32 URL', async ({ page }) => {
    // The 301 from /base32-encode-decode/ lands here with ?format=base32; if that stops
    // working the redirect silently drops people on the wrong tool.
    await page.goto('/base-encode-decode/?format=base32');
    await expect(page.locator('astro-island:not([ssr])').first()).toBeAttached();

    const tool = widget(page);
    await tool.getByLabel(/plain text/i).fill('foobar');
    await expect(tool.locator('pre.output')).toHaveText('MZXW6YTBOI======');
  });
});
