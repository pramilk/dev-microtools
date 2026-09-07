import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Cron Expression Generator', () => {
  test('builds a schedule from the field controls, copies it, and applies a preset', async ({ page }) => {
    await gotoTool(page, 'cron-expression-generator');
    const tool = widget(page);

    await expect(tool.getByText('0 9 * * *', { exact: true })).toBeVisible();

    const domField = tool.getByRole('group', { name: /^day of month mode$/i }).locator('..');
    await domField.getByRole('button', { name: /^specific$/i }).click();
    await domField.getByRole('button', { name: '15', exact: true }).click();
    await expect(tool.getByText('0 9 15 * *', { exact: true })).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy the cron expression/i), '0 9 15 * *');

    await tool.getByRole('button', { name: /every weekday at 9am/i }).click();
    await expect(tool.getByText('0 9 * * 1,2,3,4,5', { exact: true })).toBeVisible();
  });

  test('clears every field to a wildcard', async ({ page }) => {
    await gotoTool(page, 'cron-expression-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByText('* * * * *', { exact: true })).toBeVisible();
  });
});
