import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Browser Fingerprint Inspector', () => {
  test('collects and displays real browser signals on load', async ({ page }) => {
    await gotoTool(page, 'browser-fingerprint-inspector');
    const tool = widget(page);

    await expect(tool.getByText('Identity')).toBeVisible();
    await expect(tool.getByText('User-Agent', { exact: true })).toBeVisible();
    await expect(tool.getByText('Rendering fingerprint')).toBeVisible();
    await expect(tool.getByText(/signals collected across 8 categories/i)).toBeVisible();
    // The injecting Worker only runs on the real Cloudflare deployment, not this local
    // preview build, so "Network request" is expected to show its not-available fallback.
    await expect(tool.getByText('Not available in this environment')).toBeVisible();
  });

  test('resolves the canvas fingerprint hash instead of leaving it stuck', async ({ page }) => {
    await gotoTool(page, 'browser-fingerprint-inspector');
    const tool = widget(page);

    await expect(tool.getByText('Computing…')).toHaveCount(0, { timeout: 5000 });
  });

  test('rescans and copies the full report', async ({ page }) => {
    await gotoTool(page, 'browser-fingerprint-inspector');
    const tool = widget(page);

    await tool.getByRole('button', { name: /rescan/i }).click();
    await expect(tool.getByText('Identity')).toBeVisible();

    await expectCopies(page, tool.getByRole('button', { name: /^copy$/i }), /Identity/);
  });
});
