import { describe, it, expect } from 'vitest';
import { parseJson, formatJson, minifyJson, sortJsonKeys, analyseJson } from './json';

describe('parseJson', () => {
  it('parses valid JSON', () => {
    const result = parseJson('{"a":1}');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects empty input with a helpful message', () => {
    const result = parseJson('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing to parse/i);
  });

  it('reports malformed JSON rather than throwing', () => {
    const result = parseJson('{"a": }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('parses top-level scalars and null', () => {
    expect(parseJson('42')).toEqual({ ok: true, value: 42 });
    expect(parseJson('null')).toEqual({ ok: true, value: null });
    expect(parseJson('"text"')).toEqual({ ok: true, value: 'text' });
  });
});

describe('formatJson', () => {
  it('pretty-prints with two spaces by default', () => {
    const result = formatJson('{"a":1}');
    expect(result).toEqual({ ok: true, value: '{\n  "a": 1\n}' });
  });

  it('honours four-space indentation', () => {
    const result = formatJson('{"a":1}', 4);
    expect(result).toEqual({ ok: true, value: '{\n    "a": 1\n}' });
  });

  it('honours tab indentation', () => {
    const result = formatJson('{"a":1}', 'tab');
    expect(result).toEqual({ ok: true, value: '{\n\t"a": 1\n}' });
  });

  it('propagates parse errors', () => {
    expect(formatJson('not json').ok).toBe(false);
  });

  it('preserves Unicode content', () => {
    const result = formatJson('{"emoji":"🎉","cjk":"日本語"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('🎉');
      expect(result.value).toContain('日本語');
    }
  });
});

describe('minifyJson', () => {
  it('removes insignificant whitespace', () => {
    const result = minifyJson('{\n  "a": [1, 2]\n}');
    expect(result).toEqual({ ok: true, value: '{"a":[1,2]}' });
  });
});

describe('sortJsonKeys', () => {
  it('sorts object keys alphabetically', () => {
    const result = sortJsonKeys('{"b":1,"a":2}');
    expect(result).toEqual({ ok: true, value: '{\n  "a": 2,\n  "b": 1\n}' });
  });

  it('sorts nested objects too', () => {
    const result = sortJsonKeys('{"z":{"y":1,"x":2}}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.indexOf('"x"')).toBeLessThan(result.value.indexOf('"y"'));
  });

  it('preserves array order, because array order is data', () => {
    const result = sortJsonKeys('{"list":[3,1,2]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('3,\n    1,\n    2');
  });

  it('does not treat null as an object', () => {
    expect(sortJsonKeys('{"a":null}')).toEqual({ ok: true, value: '{\n  "a": null\n}' });
  });
});

describe('analyseJson', () => {
  it('counts keys, depth and nodes for a nested object', () => {
    const stats = analyseJson({ a: { b: { c: 1 } } });
    expect(stats.keys).toBe(3);
    expect(stats.depth).toBe(3);
  });

  it('reports depth 0 for a scalar', () => {
    expect(analyseJson(42)).toEqual({ keys: 0, depth: 0, nodes: 1 });
  });

  it('counts array nesting', () => {
    const stats = analyseJson([[1, 2]]);
    expect(stats.depth).toBe(2);
    expect(stats.keys).toBe(0);
  });

  it('handles null without treating it as an object', () => {
    expect(analyseJson(null)).toEqual({ keys: 0, depth: 0, nodes: 1 });
  });
});
