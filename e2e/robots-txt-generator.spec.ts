import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

test.describe('robots.txt & llms.txt Generator', () => {
  test('generates a policy, reacts to a preset, and warns about a costly rule', async ({ page }) => {
    await gotoTool(page, 'robots-txt-generator');
    const tool = widget(page);
    const output = tool.locator('.output');

    // Arrives on a real stance, not an empty file.
    await expect(output).toContainText('User-agent: GPTBot');

    await tool.getByRole('button', { name: 'Block scrapers & SEO bots' }).click();
    await expect(output).toContainText('User-agent: AhrefsBot');
    await expect(output).not.toContainText('User-agent: GPTBot');

    // Groups are collapsed disclosures; a visitor opens one to reach the crawlers in it.
    await tool.locator('summary', { hasText: 'Search engines' }).click();
    await tool.getByLabel('Policy for Googlebot').selectOption('block');
    await expect(tool.locator('.msg--warning')).toContainText('Googlebot');
  });

  test('shows a visible error for a malformed path instead of emitting a broken file', async ({ page }) => {
    await gotoTool(page, 'robots-txt-generator');
    const tool = widget(page);

    await tool.getByLabel('Disallowed paths').fill('admin/');

    await expect(tool.getByRole('alert')).toContainText('must start with');
    await expect(tool.locator('.output--empty')).toBeVisible();
  });

  test('switches to the llms.txt tab and builds a document there', async ({ page }) => {
    await gotoTool(page, 'robots-txt-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: 'llms.txt', exact: true }).click();
    await tool.getByRole('button', { name: /load example/i }).click();

    await expect(tool.locator('.output')).toContainText('# Acme Widgets');
    await expect(tool.locator('.output')).toContainText('## API');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.locator('.output--empty')).toBeVisible();
  });
});
