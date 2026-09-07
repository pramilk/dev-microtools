import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Color Palette Generator', () => {
  test('generates a shade scale and harmonies, copies a swatch, and switches export format', async ({ page }) => {
    await gotoTool(page, 'color-palette-generator');
    const tool = widget(page);

    await expect(tool.locator('.shade-row .swatch')).toHaveCount(11);
    await expect(tool.locator('.harmony-row .swatch')).toHaveCount(15);

    await expectCopies(page, tool.locator('.shade-row .swatch').first(), /^#[0-9a-f]{6}$/);

    await tool.getByRole('button', { name: 'Tailwind', exact: true }).click();
    await expect(tool.getByText(/brand: \{/)).toBeVisible();
  });

  test('recalculates as the base colour changes', async ({ page }) => {
    await gotoTool(page, 'color-palette-generator');
    const tool = widget(page);

    await tool.getByLabel(/^base color/i).fill('#ff0000');
    await expect(tool.locator('.shade-row .swatch')).toHaveCount(11);
  });

  test('shows a visible error for an invalid colour', async ({ page }) => {
    await gotoTool(page, 'color-palette-generator');
    const tool = widget(page);

    await tool.getByLabel(/^base color/i).fill('not a colour');
    await expect(tool.getByRole('alert')).toBeVisible();
  });
});
