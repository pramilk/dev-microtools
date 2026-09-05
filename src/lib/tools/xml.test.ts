import { describe, it, expect } from 'vitest';
import { formatXml, minifyXml, validateXml, xmlToJson, jsonValueToXml, MAX_INPUT_LENGTH } from './xml';

describe('DOMParser environment sanity', () => {
  it('is available in this test environment', () => {
    expect(typeof DOMParser).toBe('function');
    expect(typeof XMLSerializer).toBe('function');
  });
});

describe('formatXml', () => {
  it('rejects empty input', () => {
    expect(formatXml('')).toEqual({ ok: false, error: expect.stringMatching(/enter some xml/i) });
    expect(formatXml('   ')).toEqual({ ok: false, error: expect.stringMatching(/enter some xml/i) });
  });

  it('pretty-prints a simple nested document with default 2-space indent', () => {
    const result = formatXml('<root><a>1</a><b>2</b></root>');
    expect(result).toEqual({
      ok: true,
      value: '<root>\n  <a>1</a>\n  <b>2</b>\n</root>',
    });
  });

  it('respects a custom indent size', () => {
    const result = formatXml('<root><a>1</a></root>', 4);
    expect(result).toEqual({ ok: true, value: '<root>\n    <a>1</a>\n</root>' });
  });

  it('indents with a tab when the tab indent style is requested', () => {
    const result = formatXml('<root><a>1</a></root>', 'tab');
    expect(result).toEqual({ ok: true, value: '<root>\n\t<a>1</a>\n</root>' });
  });

  it('applies the requested indent at every nesting depth, not just the first', () => {
    const result = formatXml('<root><a><b>1</b></a></root>', 'tab');
    expect(result).toEqual({ ok: true, value: '<root>\n\t<a>\n\t\t<b>1</b>\n\t</a>\n</root>' });
  });

  it('keeps a text-only leaf element on one line rather than splitting it', () => {
    const result = formatXml('<root><name>Alice</name></root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('<name>Alice</name>');
  });

  it('self-closes a genuinely empty element', () => {
    const result = formatXml('<root><br></br></root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('<br/>');
  });

  it('preserves attributes and their order', () => {
    const result = formatXml('<user id="1" role="admin" active="true"/>');
    expect(result).toEqual({ ok: true, value: '<user id="1" role="admin" active="true"/>' });
  });

  it('preserves a comment', () => {
    const result = formatXml('<root><!-- note --><a>1</a></root>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('<!-- note -->');
      expect(result.value).toContain('<a>1</a>');
    }
  });

  it('preserves a CDATA section verbatim, without escaping its content', () => {
    const result = formatXml('<root><script><![CDATA[if (a < b && c) {}]]></script></root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('<![CDATA[if (a < b && c) {}]]>');
  });

  it('preserves an XML declaration at the top', () => {
    const result = formatXml('<?xml version="1.0" encoding="UTF-8"?>\n<root><a>1</a></root>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
      expect(result.value).toContain('<a>1</a>');
    }
  });

  it('preserves a DOCTYPE', () => {
    const result = formatXml('<!DOCTYPE root SYSTEM "root.dtd"><root><a>1</a></root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('<!DOCTYPE root SYSTEM "root.dtd">');
  });

  it('groups repeated sibling elements one per line without merging them', () => {
    const result = formatXml('<items><item>1</item><item>2</item><item>3</item></items>');
    expect(result).toEqual({
      ok: true,
      value: '<items>\n  <item>1</item>\n  <item>2</item>\n  <item>3</item>\n</items>',
    });
  });

  it('preserves Unicode text content', () => {
    const result = formatXml('<root><greeting>héllo wörld 你好 🎉</greeting></root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('<greeting>héllo wörld 你好 🎉</greeting>');
  });

  it('rejects malformed XML (unclosed tag) with a clear, non-crashing error', () => {
    const result = formatXml('<root><a>1</a>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not well-formed/i);
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects input over the size limit', () => {
    const huge = `<root>${'a'.repeat(MAX_INPUT_LENGTH + 1)}</root>`;
    const result = formatXml(huge);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/too large/i) });
  });

  it('formats a reasonably large document without excessive slowness', () => {
    const items = Array.from({ length: 5000 }, (_, i) => `<item id="${i}"><name>Item ${i}</name></item>`).join('');
    const start = Date.now();
    const result = formatXml(`<items>${items}</items>`);
    expect(result.ok).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe('minifyXml', () => {
  it('rejects empty input', () => {
    expect(minifyXml('')).toEqual({ ok: false, error: expect.stringMatching(/enter some xml/i) });
  });

  it('removes whitespace-only text nodes between tags', () => {
    const result = minifyXml('<root>\n  <a>1</a>\n  <b>2</b>\n</root>\n');
    expect(result).toEqual({ ok: true, value: '<root><a>1</a><b>2</b></root>' });
  });

  it('round-trips a simple document without losing data', () => {
    const formatted = formatXml('<root><a>1</a><b>2</b></root>');
    const minified = minifyXml('<root><a>1</a><b>2</b></root>');
    expect(formatted.ok && minified.ok).toBe(true);
    if (formatted.ok && minified.ok) {
      expect(xmlToJson(formatted.value)).toEqual(xmlToJson(minified.value));
    }
  });

  it('never touches meaningful text content, even if it looks like whitespace padding', () => {
    const result = minifyXml('<root><note>  keep this spacing  </note></root>');
    expect(result).toEqual({ ok: true, value: '<root><note>  keep this spacing  </note></root>' });
  });

  it('never touches CDATA section content', () => {
    const result = minifyXml('<root>\n  <script><![CDATA[  if (a < b)  {}  ]]></script>\n</root>');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('<![CDATA[  if (a < b)  {}  ]]>');
  });

  it('preserves attributes', () => {
    const result = minifyXml('<user\n  id="1"\n  role="admin"\n/>');
    expect(result).toEqual({ ok: true, value: '<user id="1" role="admin"/>' });
  });

  it('preserves an XML declaration at the top', () => {
    const result = minifyXml('<?xml version="1.0"?>\n<root>\n  <a>1</a>\n</root>');
    expect(result).toEqual({ ok: true, value: '<?xml version="1.0"?><root><a>1</a></root>' });
  });

  it('preserves a comment', () => {
    const result = minifyXml('<root>\n  <!-- note -->\n  <a>1</a>\n</root>');
    expect(result).toEqual({ ok: true, value: '<root><!-- note --><a>1</a></root>' });
  });

  it('rejects malformed XML with a clear, non-crashing error', () => {
    const result = minifyXml('<root><a>1</a>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not well-formed/i);
  });

  it('rejects input over the size limit', () => {
    const huge = `<root>${'a'.repeat(MAX_INPUT_LENGTH + 1)}</root>`;
    expect(minifyXml(huge)).toEqual({ ok: false, error: expect.stringMatching(/too large/i) });
  });
});

describe('validateXml', () => {
  it('rejects empty input with a specific message', () => {
    expect(validateXml('')).toEqual({ ok: false, error: expect.stringMatching(/nothing to validate/i) });
    expect(validateXml('   ')).toEqual({ ok: false, error: expect.stringMatching(/nothing to validate/i) });
  });

  it('accepts well-formed XML', () => {
    expect(validateXml('<root><a>1</a></root>')).toEqual({ ok: true, value: true });
  });

  it('rejects malformed XML (unclosed tag) with the parser error text, not a crash', () => {
    const result = validateXml('<root><a>1</a>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not well-formed/i);
      expect(result.error).not.toMatch(/\[object/i);
    }
  });

  it('rejects a mismatched closing tag', () => {
    const result = validateXml('<root><a>1</b></root>');
    expect(result.ok).toBe(false);
  });

  it('rejects multiple root elements', () => {
    const result = validateXml('<a>1</a><b>2</b>');
    expect(result.ok).toBe(false);
  });

  it('rejects input over the size limit', () => {
    const huge = `<root>${'a'.repeat(MAX_INPUT_LENGTH + 1)}</root>`;
    expect(validateXml(huge)).toEqual({ ok: false, error: expect.stringMatching(/too large/i) });
  });
});

describe('xmlToJson', () => {
  it('rejects empty input', () => {
    expect(xmlToJson('')).toEqual({ ok: false, error: expect.stringMatching(/enter some xml/i) });
  });

  it('wraps the root element as the single top-level key', () => {
    expect(xmlToJson('<root><a>1</a></root>')).toEqual({ ok: true, value: { root: { a: '1' } } });
  });

  it('keeps a plain-text leaf as a string, never coerced to a number or boolean', () => {
    const result = xmlToJson('<root><count>42</count><enabled>true</enabled></root>');
    expect(result).toEqual({ ok: true, value: { root: { count: '42', enabled: 'true' } } });
  });

  it('prefixes attributes with @', () => {
    const result = xmlToJson('<root><a id="1">1</a></root>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ root: { a: { '@id': '1', '#text': '1' } } });
    }
  });

  it('puts text under #text when an element has both attributes and text', () => {
    const result = xmlToJson('<a id="1">hello</a>');
    expect(result).toEqual({ ok: true, value: { a: { '@id': '1', '#text': 'hello' } } });
  });

  it('puts an attribute-only, text-only leaf under just @attr with no #text key', () => {
    const result = xmlToJson('<img src="x.png"/>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const img = (result.value as { img: Record<string, unknown> }).img;
      expect(img).toEqual({ '@src': 'x.png' });
      expect('#text' in img).toBe(false);
    }
  });

  it('collapses a single occurrence of a tag to a plain value, not a 1-element array', () => {
    const result = xmlToJson('<root><item>1</item></root>');
    expect(result).toEqual({ ok: true, value: { root: { item: '1' } } });
  });

  it('groups repeated sibling tags into an array, in document order', () => {
    const result = xmlToJson('<root><item>1</item><item>2</item><item>3</item></root>');
    expect(result).toEqual({ ok: true, value: { root: { item: ['1', '2', '3'] } } });
  });

  it('handles text interleaved with child elements via #text', () => {
    const result = xmlToJson('<a>Hello <b>world</b></a>');
    expect(result).toEqual({ ok: true, value: { a: { '#text': 'Hello', b: 'world' } } });
  });

  it('reads text content out of a CDATA-only leaf', () => {
    const result = xmlToJson('<root><script><![CDATA[if (a < b) {}]]></script></root>');
    expect(result).toEqual({ ok: true, value: { root: { script: 'if (a < b) {}' } } });
  });

  it('preserves Unicode text content', () => {
    const result = xmlToJson('<root><greeting>héllo 你好 🎉</greeting></root>');
    expect(result).toEqual({ ok: true, value: { root: { greeting: 'héllo 你好 🎉' } } });
  });

  it('rejects malformed XML (unclosed tag) with a clear, non-crashing error', () => {
    const result = xmlToJson('<root><a>1</a>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not well-formed/i);
  });

  it('rejects input over the size limit', () => {
    const huge = `<root>${'a'.repeat(MAX_INPUT_LENGTH + 1)}</root>`;
    expect(xmlToJson(huge)).toEqual({ ok: false, error: expect.stringMatching(/too large/i) });
  });
});

describe('jsonValueToXml', () => {
  it('uses a single-key object as the root tag', () => {
    expect(jsonValueToXml({ root: { a: '1' } })).toEqual({ ok: true, value: '<root>\n  <a>1</a>\n</root>' });
  });

  it('round-trips through xmlToJson for a simple document', () => {
    const original = '<root><a>1</a><b>2</b></root>';
    const parsed = xmlToJson(original);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(jsonValueToXml(parsed.value)).toEqual({ ok: true, value: '<root>\n  <a>1</a>\n  <b>2</b>\n</root>' });
  });

  it('round-trips repeated sibling tags back into an array', () => {
    const parsed = xmlToJson('<root><item>1</item><item>2</item><item>3</item></root>');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(jsonValueToXml(parsed.value)).toEqual({
        ok: true,
        value: '<root>\n  <item>1</item>\n  <item>2</item>\n  <item>3</item>\n</root>',
      });
    }
  });

  it('round-trips an @attribute back onto the element', () => {
    const parsed = xmlToJson('<root><a id="1">1</a></root>');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(jsonValueToXml(parsed.value)).toEqual({ ok: true, value: '<root>\n  <a id="1">1</a>\n</root>' });
    }
  });

  it('wraps a top-level array in a <root> of repeated <item> elements', () => {
    expect(jsonValueToXml([{ name: 'Ada' }, { name: 'Grace' }])).toEqual({
      ok: true,
      value: '<root>\n  <item>\n    <name>Ada</name>\n  </item>\n  <item>\n    <name>Grace</name>\n  </item>\n</root>',
    });
  });

  it('wraps a multi-key object in <root>', () => {
    expect(jsonValueToXml({ a: '1', b: '2' })).toEqual({ ok: true, value: '<root>\n  <a>1</a>\n  <b>2</b>\n</root>' });
  });

  it('wraps a bare primitive in <root>', () => {
    expect(jsonValueToXml('hello')).toEqual({ ok: true, value: '<root>hello</root>' });
  });

  it('self-closes an element for a null value', () => {
    expect(jsonValueToXml({ root: { a: null } })).toEqual({ ok: true, value: '<root>\n  <a/>\n</root>' });
  });

  it('sanitises an invalid XML name from a JSON key', () => {
    expect(jsonValueToXml({ 'my key!': '1' })).toEqual({ ok: true, value: '<my_key_>1</my_key_>' });
  });

  it('escapes special characters in text content', () => {
    expect(jsonValueToXml({ root: { a: '<b> & "c"' } })).toEqual({
      ok: true,
      value: '<root>\n  <a>&lt;b&gt; &amp; "c"</a>\n</root>',
    });
  });

  it('respects a custom indent size', () => {
    expect(jsonValueToXml({ root: { a: '1' } }, 4)).toEqual({ ok: true, value: '<root>\n    <a>1</a>\n</root>' });
  });
});
