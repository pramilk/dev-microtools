import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

// JS minification runs Terser inside a Web Worker (see 12.5 in PLAN.md) — this proves the
// worker module actually loads and Terser runs to completion in a browser.
test.describe('HTML/CSS/JS Minifier', () => {
  test('minifies JavaScript via its worker', async ({ page }) => {
    await gotoTool(page, 'html-css-js-minifier');
    const tool = widget(page);

    await tool.getByLabel(/javascript input/i).fill('function greet(name) {\n  return `hi ${name}`;\n}\n');
    await expect(tool.getByTestId('minify-stats')).toBeVisible();
    await expect(tool.getByTestId('minify-stats')).toContainText(/smaller/i);
  });
});
