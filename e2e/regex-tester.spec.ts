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

    /*
     * Regex Tester's only copy control lives inside the replace panel, and it has no
     * Clear/reset control at all — unlike every other tool here. Both are real gaps in
     * the copy/clear consistency rule (see GAP-ANALYSIS.md); this test covers what the
     * tool actually offers today and will need broadening once they are closed.
     */
    await tool.getByLabel(/show replace/i).check();
    await patternField(tool).fill('(\\w+)@(\\w+)');
    await subjectField(tool).fill('user@host');
    await tool.getByLabel(/replacement/i).fill('$2:$1');

    await expect(tool.getByText('host:user')).toBeVisible();
    await expectCopies(page, tool.getByRole('button', { name: 'Copy', exact: true }), 'host:user');
  });
});
