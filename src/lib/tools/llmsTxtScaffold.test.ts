import { describe, expect, it } from 'vitest';
import {
  buildLlmsTxtScaffold,
  DEFAULT_LLMS_TXT_OPTIONS,
  COMMON_SECTIONS,
  type LlmsTxtScaffoldOptions,
  type ScaffoldLink,
} from './llmsTxtScaffold';

let nextId = 0;
const link = (overrides: Partial<ScaffoldLink> = {}): ScaffoldLink => ({
  id: `l${(nextId += 1)}`,
  section: 'Docs',
  title: 'Quickstart',
  url: '/docs/quickstart',
  description: 'Get running in five minutes.',
  ...overrides,
});

const options = (overrides: Partial<LlmsTxtScaffoldOptions> = {}): LlmsTxtScaffoldOptions => ({
  ...DEFAULT_LLMS_TXT_OPTIONS,
  siteName: 'Example',
  summary: 'An example service.',
  ...overrides,
});

const build = (overrides: Partial<LlmsTxtScaffoldOptions> = {}) => {
  const result = buildLlmsTxtScaffold(options(overrides));
  if (!result.ok) throw new Error(`expected a file, got: ${result.error}`);
  return result.value;
};

describe('buildLlmsTxtScaffold', () => {
  it('renders the minimum valid document: an H1 and a blockquote', () => {
    expect(build()).toBe('# Example\n\n> An example service.\n');
  });

  it('renders notes as paragraphs split on blank lines', () => {
    const text = build({ notes: 'First paragraph.\n\nSecond paragraph.' });
    expect(text).toBe('# Example\n\n> An example service.\n\nFirst paragraph.\n\nSecond paragraph.\n');
  });

  it('folds a hard-wrapped paragraph back onto one line', () => {
    const text = build({ notes: 'A sentence that was\nwrapped by an editor.' });
    expect(text).toContain('A sentence that was wrapped by an editor.');
  });

  it('renders a link row under its section heading', () => {
    const text = build({ links: [link()] });
    expect(text).toContain('## Docs\n\n- [Quickstart](/docs/quickstart): Get running in five minutes.');
  });

  it('makes relative link paths absolute when a site URL is given', () => {
    const text = build({ siteUrl: 'https://example.com', links: [link()] });
    expect(text).toContain('- [Quickstart](https://example.com/docs/quickstart):');
  });

  it('leaves an already-absolute URL alone', () => {
    const text = build({ siteUrl: 'https://example.com', links: [link({ url: 'https://other.test/x' })] });
    expect(text).toContain('(https://other.test/x)');
  });

  it('leaves a relative path alone when there is no site URL to resolve it against', () => {
    expect(build({ links: [link()] })).toContain('(/docs/quickstart)');
  });

  it('groups rows by section in first-appearance order, not alphabetically', () => {
    const text = build({
      links: [
        link({ section: 'Guides', title: 'Guide one', url: '/g1' }),
        link({ section: 'Docs', title: 'Doc one', url: '/d1' }),
        link({ section: 'Guides', title: 'Guide two', url: '/g2' }),
      ],
    });

    expect(text.indexOf('## Guides')).toBeLessThan(text.indexOf('## Docs'));
    const guides = text.slice(text.indexOf('## Guides'), text.indexOf('## Docs'));
    expect(guides).toContain('Guide one');
    expect(guides).toContain('Guide two');
  });

  it('files a row with no section under Docs rather than emitting a bare heading', () => {
    expect(build({ links: [link({ section: '   ' })] })).toContain('## Docs');
  });

  it('omits the ": description" suffix when a row has no description', () => {
    const text = build({ links: [link({ description: '' })] });
    expect(text).toContain('- [Quickstart](/docs/quickstart)\n');
  });

  it('skips entirely blank rows, which is what an unfilled row in the UI looks like', () => {
    const text = build({ links: [link(), link({ title: '', url: '', description: '' })] });
    expect(text.match(/^- /gm)).toHaveLength(1);
  });

  it('keeps a multi-line description on one line so the list stays parseable', () => {
    const text = build({ links: [link({ description: 'Line one\nline two' })] });
    expect(text).toContain(': Line one line two');
    expect(text.match(/^- /gm)).toHaveLength(1);
  });

  it('always ends with exactly one trailing newline', () => {
    const text = build({ links: [link()] });
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('handles a large number of rows without dropping any', () => {
    const links = Array.from({ length: 500 }, (_, index) =>
      link({ title: `Page ${index}`, url: `/p/${index}`, section: `Section ${index % 7}` })
    );
    const text = build({ links });

    expect(text.match(/^- /gm)).toHaveLength(500);
    expect(text.match(/^## /gm)).toHaveLength(7);
  });

  it('carries Unicode through untouched', () => {
    const text = build({ siteName: 'Café — 日本語', summary: 'Sürprise 😀', links: [link({ title: 'Ünïcode' })] });
    expect(text).toContain('# Café — 日本語');
    expect(text).toContain('> Sürprise 😀');
    expect(text).toContain('[Ünïcode]');
  });

  it('offers section suggestions that are all non-empty and unique', () => {
    expect(new Set(COMMON_SECTIONS).size).toBe(COMMON_SECTIONS.length);
    for (const section of COMMON_SECTIONS) expect(section.trim()).not.toBe('');
  });
});

describe('buildLlmsTxtScaffold validation', () => {
  it('requires a site name', () => {
    const result = buildLlmsTxtScaffold(options({ siteName: '  ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('site name');
  });

  it('requires a summary', () => {
    const result = buildLlmsTxtScaffold(options({ summary: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('summary');
  });

  it('rejects a site URL that is not a full absolute URL', () => {
    const result = buildLlmsTxtScaffold(options({ siteUrl: 'example.com' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('absolute');
  });

  it('rejects a non-http site URL', () => {
    const result = buildLlmsTxtScaffold(options({ siteUrl: 'ftp://example.com' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http');
  });

  it('rejects a half-filled row rather than emitting a broken markdown link', () => {
    const missingTitle = buildLlmsTxtScaffold(options({ links: [link({ title: '' })] }));
    expect(missingTitle.ok).toBe(false);
    if (!missingTitle.ok) expect(missingTitle.error).toContain('no title');

    const missingUrl = buildLlmsTxtScaffold(options({ links: [link({ url: '' })] }));
    expect(missingUrl.ok).toBe(false);
    if (!missingUrl.ok) expect(missingUrl.error).toContain('no URL');
  });
});
