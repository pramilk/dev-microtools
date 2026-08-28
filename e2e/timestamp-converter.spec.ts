import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Timestamp Converter', () => {
  test('converts an epoch, copies a row and clears', async ({ page }) => {
    await gotoTool(page, 'timestamp-converter');
    const tool = widget(page);
    const input = tool.getByLabel(/unix timestamp/i);

    // The tool seeds itself with the current time, so it must show a result on arrival.
    await expect(tool.getByText(/current unix time/i)).toBeVisible();

    await input.fill('1700000000');
    await expect(tool.getByText('2023-11-14T22:13:20.000Z')).toBeVisible();
    await expect(tool.getByText('Tuesday', { exact: true })).toBeVisible();

    // Each result row has its own copy control, addressed by its title.
    await expectCopies(
      page,
      tool.getByTitle('Copy ISO 8601 (UTC) to clipboard'),
      '2023-11-14T22:13:20.000Z'
    );

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toHaveValue('');
  });

  test('reports unparseable input and converts in the other direction', async ({ page }) => {
    await gotoTool(page, 'timestamp-converter');
    const tool = widget(page);

    await tool.getByLabel(/unix timestamp/i).fill('not a timestamp');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toBeEmpty();

    await tool.getByRole('button', { name: /date → timestamp/i }).click();
    await tool.getByLabel(/^date/i).fill('2023-11-14T22:13:20Z');
    await expect(tool.getByText('1700000000', { exact: true })).toBeVisible();
  });
});
