import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('X.509 Certificate Decoder', () => {
  test('decodes the example, checks a hostname, copies the report and clears', async ({ page }) => {
    await gotoTool(page, 'x509-certificate-decoder');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/example\.test — /)).toBeVisible();
    await expect(tool.getByText(/matches the wildcard \*\.example\.test/i)).toBeVisible();
    // The fingerprint is computed with SubtleCrypto in the real browser.
    await expect(tool.getByText(/^2E:2A:F1:24:E1:C3/)).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy certificate report/i), 'Certificate: example.test');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/certificate or csr/i)).toHaveValue('');
  });

  test('refuses a private key and rejects non-certificate text with an error', async ({ page }) => {
    await gotoTool(page, 'x509-certificate-decoder');
    const tool = widget(page);

    await tool.getByLabel(/certificate or csr/i).fill('-----BEGIN PRIVATE KEY-----\nMIGH\n-----END PRIVATE KEY-----');
    await expect(tool.getByRole('alert')).toContainText(/private key/i);

    await tool.getByLabel(/certificate or csr/i).fill('not a certificate');
    await expect(tool.getByRole('alert')).toContainText(/no certificate found/i);
  });

  test('opens the collapsed instructions for getting a certificate', async ({ page }) => {
    await gotoTool(page, 'x509-certificate-decoder');
    const tool = widget(page);

    await expect(tool.getByText(/openssl s_client/)).toBeHidden();
    await tool.getByText(/how do i get a certificate/i).click();
    await expect(tool.getByText(/openssl s_client/)).toBeVisible();
  });
});
