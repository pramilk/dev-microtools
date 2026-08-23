import { describe, it, expect } from 'vitest';
import { compareTexts, compareJson, toSideBySideRows, type DiffPart } from './diff';

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

describe('toSideBySideRows', () => {
  it('mirrors unchanged lines on both sides with matching line numbers', () => {
    const parts: DiffPart[] = [{ type: 'unchanged', value: 'a\nb\n' }];
    const rows = toSideBySideRows(parts);
    expect(rows).toEqual([
      { left: 'a', right: 'a', leftLine: 1, rightLine: 1, type: 'unchanged' },
      { left: 'b', right: 'b', leftLine: 2, rightLine: 2, type: 'unchanged' },
    ]);
  });

  it('pairs a removed block with a following added block as changed rows', () => {
    const parts: DiffPart[] = [
      { type: 'removed', value: 'old\n' },
      { type: 'added', value: 'new\n' },
    ];
    const rows = toSideBySideRows(parts);
    expect(rows).toEqual([{ left: 'old', right: 'new', leftLine: 1, rightLine: 1, type: 'changed' }]);
  });

  it('pads the shorter side when a changed block has unequal line counts', () => {
    const parts: DiffPart[] = [
      { type: 'removed', value: 'one\ntwo\n' },
      { type: 'added', value: 'one only\n' },
    ];
    const rows = toSideBySideRows(parts);
    expect(rows).toEqual([
      { left: 'one', right: 'one only', leftLine: 1, rightLine: 1, type: 'changed' },
      { left: 'two', right: null, leftLine: 2, rightLine: null, type: 'changed' },
    ]);
  });

  it('renders a pure removal with nothing on the right', () => {
    const parts: DiffPart[] = [{ type: 'removed', value: 'gone\n' }];
    const rows = toSideBySideRows(parts);
    expect(rows).toEqual([{ left: 'gone', right: null, leftLine: 1, rightLine: null, type: 'removed' }]);
  });

  it('renders a pure addition with nothing on the left', () => {
    const parts: DiffPart[] = [{ type: 'added', value: 'fresh\n' }];
    const rows = toSideBySideRows(parts);
    expect(rows).toEqual([{ left: null, right: 'fresh', leftLine: null, rightLine: 1, type: 'added' }]);
  });

  it('keeps left/right line numbers running independently across a mixed sequence', () => {
    const parts: DiffPart[] = [
      { type: 'unchanged', value: 'ctx\n' },
      { type: 'added', value: 'inserted\n' },
      { type: 'unchanged', value: 'tail\n' },
    ];
    const rows = toSideBySideRows(parts);
    expect(rows).toEqual([
      { left: 'ctx', right: 'ctx', leftLine: 1, rightLine: 1, type: 'unchanged' },
      { left: null, right: 'inserted', leftLine: null, rightLine: 2, type: 'added' },
      { left: 'tail', right: 'tail', leftLine: 2, rightLine: 3, type: 'unchanged' },
    ]);
  });

  it('returns nothing for an empty parts list', () => {
    expect(toSideBySideRows([])).toEqual([]);
  });
});
