import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Chmod Calculator', () => {
  test('converts between octal and symbolic, toggles a checkbox, copies and clears', async ({ page }) => {
    await gotoTool(page, 'chmod-calculator');
    const tool = widget(page);

    await expect(tool.getByText('rwxr-xr-x', { exact: true })).toBeVisible();

    await tool.getByLabel(/^permission/i).fill('644');
    await expect(tool.getByText('rw-r--r--', { exact: true })).toBeVisible();

    await tool.getByLabel('Owner execute').check();
    await expect(tool.getByLabel(/^permission/i)).toHaveValue('744');

    await expectCopies(page, tool.getByTitle(/copy the octal permission/i), '744');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/^permission/i)).toHaveValue('');
  });

  test('shows a visible error for an invalid permission', async ({ page }) => {
    await gotoTool(page, 'chmod-calculator');
    const tool = widget(page);

    await tool.getByLabel(/^permission/i).fill('not-a-permission');
    await expect(tool.getByRole('alert')).toBeVisible();
  });

  test('applies a preset', async ({ page }) => {
    await gotoTool(page, 'chmod-calculator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^700$/, exact: true }).click();
    await expect(tool.getByLabel(/^permission/i)).toHaveValue('700');
  });
});
