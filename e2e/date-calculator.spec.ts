import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Date Calculator', () => {
  test('loads the example, breaks the span down and copies a total', async ({ page }) => {
    await gotoTool(page, 'date-calculator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    await expect(tool.getByLabel('Start date', { exact: true })).toHaveValue('2000-01-15');
    await expect(tool.getByText('26 years, 1 month, 27 days')).toBeVisible();
    await expect(tool.getByText('9,555', { exact: true })).toBeVisible();
    await expect(tool.getByText('6,825', { exact: true })).toBeVisible();

    await expectCopies(page, tool.getByTitle('Copy Total days to clipboard'), '9555');
  });

  test('adds months with end-of-month clamping, then reports a bad amount', async ({ page }) => {
    await gotoTool(page, 'date-calculator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /add \/ subtract/i }).click();
    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/2026-02-28/)).toBeVisible();

    await tool.getByLabel('Days', { exact: true }).fill('1.5');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/whole number/i);
  });

  test('clears every field', async ({ page }) => {
    await gotoTool(page, 'date-calculator');
    const tool = widget(page);

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(tool.getByLabel('Start date', { exact: true })).toHaveValue('');
    await expect(tool.getByLabel('End date', { exact: true })).toHaveValue('');
  });
});
