import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Lorem Ipsum Generator', () => {
  test('generates text on arrival, regenerates for a word count, and copies it', async ({ page }) => {
    await gotoTool(page, 'lorem-ipsum-generator');
    const tool = widget(page);

    await expect(tool.getByText(/lorem ipsum dolor sit amet/i)).toBeVisible();

    await tool.getByLabel(/^unit$/i).selectOption('words');
    await tool.getByLabel(/^count$/i).fill('10');

    const output = tool.locator('.output');
    await expect
      .poll(async () => ((await output.textContent()) ?? '').trim().split(/\s+/).length)
      .toBe(10);

    await expectCopies(page, tool.getByTitle(/copy the generated text/i), 'lorem');
  });

  test('wraps output in <p> tags for HTML output', async ({ page }) => {
    await gotoTool(page, 'lorem-ipsum-generator');
    const tool = widget(page);

    await tool.getByLabel(/html output/i).check();
    await expect(tool.locator('.output')).toContainText('<p>');
  });
});
