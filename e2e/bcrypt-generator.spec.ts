import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Bcrypt hashing/verification now runs inside a Web Worker (see 12.5 in PLAN.md) — this
// proves the worker module actually loads and bcryptjs runs to completion in a browser.
test.describe('Bcrypt Generator', () => {
  test('generates a bcrypt hash via its worker', async ({ page }) => {
    await gotoTool(page, 'bcrypt-generator');
    const tool = widget(page);

    await tool.getByLabel(/^password$/i).fill('hunter2');
    await tool.getByRole('button', { name: /generate hash/i }).click();
    await expect(tool.getByText(/^\$2[aby]\$/)).toBeVisible();
  });

  test('verifies a matching password against a freshly generated hash', async ({ page }) => {
    await gotoTool(page, 'bcrypt-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /verify/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await tool.getByRole('button', { name: /verify hash/i }).click();
    await expect(tool.getByText(/match — this password produces that hash/i)).toBeVisible();
  });
});
