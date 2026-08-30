import { describe, it, expect } from 'vitest';
import { renderLlmsTxt, type LlmsTxtInput, type LlmsTxtTool } from './llmsTxt';

const tool = (overrides: Partial<LlmsTxtTool> = {}): LlmsTxtTool => ({
  slug: 'json-formatter',
  title: 'JSON Formatter',
  summary: 'Format, validate and minify JSON.',
  category: 'Format',
  order: 0,
  ...overrides,
});

const render = (overrides: Partial<LlmsTxtInput> = {}) =>
  renderLlmsTxt({
    siteName: 'DevMicroTools',
    siteUrl: 'https://devmicrotools.com',
    summary: 'Free developer utilities that run in your browser.',
    notes: [],
    tools: [tool()],
    optionalPages: [],
    ...overrides,
  });

describe('renderLlmsTxt', () => {
  it('opens with an H1 and a blockquote summary, as the llms.txt spec requires', () => {
    const lines = render().split('\n');

    expect(lines[0]).toBe('# DevMicroTools');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('> Free developer utilities that run in your browser.');
  });

  it('lists each tool as a Markdown link with an absolute, trailing-slash URL', () => {
    // The site is `trailingSlash: 'always'`; a link without one costs a redirect hop.
    expect(render()).toContain(
      '- [JSON Formatter](https://devmicrotools.com/json-formatter/): Format, validate and minify JSON.'
    );
  });

  it('builds absolute URLs whether or not the site origin has a trailing slash', () => {
    for (const siteUrl of ['https://devmicrotools.com', 'https://devmicrotools.com/']) {
      expect(render({ siteUrl })).toContain('(https://devmicrotools.com/json-formatter/)');
    }
  });

  it('groups tools under category headings in CATEGORIES order, not input order', () => {
    // `CSS` trails `Convert` in CATEGORIES even though it is passed first here.
    const output = render({
      tools: [
        tool({ slug: 'css-gradient-generator', title: 'CSS Gradient', category: 'CSS' }),
        tool({ slug: 'base-encode-decode', title: 'Base64', category: 'Convert' }),
      ],
    });

    expect(output.indexOf('## Convert')).toBeGreaterThan(-1);
    expect(output.indexOf('## Convert')).toBeLessThan(output.indexOf('## CSS'));
  });

  it('orders tools within a category by `order`, matching the homepage listing', () => {
    const output = render({
      tools: [
        tool({ slug: 'xml-formatter', title: 'XML Formatter', order: 2 }),
        tool({ slug: 'json-formatter', title: 'JSON Formatter', order: 1 }),
      ],
    });

    expect(output.indexOf('JSON Formatter')).toBeLessThan(output.indexOf('XML Formatter'));
  });

  it('falls back to slug order when two tools share an `order`, so output is stable', () => {
    const tools = [
      tool({ slug: 'zzz-tool', title: 'Zzz', order: 5 }),
      tool({ slug: 'aaa-tool', title: 'Aaa', order: 5 }),
    ];

    expect(render({ tools })).toBe(render({ tools: [...tools].reverse() }));
  });

  it('omits categories that have no tools rather than emitting an empty heading', () => {
    const output = render({ tools: [tool({ category: 'Format' })] });

    expect(output).toContain('## Format');
    expect(output).not.toContain('## Images');
  });

  it('renders optional pages in their own trailing section', () => {
    const output = render({
      optionalPages: [{ path: '/about/', title: 'About', summary: 'What this site is.' }],
    });

    expect(output).toContain('## Optional\n\n- [About](https://devmicrotools.com/about/): What this site is.');
    expect(output.indexOf('## Optional')).toBeGreaterThan(output.indexOf('## Format'));
  });

  it('drops the Optional section entirely when there are no optional pages', () => {
    expect(render()).not.toContain('## Optional');
  });

  it('collapses newlines and indentation in prose so every list row stays one line', () => {
    // Notes are written as indented template literals in the endpoint; unflattened, a
    // wrapped summary would break the Markdown list it sits in.
    const output = render({
      notes: ['A note\n       that wraps in source.'],
      tools: [tool({ summary: 'Format\nJSON.' })],
    });

    expect(output).toContain('A note that wraps in source.');
    expect(output).toContain('/json-formatter/): Format JSON.\n');
  });

  it('handles an empty tool set without producing a malformed document', () => {
    const output = render({ tools: [] });

    expect(output).toBe('# DevMicroTools\n\n> Free developer utilities that run in your browser.\n');
    expect(output).not.toContain('##');
  });

  it('separates every block by exactly one blank line and ends with a newline', () => {
    const output = render({ notes: ['A note.'], optionalPages: [{ path: '/about/', title: 'About', summary: 'X.' }] });

    expect(output.endsWith('\n')).toBe(true);
    expect(output).not.toMatch(/\n{3}/);
  });

  it('keeps non-ASCII punctuation intact for the UTF-8 response', () => {
    expect(render({ tools: [tool({ summary: 'Encode — and decode — Base64.' })] })).toContain('— and decode —');
  });
});
