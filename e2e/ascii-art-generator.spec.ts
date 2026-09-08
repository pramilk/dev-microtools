import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// Proves the island hydrates and the whole real pipeline runs in a real browser — fetching
// the bundled sample, decoding it, downscaling it through canvas (which jsdom can only
// stand in for) and mapping the resulting pixels onto characters.
test.describe('ASCII Art Generator', () => {
  test('converts the bundled sample image into text art', async ({ page }) => {
    await gotoTool(page, 'ascii-art-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    // A square 512×512 icon at the default 100-character width, aspect-corrected to 50 rows.
    await expect(tool.getByText(/512×512px.*→.*100×50 characters/)).toBeVisible({ timeout: 10_000 });

    const art = tool.getByRole('img', { name: /ASCII art preview/i });
    await expect(art).toBeVisible();
    expect((await art.textContent())!.split('\n')).toHaveLength(50);
    await expect(tool.getByRole('button', { name: /download \.txt/i })).toBeEnabled();
  });

  test('narrowing the width re-runs the conversion against the real canvas downscale', async ({ page }) => {
    await gotoTool(page, 'ascii-art-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/100×50 characters/)).toBeVisible({ timeout: 10_000 });

    await tool.getByLabel('Width in characters').fill('60');

    await expect(tool.getByText(/60×30 characters/)).toBeVisible({ timeout: 10_000 });
    const art = tool.getByRole('img', { name: /ASCII art preview/i });
    expect((await art.textContent())!.split('\n')).toHaveLength(30);
  });

  test('colour mode tints the characters and offers an HTML download', async ({ page }) => {
    await gotoTool(page, 'ascii-art-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByRole('img', { name: /ASCII art preview/i })).toBeVisible({ timeout: 10_000 });

    await tool.getByRole('button', { name: 'Colour' }).click();
    await tool.getByRole('button', { name: 'Standard' }).click();

    await expect(tool.locator('.ascii-preview__art span[style*="color"]').first()).toBeVisible();
    await expect(tool.getByRole('button', { name: /download \.html/i })).toBeEnabled();
  });
});
