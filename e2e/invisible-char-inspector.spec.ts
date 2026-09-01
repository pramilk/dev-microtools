import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

// Built from code points rather than pasted as raw glyphs — see the comment at the top
// of src/lib/tools/invisibleChars.test.ts for why.
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);
const ZWSP = cp(0x200b);
const CYRILLIC_A = cp(0x0430);

test.describe('Invisible & Homoglyph Inspector', () => {
  test('flags a zero-width space, shows a success message once removed, and copies the cleaned text', async ({ page }) => {
    await gotoTool(page, 'invisible-char-inspector');
    const tool = widget(page);

    await tool.getByLabel(/text to inspect/i).fill(`a${ZWSP}b`);
    await expect(tool.getByText(/1 flagged character/i)).toBeVisible();
    await expect(tool.getByText(/^Invisible/).first()).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy the cleaned text/i), 'ab');

    await tool.getByLabel(/text to inspect/i).fill('plain text with nothing hidden');
    await expect(tool.getByText(/no invisible characters/i)).toBeVisible();
  });

  test('leaves a homoglyph untouched until its checkbox is ticked', async ({ page }) => {
    await gotoTool(page, 'invisible-char-inspector');
    const tool = widget(page);

    const spoofed = `p${CYRILLIC_A}ypal.com`;
    const cleanedOutput = tool.locator('pre.output');
    await tool.getByLabel(/text to inspect/i).fill(spoofed);
    await expect(cleanedOutput).toHaveText(spoofed);

    await tool.getByRole('checkbox', { name: /homoglyph/i }).check();
    await expect(cleanedOutput).toHaveText('paypal.com');
  });

  test('loads the sample text with findings detected', async ({ page }) => {
    await gotoTool(page, 'invisible-char-inspector');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByLabel(/text to inspect/i)).not.toHaveValue('');
    await expect(tool.getByText(/flagged character/i)).toBeVisible();
  });

  test('clears the input when Clear is pressed', async ({ page }) => {
    await gotoTool(page, 'invisible-char-inspector');
    const tool = widget(page);

    await tool.getByLabel(/text to inspect/i).fill(`a${ZWSP}b`);
    await tool.getByRole('button', { name: /^clear$/i }).click();

    await expect(tool.getByLabel(/text to inspect/i)).toHaveValue('');
    await expect(tool.getByText(/findings appear here/i)).toBeVisible();
  });
});
