import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('ISO 8601 Duration Parser', () => {
  test('parses a duration, copies the normalised form and clears', async ({ page }) => {
    await gotoTool(page, 'iso-duration-parser');
    const tool = widget(page);
    const input = tool.getByLabel(/iso 8601 duration/i);

    // Pre-filled with the worked example, so a result is visible on arrival.
    await expect(tool.getByText('3 years, 6 months, 4 days, 12 hours, 30 minutes, 5 seconds')).toBeVisible();

    await input.fill('PT1H30M');
    await expect(tool.getByText('1 hour, 30 minutes')).toBeVisible();
    await expect(tool.getByText('5,400', { exact: true })).toBeVisible();

    await expectCopies(page, tool.getByTitle('Copy ISO 8601 to clipboard'), 'PT1H30M');

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toHaveValue('');
  });

  test('reports a malformed duration with a helpful message', async ({ page }) => {
    await gotoTool(page, 'iso-duration-parser');
    const tool = widget(page);

    await tool.getByLabel(/iso 8601 duration/i).fill('1 hour');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/starts with "P"/);
  });

  test('builds a duration from fields', async ({ page }) => {
    await gotoTool(page, 'iso-duration-parser');
    const tool = widget(page);

    await tool.getByRole('button', { name: /build a duration/i }).click();
    await tool.getByLabel(/^days/i).fill('3');
    await tool.getByLabel(/^hours/i).fill('4');
    await expect(tool.getByText('P3DT4H', { exact: true })).toBeVisible();
  });
});
