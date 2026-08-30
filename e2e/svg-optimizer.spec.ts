import { test, expect } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

const SVG_WITH_CRUFT =
  '<!-- Generator: Some Tool -->\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n' +
  '  <circle cx="5.000000" cy="5.000000" r="4" fill="#f00" />\n' +
  '</svg>\n';

// SVGO now runs inside a Web Worker (see 12.5 in PLAN.md) — this proves the worker module
// actually loads and returns a real, optimized result in a browser, not just against the
// mocked worker a unit test uses.
test.describe('SVG Optimizer', () => {
  test('optimizes pasted SVG markup via its worker', async ({ page }) => {
    await gotoTool(page, 'svg-optimizer');
    const tool = widget(page);

    await tool.getByLabel(/svg markup/i).fill(SVG_WITH_CRUFT);
    await expect(tool.getByTestId('svg-optimize-stats')).toBeVisible();
    await expect(tool.getByTestId('svg-optimize-stats')).toContainText(/smaller/i);
  });
});
