import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('JSON to Types', () => {
  test('generates a TypeScript interface as you type, switches language, and copies it', async ({ page }) => {
    await gotoTool(page, 'json-to-types');
    const tool = widget(page);
    const output = tool.locator('.output');

    await tool.getByLabel(/json input/i).fill('{"name": "Ada", "age": 36}');
    await expect(output).toContainText('export interface Root {');
    await expect(output).toContainText('name: string;');

    await tool.getByLabel(/target language/i).selectOption('go');
    await expect(output).toContainText('package main');

    await expectCopies(page, tool.getByTitle(/copy the generated go types/i), 'type Root struct');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/json input/i)).toHaveValue('');
  });

  test('shows a visible error for a root value with no fields', async ({ page }) => {
    await gotoTool(page, 'json-to-types');
    const tool = widget(page);

    await tool.getByLabel(/json input/i).fill('"just a string"');
    await expect(tool.getByRole('alert')).toBeVisible();
  });

  test('loads the sample JSON', async ({ page }) => {
    await gotoTool(page, 'json-to-types');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByLabel(/json input/i)).not.toHaveValue('');
    await expect(tool.locator('.output')).toContainText('export interface Root {');
  });

  test('converts XML input once the input format is switched', async ({ page }) => {
    await gotoTool(page, 'json-to-types');
    const tool = widget(page);

    await tool.getByLabel(/input format/i).selectOption('xml');
    await tool.getByLabel(/xml input/i).fill('<person><name>Ada</name></person>');

    await expect(tool.locator('.output')).toContainText('export interface Person {');
    await expect(tool.locator('.output')).toContainText('name: string;');
  });
});
