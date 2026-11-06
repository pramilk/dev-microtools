import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

test.describe('TOTP Generator', () => {
  test('shows a live code for the example secret and a QR code, then clears', async ({ page }) => {
    await gotoTool(page, 'totp-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByLabel(/current one-time code/i)).toHaveText(/^\d{3} \d{3}$/);
    await expect(tool.getByText(/changes in \d+s/i)).toBeVisible();
    await expect(tool.getByRole('img', { name: /qr code for authenticator apps/i })).toBeVisible();

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/secret \(base32\)/i)).toHaveValue('');
  });

  test('validates the code it is showing', async ({ page }) => {
    await gotoTool(page, 'totp-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    const shown = (await tool.getByLabel(/current one-time code/i).textContent()) ?? '';
    await tool.getByLabel(/code to check/i).fill(shown.replace(/\s/g, ''));
    await expect(tool.getByText(/^valid: this is/i)).toBeVisible();
  });

  test('generates a secret and rejects an invalid one with an error', async ({ page }) => {
    await gotoTool(page, 'totp-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /generate secret/i }).click();
    await expect(tool.getByLabel(/current one-time code/i)).toBeVisible();

    await tool.getByLabel(/secret \(base32\)/i).fill('not base32!');
    await expect(tool.getByRole('alert')).toBeVisible();
  });

  test('has no share link because the input is a secret', async ({ page }) => {
    await gotoTool(page, 'totp-generator');
    await expect(widget(page).getByRole('button', { name: /copy link/i })).toHaveCount(0);
  });
});
