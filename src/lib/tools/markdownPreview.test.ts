import { describe, it, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown, MAX_INPUT_LENGTH } from './markdownPreview';

describe('markdownToHtml', () => {
  it('renders basic Markdown to HTML', async () => {
    const result = await markdownToHtml('# Hello\n\nSome **bold** text.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('<h1>Hello</h1>');
    expect(result.value).toContain('<strong>bold</strong>');
  });

  it('renders GFM tables, strikethrough and task lists', async () => {
    const input = [
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '~~gone~~',
      '',
      '- [x] done',
      '- [ ] todo',
    ].join('\n');
    const result = await markdownToHtml(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('<table>');
    expect(result.value).toContain('<del>gone</del>');
    expect(result.value).toContain('type="checkbox"');
  });

  it('keeps single newlines as separate text by default (breaks off)', async () => {
    const result = await markdownToHtml('line one\nline two');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('<br');
  });

  it('converts a single newline to <br> when breaks is enabled', async () => {
    const result = await markdownToHtml('line one\nline two', { breaks: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('<br');
  });

  it('strips a script tag embedded in raw HTML instead of passing it through', async () => {
    const result = await markdownToHtml('Hello <script>alert(1)</script> world');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('<script');
    expect(result.value).not.toContain('alert(1)');
  });

  it('strips an inline event-handler attribute from raw HTML', async () => {
    const result = await markdownToHtml('<img src="x.png" onerror="alert(1)">');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('onerror');
  });

  it('preserves unicode and emoji', async () => {
    const result = await markdownToHtml('# 日本語 emoji 😀');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('日本語 emoji 😀');
  });

  it('rejects empty input', async () => {
    const result = await markdownToHtml('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/enter some markdown/i);
  });

  it('rejects input past the size limit', async () => {
    const huge = '#'.repeat(MAX_INPUT_LENGTH + 1);
    const result = await markdownToHtml(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });
});

describe('htmlToMarkdown', () => {
  it('converts basic HTML to Markdown', async () => {
    const result = await htmlToMarkdown('<h1>Hello</h1><p>Some <strong>bold</strong> text.</p>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('# Hello');
    expect(result.value).toContain('**bold**');
  });

  it('converts a GFM table', async () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const result = await htmlToMarkdown(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('| A | B |');
    expect(result.value).toContain('| 1 | 2 |');
  });

  it('uses ATX-style headings by default', async () => {
    const result = await htmlToMarkdown('<h2>Section</h2>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('## Section');
  });

  it('uses setext-style headings when requested (h1/h2 only)', async () => {
    const result = await htmlToMarkdown('<h1>Title</h1>', {
      headingStyle: 'setext',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('Title\n=====');
  });

  it('uses the requested bullet list marker', async () => {
    const result = await htmlToMarkdown('<ul><li>one</li><li>two</li></ul>', {
      headingStyle: 'atx',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('*   one');
  });

  it('fences code blocks by default', async () => {
    const result = await htmlToMarkdown('<pre><code>const a = 1;</code></pre>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('```');
  });

  it('never executes an embedded script — the tag is simply dropped from the output', async () => {
    const result = await htmlToMarkdown('<p>Hello</p><script>alert(1)</script>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toContain('alert(1)');
    expect(result.value).toContain('Hello');
  });

  it('preserves unicode and emoji', async () => {
    const result = await htmlToMarkdown('<h1>日本語 emoji 😀</h1>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('日本語 emoji 😀');
  });

  it('rejects empty input', async () => {
    const result = await htmlToMarkdown('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/enter some html/i);
  });

  it('rejects input past the size limit', async () => {
    const huge = `<p>${'a'.repeat(MAX_INPUT_LENGTH)}</p>`;
    const result = await htmlToMarkdown(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });
});
