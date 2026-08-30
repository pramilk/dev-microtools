import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

test.describe('LLM Token Counter', () => {
  test('counts a loaded example and prices it', async ({ page }) => {
    await gotoTool(page, 'llm-token-counter');
    const tool = widget(page);

    // Nothing typed yet, so the count starts at zero rather than blank.
    await expect(tool.locator('.count-card__value')).toHaveText('0');

    await tool.getByRole('button', { name: /load example/i }).click();

    await expect(tool.locator('.count-card__value')).not.toHaveText('0');
    await expect(tool.locator('.cost-table__total td')).not.toHaveText('$0.00');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/prompt or document/i)).toHaveValue('');
  });

  test('downloads the real vocabulary by itself and counts exactly', async ({ page }) => {
    await gotoTool(page, 'llm-token-counter');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    // 80 is the real o200k_base count for the example prompt — proving the lazily-loaded
    // vocabulary chunk actually resolves in a built, served page, with nothing to opt into.
    await expect(tool.locator('.count-card__value')).toHaveText('80', { timeout: 30_000 });
    await expect(tool.locator('.count-badge')).toHaveText('Exact');
    await expect(tool.locator('.tokens__piece')).toHaveCount(80);
  });

  test('warns that a model with no public tokenizer can only be estimated', async ({ page }) => {
    await gotoTool(page, 'llm-token-counter');
    const tool = widget(page);

    await tool.getByLabel(/^model$/i).selectOption('claude-opus-5');

    const warning = tool.locator('.msg--warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Anthropic has not published its tokenizer');
    await expect(tool.locator('.count-badge')).toHaveText('Estimate');
  });
});
