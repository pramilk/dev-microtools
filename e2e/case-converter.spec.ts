import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Case Converter', () => {
  test('converts text, copies the result and clears', async ({ page }) => {
    await gotoTool(page, 'case-converter');
    const tool = widget(page);
    const input = tool.getByLabel(/^text/i);

    await input.fill('hello world');
    await tool.getByRole('button', { name: 'UPPERCASE', exact: true }).click();
    await expect(input).toHaveValue('HELLO WORLD');

    await tool.getByRole('button', { name: 'snake_case', exact: true }).click();
    await expect(input).toHaveValue('hello_world');

    await expectCopies(page, tool.getByRole('button', { name: /^copy text$/i }), 'hello_world');

    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toHaveValue('');
  });

  test('loads the sample text', async ({ page }) => {
    await gotoTool(page, 'case-converter');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByLabel(/^text/i)).toHaveValue(/SpaceX/);
  });
});
