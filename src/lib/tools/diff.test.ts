import { describe, it, expect } from 'vitest';
import { compareTexts, compareJson } from './diff';

describe('compareTexts', () => {
  it('reports identical texts as identical', async () => {
    const result = await compareTexts('same\ntext', 'same\ntext');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.identical).toBe(true);
      expect(result.value.added).toBe(0);
      expect(result.value.removed).toBe(0);
    }
  });

  it('detects an added line', async () => {
    const result = await compareTexts('a\n', 'a\nb\n');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.identical).toBe(false);
      expect(result.value.added).toBeGreaterThan(0);
    }
  });

  it('detects a removed line', async () => {
    const result = await compareTexts('a\nb\n', 'a\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.removed).toBeGreaterThan(0);
  });

  it('classifies every part as added, removed or unchanged', async () => {
    const result = await compareTexts('a\nb\n', 'a\nc\n');
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const part of result.value.parts) {
        expect(['added', 'removed', 'unchanged']).toContain(part.type);
      }
    }
  });

  it('supports word-level comparison', async () => {
    const result = await compareTexts('the quick fox', 'the slow fox', 'word');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.identical).toBe(false);
      expect(result.value.parts.some((p) => p.type === 'unchanged')).toBe(true);
    }
  });

  it('supports character-level comparison', async () => {
    const result = await compareTexts('cat', 'car', 'char');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(false);
  });

  it('can ignore case', async () => {
    const result = await compareTexts('Hello', 'hello', 'line', { ignoreCase: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(true);
  });

  // `ignoreWhitespace` ignores leading/trailing whitespace per line — i.e. indentation
  // changes — but keeps internal spacing significant. Both halves are pinned here so a
  // library upgrade that changes the semantics is caught.
  it('ignores indentation changes when asked', async () => {
    const result = await compareTexts('    a\n', 'a\n', 'line', { ignoreWhitespace: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(true);
  });

  it('still treats internal whitespace as significant', async () => {
    const result = await compareTexts('a  b', 'a b', 'line', { ignoreWhitespace: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(false);
  });

  it('treats one empty side as a full addition', async () => {
    const result = await compareTexts('', 'new content\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.added).toBeGreaterThan(0);
  });

  it('rejects two empty sides', async () => {
    const result = await compareTexts('', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/both panes/i);
  });
});

describe('compareJson', () => {
  it('treats differently-formatted but equivalent JSON as identical', async () => {
    const result = await compareJson('{"a":1,"b":2}', '{\n  "b": 2,\n  "a": 1\n}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(true);
  });

  it('detects a genuine value change', async () => {
    const result = await compareJson('{"a":1}', '{"a":2}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(false);
  });

  it('detects an added key', async () => {
    const result = await compareJson('{"a":1}', '{"a":1,"b":2}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.added).toBeGreaterThan(0);
  });

  it('does not treat array reordering as equivalent, because order is data', async () => {
    const result = await compareJson('{"a":[1,2]}', '{"a":[2,1]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.identical).toBe(false);
  });

  it('names which side failed to parse', async () => {
    const left = await compareJson('nope', '{"a":1}');
    expect(left.ok).toBe(false);
    if (!left.ok) expect(left.error).toMatch(/left/i);

    const right = await compareJson('{"a":1}', 'nope');
    expect(right.ok).toBe(false);
    if (!right.ok) expect(right.error).toMatch(/right/i);
  });

  it('reports an empty side rather than diffing against nothing', async () => {
    const result = await compareJson('', '{"a":1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });
});
