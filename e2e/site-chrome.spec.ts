import { test, expect } from '@playwright/test';
import { gotoTool } from './support/toolPage';

/*
 * The sidebar and the theme toggle are plain `<script>` tags in .astro components, not
 * islands, so `gotoTool`'s hydration check says nothing about them. Their logic is unit
 * tested (src/lib/sidebar.test.ts, src/lib/theme.test.ts); what only a real browser can
 * prove is that Astro still bundles and runs those modules on a built page at all.
 */

const sidebar = 'aside.sidebar';

test.describe('Tools sidebar', () => {
  test('filters the tool list as you type', async ({ page }) => {
    await gotoTool(page, 'json-formatter');
    const search = page.locator('[data-sidebar-search]');

    await search.fill('formatter');
    await expect(page.locator(`${sidebar} a`, { hasText: 'JSON Formatter' })).toBeVisible();
    await expect(page.locator(`${sidebar} a`, { hasText: 'UUID Generator' })).toBeHidden();

    await search.fill('');
    await expect(page.locator(`${sidebar} a`, { hasText: 'UUID Generator' })).toBeVisible();
  });

  test('says so when nothing matches', async ({ page }) => {
    await gotoTool(page, 'json-formatter');
    await page.locator('[data-sidebar-search]').fill('nonsensequery');

    await expect(page.locator('[data-sidebar-empty]')).toBeVisible();
  });

  test('focuses the search field on Ctrl+K, opening the sidebar first if needed', async ({ page }) => {
    await gotoTool(page, 'json-formatter');
    const search = page.locator('[data-sidebar-search]');

    await page.locator('[data-sidebar-toggle]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'closed');

    await page.keyboard.press('Control+k');
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'open');
    await expect(search).toBeFocused();
  });
});

test.describe('Theme toggle', () => {
  test('cycles system, light and dark, and remembers the choice', async ({ page }) => {
    await gotoTool(page, 'json-formatter');
    const html = page.locator('html');
    const toggle = page.locator('[data-theme-toggle]').first();

    await expect(html).not.toHaveAttribute('data-theme', /.*/);

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // The pre-paint inline script in BaseLayout has to pick the stored value back up.
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await toggle.click();
    await expect(html).not.toHaveAttribute('data-theme', /.*/);
  });
});
