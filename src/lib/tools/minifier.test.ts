import { describe, it, expect } from 'vitest';
import { minifyCode, minifyCss, minifyHtml, MAX_INPUT_LENGTH } from './minifier';

describe('minifyCss', () => {
  it('strips comments and collapses whitespace', () => {
    const out = minifyCss('/* header */\n.a,\n.b {\n  color: red;\n  margin: 0 10px;\n}\n');
    expect(out).not.toContain('/*');
    expect(out).not.toContain('\n');
    expect(out).toBe('.a,.b{color:red;margin:0 10px}');
  });

  it('removes a trailing semicolon before a closing brace', () => {
    expect(minifyCss('.a { color: red; }')).toBe('.a{color:red}');
  });

  it('preserves the single required space around a calc() operator', () => {
    const out = minifyCss('.a {\n  width: calc(100% - 10px);\n}');
    expect(out).toContain('calc(100% - 10px)');
  });

  it('preserves the single required space in an :nth-child() argument', () => {
    const out = minifyCss('li:nth-child(2n + 1) {\n  color: blue;\n}');
    expect(out).toContain('nth-child(2n + 1)');
  });

  it('preserves whitespace and comment-like text inside string values verbatim', () => {
    const out = minifyCss('.a {\n  content: "  /* not a comment */  ";\n}');
    expect(out).toContain('"  /* not a comment */  "');
  });

  it('keeps the descendant-combinator space between selectors', () => {
    const out = minifyCss('.a .b {\n  color: red;\n}');
    expect(out).toContain('.a .b{');
  });

  it('handles an empty stylesheet without error', () => {
    expect(minifyCss('')).toBe('');
  });

  it('preserves unicode content', () => {
    const out = minifyCss(".a::before { content: '日本語 😀'; }");
    expect(out).toContain('日本語 😀');
  });
});

describe('minifyHtml', () => {
  it('strips comments and collapses whitespace between tags', () => {
    const out = minifyHtml('<!-- top --><div>\n  <p>Hi</p>\n</div>');
    expect(out).not.toContain('<!--');
    expect(out).toBe('<div> <p>Hi</p> </div>');
  });

  it('never collapses inter-element whitespace to nothing, to avoid merging inline text', () => {
    const out = minifyHtml('<span>A</span>\n<span>B</span>');
    expect(out).toBe('<span>A</span> <span>B</span>');
  });

  it('leaves <pre> content untouched, including internal whitespace', () => {
    const out = minifyHtml('<pre>  line one\n\n  line two  </pre>');
    expect(out).toContain('<pre>  line one\n\n  line two  </pre>');
  });

  it('leaves <script> content untouched, including comments and template literals', () => {
    const out = minifyHtml('<script>\n  // keep me\n  const s = `a\n  b`;\n</script>');
    expect(out).toContain('// keep me');
    expect(out).toContain('const s = `a\n  b`;');
  });

  it('leaves <textarea> content untouched', () => {
    const out = minifyHtml('<textarea>  spaced   text  </textarea>');
    expect(out).toContain('<textarea>  spaced   text  </textarea>');
  });

  it('preserves a leading doctype', () => {
    const out = minifyHtml('<!DOCTYPE html>\n<html>\n</html>');
    expect(out.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it('preserves unicode text content', () => {
    const out = minifyHtml('<p>日本語 😀</p>');
    expect(out).toContain('日本語 😀');
  });

  it('handles empty input without error', () => {
    expect(minifyHtml('')).toBe('');
  });
});

describe('minifyCode (JS via Terser)', () => {
  it('minifies valid JavaScript to a shorter, functionally equivalent form', async () => {
    const result = await minifyCode('function add(a, b) {\n  return a + b;\n}\n\nwindow.__result = add(2, 3);', 'js');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeLessThan(60);

    (window as unknown as { __result?: number }).__result = undefined;
    new Function(result.value)();
    expect((window as unknown as { __result?: number }).__result).toBe(5);
  });

  it('preserves unicode string content through minification', async () => {
    const result = await minifyCode('const s = "日本語 😀"; window.__s = s;', 'js');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    new Function(result.value)();
    expect((window as unknown as { __s?: string }).__s).toBe('日本語 😀');
  });

  it('reports a syntax error with a short, human-readable message', async () => {
    const result = await minifyCode('function broken( { return; }', 'js');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/could not minify this javascript/i);
    expect(result.error.length).toBeLessThan(200);
  });

  it('rejects empty input', async () => {
    const result = await minifyCode('   ', 'js');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/enter some javascript/i);
  });

  it('rejects input past the size limit', async () => {
    const huge = `const a = "${'x'.repeat(MAX_INPUT_LENGTH)}";`;
    const result = await minifyCode(huge, 'js');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });
});

describe('minifyCode dispatch', () => {
  it('routes to the CSS minifier', async () => {
    const result = await minifyCode('.a { color: red; }', 'css');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('.a{color:red}');
  });

  it('routes to the HTML minifier', async () => {
    const result = await minifyCode('<div>\n  Hi\n</div>', 'html');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('<div> Hi </div>');
  });

  it('rejects empty input for each language with a language-specific message', async () => {
    const html = await minifyCode('', 'html');
    const css = await minifyCode('', 'css');
    expect(html.ok).toBe(false);
    expect(css.ok).toBe(false);
    if (html.ok || css.ok) return;
    expect(html.error).toMatch(/html/i);
    expect(css.error).toMatch(/css/i);
  });
});
