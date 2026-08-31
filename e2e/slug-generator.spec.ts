import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Slug Generator', () => {
  test('generates a slug as you type, switches separator, and copies it', async ({ page }) => {
    await gotoTool(page, 'slug-generator');
    const tool = widget(page);

    await tool.getByLabel(/^text/i).fill('Hello World!');
    await expect(tool.getByText('hello-world', { exact: true })).toBeVisible();

    await tool.getByRole('button', { name: /^underscore/i }).click();
    await expect(tool.getByText('hello_world', { exact: true })).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy the slug/i), 'hello_world');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/^text/i)).toHaveValue('');
  });

  test('shows a visible error when nothing survives slugifying', async ({ page }) => {
    await gotoTool(page, 'slug-generator');
    const tool = widget(page);

    await tool.getByLabel(/^text/i).fill('日本語');
    await expect(tool.getByRole('alert')).toBeVisible();
  });

  test('loads the sample text', async ({ page }) => {
    await gotoTool(page, 'slug-generator');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByLabel(/^text/i)).not.toHaveValue('');
  });
});
