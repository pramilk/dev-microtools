import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Security Headers Analyzer', () => {
  test('grades the example, copies the report and clears', async ({ page }) => {
    await gotoTool(page, 'security-headers-analyzer');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/security headers grade: f/i)).toBeVisible();
    await expect(tool.getByText('MIME sniffing is not disabled')).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy security headers report/i), 'Security headers grade F');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/response headers/i)).toHaveValue('');
  });

  test('shows an error for text that is not headers', async ({ page }) => {
    await gotoTool(page, 'security-headers-analyzer');
    const tool = widget(page);

    await tool.getByLabel(/response headers/i).fill('this is not a header dump');
    await expect(tool.getByRole('alert')).toBeVisible();
  });

  test('opens the collapsed instructions for getting headers', async ({ page }) => {
    await gotoTool(page, 'security-headers-analyzer');
    const tool = widget(page);

    await expect(tool.getByText(/curl -I https/)).toBeHidden();
    await tool.getByText(/how do i get the response headers/i).click();
    await expect(tool.getByText(/curl -I https/)).toBeVisible();
  });
});
