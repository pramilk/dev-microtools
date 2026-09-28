import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// The primary button reads e.g. "Encrypt (AES-256-GCM)", distinct from the bare
// "Encrypt"/"Decrypt" direction toggle.
const ACTION = /^(en|de)crypt \(aes-/i;

test.describe('AES Encrypt / Decrypt', () => {
  test('decrypts the sample ciphertext with the native Web Crypto engine', async ({ page }) => {
    await gotoTool(page, 'aes-encrypt-decrypt');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^decrypt$/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.locator('pre.output')).toHaveText('Meet me at the usual place at 10pm.');
  });

  // Proves the lazily imported @noble chunk actually loads from the built site.
  test('round-trips text with the pure-JavaScript engine', async ({ page }) => {
    await gotoTool(page, 'aes-encrypt-decrypt');
    const tool = widget(page);

    await tool.getByRole('button', { name: /pure js/i }).click();
    await tool.getByLabel(/plain text/i).fill('hello from noble');
    await tool.getByLabel(/iterations/i).fill('1000');
    await tool.getByLabel(/^passphrase$/i).fill('swordfish');
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.locator('pre.output')).not.toHaveClass(/output--empty/);
    await expect(tool.getByRole('region', { name: /what you need to decrypt/i })).toContainText('AES-256-GCM');

    await tool.getByRole('button', { name: /decrypt result/i }).click();
    await tool.getByRole('button', { name: ACTION }).click();
    await expect(tool.locator('pre.output')).toHaveText('hello from noble');
  });

  test('encrypts a file to a downloadable .enc and decrypts it back', async ({ page }) => {
    await gotoTool(page, 'aes-encrypt-decrypt');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^file$/i }).click();
    await tool.getByLabel(/choose a file to encrypt/i).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('file contents'),
    });
    await tool.getByLabel(/iterations/i).fill('1000');
    await tool.getByLabel(/^passphrase$/i).fill('swordfish');
    await tool.getByRole('button', { name: ACTION }).click();

    const downloadEncrypted = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download notes\.txt\.enc/i }).click();
    expect((await downloadEncrypted).suggestedFilename()).toBe('notes.txt.enc');

    await tool.getByRole('button', { name: /decrypt result/i }).click();
    await tool.getByRole('button', { name: ACTION }).click();

    const downloadPlain = page.waitForEvent('download');
    await tool.getByRole('button', { name: /download notes\.txt$/i }).click();
    const saved = await (await downloadPlain).path();
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(saved, 'utf8')).toBe('file contents');
  });
});
