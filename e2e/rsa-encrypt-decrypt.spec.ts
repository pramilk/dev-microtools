import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// The primary button reads e.g. "Encrypt (RSA-OAEP, SHA-256)", distinct from the bare
// "Encrypt"/"Decrypt" direction toggle.
const ACTION = /^(en|de)crypt \(rsa-/i;

test.describe('RSA Encrypt / Decrypt', () => {
  test('decrypts the sample ciphertext with the demo private key', async ({ page }) => {
    await gotoTool(page, 'rsa-encrypt-decrypt');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^decrypt$/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.locator('pre.output')).toHaveText('The deploy key rotates on Friday at 09:00 UTC.');
  });

  test('generates a key pair and round-trips text with the Hybrid scheme', async ({ page }) => {
    await gotoTool(page, 'rsa-encrypt-decrypt');
    const tool = widget(page);

    await tool.getByRole('button', { name: /generate key pair/i }).click();
    await expect(tool.getByText(/new 2048-bit key pair/i)).toBeVisible();
    await tool.getByLabel(/^scheme$/i).selectOption('hybrid');
    await tool.getByLabel(/plain text/i).fill('hello from the browser '.repeat(20));
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.locator('pre.output')).not.toHaveClass(/output--empty/);

    await tool.getByRole('button', { name: /decrypt result/i }).click();
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.locator('pre.output')).toHaveText('hello from the browser '.repeat(20));
  });

  test('shows a visible error for a key it cannot use', async ({ page }) => {
    await gotoTool(page, 'rsa-encrypt-decrypt');
    const tool = widget(page);

    await tool.getByLabel(/plain text/i).fill('hello');
    await tool.getByLabel(/public key/i).fill('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----');
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.getByRole('alert')).toContainText('openssl x509 -pubkey');
  });
});
