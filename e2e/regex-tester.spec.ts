import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

// The pattern and test-string fields are addressed by role as well as label: once there
// are matches, the tool renders a highlight overlay that carries a label of its own.
const patternField = (tool: ReturnType<typeof widget>) =>
  tool.getByRole('textbox', { name: /regular expression/i });
const subjectField = (tool: ReturnType<typeof widget>) =>
  tool.getByRole('textbox', { name: /test string/i });

test.describe('Regex Tester', () => {
  test('matches, highlights and reports invalid patterns', async ({ page }) => {
    await gotoTool(page, 'regex-tester');
    const tool = widget(page);

    await patternField(tool).fill('\\d+');
    await subjectField(tool).fill('a1 b22 c333');
    await expect(tool.getByText('3 matches')).toBeVisible();
    await expect(tool.locator('mark').first()).toBeVisible();

    // An invalid pattern is reported, not swallowed.
    await patternField(tool).fill('[unclosed');
    const alert = tool.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toBeEmpty();
  });

  test('loads the example and copies replaced output', async ({ page }) => {
    await gotoTool(page, 'regex-tester');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(patternField(tool)).not.toHaveValue('');
    await expect(tool.getByText(/\d+ matches?/)).toBeVisible();

    await tool.getByLabel(/show replace/i).check();
    await patternField(tool).fill('(\\w+)@(\\w+)');
    await subjectField(tool).fill('user@host');
    await tool.getByLabel(/replacement/i).fill('$2:$1');

    await expect(tool.getByText('host:user')).toBeVisible();
    await expectCopies(page, tool.getByRole('button', { name: 'Copy', exact: true }), 'host:user');
  });

  test('copies the match list and clears everything', async ({ page }) => {
    await gotoTool(page, 'regex-tester');
    const tool = widget(page);

    await patternField(tool).fill('\\d+');
    await subjectField(tool).fill('a1 b22 c333');
    await expect(tool.getByText('3 matches')).toBeVisible();

    // `\r?\n` rather than a plain substring: the system clipboard normalises line endings
    // on Windows, so the copied text comes back CRLF-separated there and LF elsewhere.
    await expectCopies(page, tool.getByRole('button', { name: /copy matches/i }), /^1\r?\n22\r?\n333$/);

    const clear = tool.getByRole('button', { name: 'Clear', exact: true });
    await clear.click();
    await expect(patternField(tool)).toHaveValue('');
    await expect(subjectField(tool)).toHaveValue('');
    await expect(clear).toBeDisabled();
  });

  test('kills a hung worker on a catastrophic pattern the static guard cannot catch (12.5\'s real ReDoS backstop)', async ({ page }) => {
    // `(a|a)+$` is ambiguous alternation, not the "bare repeated group" shape regex.ts's
    // static guard (hasCatastrophicBacktrackingRisk) looks for — its own doc names this
    // exact shape as a known miss. Matching runs in a Web Worker now (see 12.5 in
    // PLAN.md), which is what makes killing it possible at all: a synchronous
    // RegExp.exec on the main thread cannot be interrupted once started, only a whole
    // worker thread can be terminated out from under it.
    await gotoTool(page, 'regex-tester');
    const tool = widget(page);

    await patternField(tool).fill('(a|a)+$');
    await subjectField(tool).fill('a'.repeat(32) + 'b');

    await expect(tool.getByText(/took too long to run and was stopped/i)).toBeVisible({ timeout: 5_000 });
  });
});
