import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Diff Checker', () => {
  test('reports differences, copies them and clears both panes', async ({ page }) => {
    await gotoTool(page, 'diff-checker');
    const tool = widget(page);
    const left = tool.getByLabel(/original/i);
    const right = tool.getByLabel(/compare with/i);

    // Identical input gets an explicit confirmation rather than an empty result.
    await left.fill('same');
    await right.fill('same');
    await expect(tool.getByText(/texts are identical/i)).toBeVisible();

    await left.fill('alpha\nbeta\n');
    await right.fill('alpha\ngamma\n');
    await expect(tool.getByText(/^differences$/i)).toBeVisible();
    await expect(tool.locator('.stats__item').filter({ hasText: /added/i })).toContainText('1');
    await expect(tool.locator('.stats__item').filter({ hasText: /removed/i })).toContainText('1');

    await expectCopies(page, tool.getByRole('button', { name: 'Copy', exact: true }), 'gamma');

    await tool.getByRole('button', { name: /clear both/i }).click();
    await expect(left).toHaveValue('');
    await expect(right).toHaveValue('');
  });

  test('loads the example and switches to side-by-side view', async ({ page }) => {
    await gotoTool(page, 'diff-checker');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByLabel(/original/i)).not.toHaveValue('');
    await expect(tool.getByText(/^differences$/i)).toBeVisible();

    await tool.getByRole('button', { name: /side by side/i }).click();
    await expect(tool.getByLabel(/two aligned columns/i)).toBeVisible();
  });
});
