import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('JSON Formatter', () => {
  test('formats input, reports errors, and copies and clears', async ({ page }) => {
    await gotoTool(page, 'json-formatter');
    const tool = widget(page);
    const input = tool.getByLabel(/json input/i);

    // Empty state.
    await expect(tool.getByText(/formatted json appears here/i)).toBeVisible();

    // Typing produces output — the assertion that the island is really live.
    await input.fill('{"name":"ada","tags":["x","y"]}');
    await expect(tool.locator('pre.output')).toContainText('"name": "ada"');

    // Malformed input surfaces a visible error, not a silent failure or a stack trace.
    // Prose rather than near-miss JSON, so auto-fix cannot repair it out from under the
    // assertion — the error has to still be on screen a moment later.
    await input.fill('this is just prose');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toBeEmpty();
    await expect(tool.getByText(/could not salvage/i)).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    // Copy puts the formatted JSON on the clipboard.
    await input.fill('{"a":1}');
    await expect(tool.locator('pre.output')).toContainText('"a": 1');
    await expectCopies(page, tool.getByRole('button', { name: 'Copy', exact: true }), '"a": 1');

    // Clear resets the input and the output pane together.
    await tool.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(tool.getByText(/formatted json appears here/i)).toBeVisible();
  });

  test('loads the example document', async ({ page }) => {
    await gotoTool(page, 'json-formatter');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();

    await expect(tool.getByLabel(/json input/i)).not.toHaveValue('');
    await expect(tool.locator('pre.output')).toContainText('"name": "ada"');
  });
});
