import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Cron Expression Explainer', () => {
  test('explains the default expression, lists runs and copies the description', async ({ page }) => {
    await gotoTool(page, 'cron-expression-explainer');
    const tool = widget(page);

    await expect(tool.locator('.description')).toHaveText('Every 15 minutes.');
    await expect(tool.locator('.next-runs li')).toHaveCount(5);

    await expectCopies(page, tool.getByTitle(/copy the description/i), 'Every 15 minutes.');
  });

  test('switches to Quartz, applies a preset and lists runs in a chosen time zone', async ({ page }) => {
    await gotoTool(page, 'cron-expression-explainer');
    const tool = widget(page);

    await tool.getByRole('button', { name: /quartz/i }).click();
    await tool.getByRole('button', { name: 'Third Monday of the month' }).click();
    await expect(tool.getByLabel(/cron expression/i)).toHaveValue('0 0 9 ? * 2#3');
    await expect(tool.locator('.description')).toHaveText('At 09:00, on the 3rd Monday of the month.');

    await tool.getByLabel(/time zone for next runs/i).selectOption('Asia/Tokyo');
    await expect(tool.locator('.next-runs li').first()).toContainText(/09:00/);
  });

  test('explains AWS EventBridge syntax, including a cron() wrapper', async ({ page }) => {
    await gotoTool(page, 'cron-expression-explainer');
    const tool = widget(page);

    await tool.getByRole('button', { name: /eventbridge/i }).click();
    await tool.getByLabel(/cron expression/i).fill('cron(0 12 * * ? *)');
    await expect(tool.locator('.description')).toHaveText('At 12:00.');
    await expect(tool.getByText(/evaluate cron expressions in UTC/i)).toBeVisible();
  });

  test('rejects a Quartz expression with both day fields set, and clears', async ({ page }) => {
    await gotoTool(page, 'cron-expression-explainer');
    const tool = widget(page);

    await tool.getByRole('button', { name: /quartz/i }).click();
    await tool.getByLabel(/cron expression/i).fill('0 0 12 * * *');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/"\?" in one of them/);

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(tool.getByLabel(/cron expression/i)).toHaveValue('');
  });
});
