import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Timezone Converter', () => {
  test('loads the example, converts across zones, flags the next day and copies a row', async ({ page }) => {
    await gotoTool(page, 'timezone-converter');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    const results = tool.getByRole('list', { name: /converted times/i });
    await expect(results.getByText('Asia/Kolkata')).toBeVisible();
    await expect(results.getByText(/UTC\+5:30/)).toBeVisible();
    // 09:00 in New York is already past midnight the next day in Sydney.
    await expect(results.getByText('+1 day')).toBeVisible();

    // The example's zones share no working hour, and the planner says so.
    await expect(tool.getByText(/no hour on this day falls inside/i)).toBeVisible();

    await expectCopies(
      page,
      tool.getByTitle('Copy Asia/Kolkata time (ISO 8601) to clipboard'),
      '2026-03-14T18:30:00+05:30'
    );
  });

  test('explains a time that daylight saving skips, then clears', async ({ page }) => {
    await gotoTool(page, 'timezone-converter');
    const tool = widget(page);

    await tool.getByLabel('Source time zone').fill('America/New_York');
    await tool.getByLabel(/date and time/i).fill('2026-03-08T02:30');

    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/does not exist/i);

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(tool.getByLabel(/date and time/i)).toHaveValue('');
    await expect(tool.getByRole('alert')).toHaveCount(0);
  });

  test('adds and rejects zones', async ({ page }) => {
    await gotoTool(page, 'timezone-converter');
    const tool = widget(page);

    await tool.getByLabel('Add a time zone').fill('Europe/Paris');
    await tool.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(tool.getByRole('list', { name: /converted times/i }).getByText('Europe/Paris')).toBeVisible();

    await tool.getByLabel('Add a time zone').fill('Atlantis/Core');
    await tool.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(tool.getByRole('alert')).toContainText(/Atlantis\/Core/);
  });
});
