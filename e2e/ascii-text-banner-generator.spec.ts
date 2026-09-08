import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('ASCII Text Banner Generator', () => {
  test('loads the example and renders a block-letter banner', async ({ page }) => {
    await gotoTool(page, 'ascii-text-banner-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    const banner = tool.locator('.output');
    await expect(banner).toContainText('█');
    await expect(tool.getByRole('button', { name: /download/i })).toBeEnabled();
  });

  test('switching to the Hash preset swaps the fill character', async ({ page }) => {
    await gotoTool(page, 'ascii-text-banner-generator');
    const tool = widget(page);

    await tool.getByPlaceholder(/type or paste text here/i).fill('HI');
    await tool.getByRole('button', { name: 'Hash' }).click();

    const banner = tool.locator('.output');
    await expect(banner).toContainText('#');
    await expect(banner).not.toContainText('█');
  });

  test('flags an unsupported character instead of silently dropping it', async ({ page }) => {
    await gotoTool(page, 'ascii-text-banner-generator');
    const tool = widget(page);

    await tool.getByPlaceholder(/type or paste text here/i).fill('HI~');

    await expect(tool.getByRole('alert')).toContainText(/isn.t in the built-in font/i);
  });

  test('copies the rendered banner to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoTool(page, 'ascii-text-banner-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expectCopies(page, tool.getByRole('button', { name: 'Copy', exact: true }), '█');
  });
});
