import { test, expect, type Locator } from '@playwright/test';
import { gotoTool, widget } from './support/toolPage';

/** Opens the example gallery and clicks the named card. */
async function loadExample(tool: Locator, label: string): Promise<void> {
  await tool.getByText('Examples', { exact: true }).click();
  await tool.getByRole('button', { name: label, exact: true }).click();
}

// Proves the real `mermaid` package actually renders in a real browser — unit/component
// tests mock it out entirely because mermaid.render() lays out diagrams via d3/dagre and
// measures text with SVG APIs (getBBox) that jsdom doesn't implement reliably. This is also
// the only place every newer/beta diagram type (sankey, xychart, block, architecture, radar,
// C4, railroad grammars, etc.) actually gets exercised against the real parser.
test.describe('Mermaid Diagram Generator', () => {
  test('loads the flowchart example and renders a real SVG diagram', async ({ page }) => {
    await gotoTool(page, 'mermaid-diagram-generator');
    const tool = widget(page);

    await loadExample(tool, 'Flowchart');

    const diagram = tool.getByRole('img', { name: /rendered diagram preview/i });
    await expect(diagram).toBeVisible({ timeout: 10_000 });
    await expect(diagram.locator('svg')).toBeVisible();
    await expect(tool.getByRole('button', { name: /copy svg/i })).toBeEnabled();
    await expect(tool.getByRole('button', { name: /download svg/i })).toBeEnabled();
    await expect(tool.getByRole('button', { name: /download pdf/i })).toBeEnabled();
  });

  test('shows the real Mermaid parser error for invalid syntax, not a blank preview', async ({ page }) => {
    await gotoTool(page, 'mermaid-diagram-generator');
    const tool = widget(page);

    await tool.getByLabel(/diagram source/i).fill('flowchart TD\nA --> {{{ not valid');

    await expect(tool.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await expect(tool.getByRole('img', { name: /rendered diagram preview/i })).not.toBeAttached();
  });

  test('shows a live type badge and snippet buttons once a diagram type is recognized, and a snippet inserts real text', async ({ page }) => {
    await gotoTool(page, 'mermaid-diagram-generator');
    const tool = widget(page);
    const input = tool.getByLabel(/diagram source/i);

    await input.fill('sequenceDiagram\n');
    await expect(tool.locator('.badge--ai')).toHaveText('Sequence Diagram');

    await tool.getByRole('button', { name: /^participant$/i }).click();
    await expect(input).toHaveValue(/participant A/);
  });

  test('zooms and resets the preview', async ({ page }) => {
    await gotoTool(page, 'mermaid-diagram-generator');
    const tool = widget(page);
    await loadExample(tool, 'Flowchart');
    await expect(tool.getByRole('img', { name: /rendered diagram preview/i })).toBeVisible({ timeout: 10_000 });

    const zoomLevel = tool.locator('.tnum');
    await tool.getByRole('button', { name: /zoom in/i }).click();
    await expect(zoomLevel).toHaveText('125%');

    await tool.getByRole('button', { name: /^reset$/i }).click();
    await expect(zoomLevel).toHaveText('100%');
  });

  test('re-renders when the theme changes', async ({ page }) => {
    await gotoTool(page, 'mermaid-diagram-generator');
    const tool = widget(page);
    await loadExample(tool, 'Flowchart');
    const diagram = tool.getByRole('img', { name: /rendered diagram preview/i });
    await expect(diagram).toBeVisible({ timeout: 10_000 });

    await tool.getByLabel(/diagram theme/i).selectOption('dark');

    await expect(diagram.locator('svg')).toBeVisible({ timeout: 10_000 });
  });

  test('renders a live thumbnail for every example once the gallery is opened', async ({ page }) => {
    await gotoTool(page, 'mermaid-diagram-generator');
    const tool = widget(page);

    await tool.getByText('Examples', { exact: true }).click();
    const cards = tool.locator('.mermaid-examples__card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(25);

    // Sequential real renders of every example type — allow generous time for all of them.
    // Counts the thumbnail wrappers themselves, not the svgs inside: some diagram types embed
    // more than one nested <svg> (markers, icons), which would over-count a plain svg locator.
    await expect(async () => {
      const thumbCount = await tool.locator('.mermaid-examples__thumb-canvas').count();
      expect(thumbCount).toBe(cardCount);
    }).toPass({ timeout: 30_000 });
  });

  // A representative sample of the newer/beta diagram types — not all 32 (that's the
  // thumbnail-gallery test's job), just proof each syntax family actually parses correctly
  // against the real, installed Mermaid version rather than a syntax guess that looked right.
  for (const label of [
    'Kanban Board',
    'Sankey Diagram',
    'XY Chart',
    'Block Diagram',
    'Architecture Diagram',
    'Radar Chart',
    'Event Modeling',
    'Treemap',
    'C4 Diagram',
    'Ishikawa (Fishbone) Diagram',
    'Swimlane Diagram',
    'Venn Diagram',
    'Wardley Map',
    'Railroad Diagram (ABNF)',
    'Railroad Diagram (EBNF)',
    'Railroad Diagram (PEG)',
    'TreeView',
  ]) {
    test(`renders the "${label}" example without error`, async ({ page }) => {
      await gotoTool(page, 'mermaid-diagram-generator');
      const tool = widget(page);

      await loadExample(tool, label);

      await expect(tool.getByRole('img', { name: /rendered diagram preview/i })).toBeVisible({ timeout: 10_000 });
      await expect(tool.getByRole('alert')).not.toBeAttached();
    });
  }
});
