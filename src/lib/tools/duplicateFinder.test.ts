import { describe, expect, it } from 'vitest';
import {
  splitItems,
  findDuplicates,
  computeStats,
  removeItems,
  indicesForBulkRemoval,
  toDuplicateHighlightSegments,
  toOriginalHighlightSegments,
  toDuplicateHintSegments,
  describeDuplicateOccurrence,
  itemIndexAtOffset,
  type DuplicateOptions,
} from './duplicateFinder';

const lineOptions: DuplicateOptions = {
  granularity: 'line',
  caseSensitive: true,
  trimWhitespace: false,
  ignoreEmptyLines: false,
};

describe('splitItems', () => {
  it('splits lines and tracks offsets', () => {
    const items = splitItems('apple\nbanana\napple', 'line');
    expect(items.map((i) => i.text)).toEqual(['apple', 'banana', 'apple']);
    expect(items[2]).toEqual({ text: 'apple', start: 13, end: 18 });
  });

  it('returns no items for empty input', () => {
    expect(splitItems('', 'line')).toEqual([]);
    expect(splitItems('', 'sentence')).toEqual([]);
    expect(splitItems('', 'paragraph')).toEqual([]);
  });

  it('splits sentences and trims each to its visible text with correct offsets', () => {
    const text = 'Cat sat. Cat sat! Cat sat?';
    const items = splitItems(text, 'sentence');
    expect(items.map((i) => i.text)).toEqual(['Cat sat.', 'Cat sat!', 'Cat sat?']);
    for (const item of items) {
      expect(text.slice(item.start, item.end)).toBe(item.text);
    }
  });

  it('keeps a trailing sentence fragment with no terminal punctuation', () => {
    const items = splitItems('One. Two', 'sentence');
    expect(items.map((i) => i.text)).toEqual(['One.', 'Two']);
  });

  it('splits paragraphs on blank lines and trims each to its visible text', () => {
    const text = 'First para.\n\nSecond para.\n\n\nThird para.';
    const items = splitItems(text, 'paragraph');
    expect(items.map((i) => i.text)).toEqual(['First para.', 'Second para.', 'Third para.']);
    for (const item of items) {
      expect(text.slice(item.start, item.end)).toBe(item.text);
    }
  });

  it('falls back to one paragraph per line when there is no blank-line separator', () => {
    // Real-world plain text (chat exports, some editors, a browser's plain-text copy of
    // two <p> elements) often separates paragraphs with a single newline instead of a
    // blank line — without the fallback, this would read as one undividable paragraph.
    const text = 'First para.\nSecond para.\nThird para.';
    const items = splitItems(text, 'paragraph');
    expect(items.map((i) => i.text)).toEqual(['First para.', 'Second para.', 'Third para.']);
  });

  it('still uses the blank-line split when at least one blank-line paragraph break exists', () => {
    // Mixed: a real blank-line break plus a single-newline-adjacent paragraph should not
    // trigger the per-line fallback, since the blank-line split already found something.
    const text = 'First para.\n\nSecond para.';
    const items = splitItems(text, 'paragraph');
    expect(items.map((i) => i.text)).toEqual(['First para.', 'Second para.']);
  });

  it('treats a single paragraph with no newlines at all as one paragraph', () => {
    expect(splitItems('Only one paragraph here.', 'paragraph').map((i) => i.text)).toEqual([
      'Only one paragraph here.',
    ]);
  });
});

describe('itemIndexAtOffset', () => {
  const items = splitItems('apple\nbanana\ncherry', 'line');

  it('finds the item containing a given offset', () => {
    expect(itemIndexAtOffset(items, 0)).toBe(0);
    expect(itemIndexAtOffset(items, 8)).toBe(1); // inside "banana"
    expect(itemIndexAtOffset(items, 15)).toBe(2); // inside "cherry"
  });

  it('returns -1 for an offset past the end or when there are no items', () => {
    expect(itemIndexAtOffset(items, 999)).toBe(-1);
    expect(itemIndexAtOffset([], 0)).toBe(-1);
  });
});

describe('findDuplicates', () => {
  it('flags no duplicates when every line is unique', () => {
    const occurrences = findDuplicates('apple\nbanana\ncherry', lineOptions);
    expect(occurrences.every((o) => !o.isDuplicate)).toBe(true);
  });

  it('flags every occurrence after the first as a duplicate', () => {
    const occurrences = findDuplicates('apple\nbanana\napple\napple', lineOptions);
    expect(occurrences.map((o) => o.isDuplicate)).toEqual([false, false, true, true]);
    expect(occurrences.map((o) => o.occurrenceNumber)).toEqual([1, 1, 2, 3]);
  });

  it('treats input as case-sensitive when caseSensitive is true', () => {
    const occurrences = findDuplicates('Apple\napple', { ...lineOptions, caseSensitive: true });
    expect(occurrences.every((o) => !o.isDuplicate)).toBe(true);
  });

  it('treats input as case-insensitive when caseSensitive is false', () => {
    const occurrences = findDuplicates('Apple\napple', { ...lineOptions, caseSensitive: false });
    expect(occurrences[1]!.isDuplicate).toBe(true);
  });

  it('ignores leading/trailing whitespace when trimWhitespace is true', () => {
    const occurrences = findDuplicates('apple\n  apple  ', { ...lineOptions, trimWhitespace: true });
    expect(occurrences[1]!.isDuplicate).toBe(true);
  });

  it('treats differently-whitespaced lines as distinct when trimWhitespace is false', () => {
    const occurrences = findDuplicates('apple\n  apple  ', { ...lineOptions, trimWhitespace: false });
    expect(occurrences[1]!.isDuplicate).toBe(false);
  });

  it('excludes blank lines entirely when ignoreEmptyLines is true', () => {
    const occurrences = findDuplicates('apple\n\n\nbanana', { ...lineOptions, ignoreEmptyLines: true });
    expect(occurrences).toHaveLength(2);
    expect(occurrences.every((o) => !o.isDuplicate)).toBe(true);
  });

  it('treats blank lines as duplicates of each other when ignoreEmptyLines is false', () => {
    const occurrences = findDuplicates('apple\n\n\nbanana', { ...lineOptions, ignoreEmptyLines: false });
    expect(occurrences).toHaveLength(4);
    expect(occurrences[2]!.isDuplicate).toBe(true);
  });

  it('returns an empty array for empty input', () => {
    expect(findDuplicates('', lineOptions)).toEqual([]);
  });

  it('handles Unicode text without throwing', () => {
    const occurrences = findDuplicates('café\nnaïve\ncafé', lineOptions);
    expect(occurrences[2]!.isDuplicate).toBe(true);
  });

  it('handles very large input without throwing', () => {
    const large = Array.from({ length: 50000 }, (_, i) => `line ${i % 100}`).join('\n');
    expect(() => findDuplicates(large, lineOptions)).not.toThrow();
    const occurrences = findDuplicates(large, lineOptions);
    expect(occurrences.filter((o) => o.isDuplicate)).toHaveLength(49900);
  });

  it('reports the physical line number of each occurrence', () => {
    const occurrences = findDuplicates('apple\nbanana\napple', lineOptions);
    expect(occurrences.map((o) => o.line)).toEqual([1, 2, 3]);
  });

  it('flags hasDuplicates on every occurrence of a repeated key, including the first', () => {
    const occurrences = findDuplicates('apple\nbanana\napple', lineOptions);
    expect(occurrences.map((o) => o.hasDuplicates)).toEqual([true, false, true]);
  });

  it('cross-references every occurrence with every other line sharing its key', () => {
    const occurrences = findDuplicates('apple\nbanana\napple\napple', lineOptions);
    expect(occurrences[0]!.relatedLines).toEqual([3, 4]); // first "apple" -> the other two
    expect(occurrences[2]!.relatedLines).toEqual([1, 4]); // second "apple" -> the other two
    expect(occurrences[1]!.relatedLines).toEqual([]); // "banana" is unique
  });

  it('excludes only the occurrence itself from relatedLines when two occurrences share one physical line', () => {
    // Sentence mode: both sentences live on line 1, so relatedLines must be told apart
    // by position in the document, not by line-number equality.
    const occurrences = findDuplicates('Cat sat. Cat sat.', { ...lineOptions, granularity: 'sentence' });
    expect(occurrences.map((o) => o.line)).toEqual([1, 1]);
    expect(occurrences[0]!.relatedLines).toEqual([1]);
    expect(occurrences[1]!.relatedLines).toEqual([1]);
  });
});

describe('computeStats', () => {
  it('computes total, unique and duplicate counts', () => {
    const occurrences = findDuplicates('apple\nbanana\napple\napple', lineOptions);
    expect(computeStats(occurrences)).toEqual({ total: 4, unique: 2, duplicateOccurrences: 2 });
  });

  it('returns all zeros for no occurrences', () => {
    expect(computeStats([])).toEqual({ total: 0, unique: 0, duplicateOccurrences: 0 });
  });
});

describe('removeItems', () => {
  it('removes the given line indices and rejoins with newlines', () => {
    expect(removeItems('apple\nbanana\ncherry', [1], 'line')).toBe('apple\ncherry');
  });

  it('can remove the first occurrence of a repeated item, leaving the rest', () => {
    expect(removeItems('apple\nbanana\napple', [0], 'line')).toBe('banana\napple');
  });

  it('removes every occurrence of an item when all its indices are given', () => {
    expect(removeItems('apple\nbanana\napple', [0, 2], 'line')).toBe('banana');
  });

  it('returns an empty string when every item is removed', () => {
    expect(removeItems('apple\nbanana', [0, 1], 'line')).toBe('');
  });

  it('rejoins sentences with a single space', () => {
    expect(removeItems('One. Two. Three.', [1], 'sentence')).toBe('One. Three.');
  });

  it('rejoins paragraphs with a blank line', () => {
    expect(removeItems('First.\n\nSecond.\n\nThird.', [1], 'paragraph')).toBe('First.\n\nThird.');
  });
});

describe('indicesForBulkRemoval', () => {
  const occurrences = findDuplicates('apple\nbanana\napple\ncherry', lineOptions);

  it('keepFirstOccurrence drops only occurrences after the first', () => {
    expect(indicesForBulkRemoval(occurrences, 'keepFirstOccurrence')).toEqual([2]);
  });

  it('removeAllDuplicates drops every occurrence of a repeated key, including the first', () => {
    expect(indicesForBulkRemoval(occurrences, 'removeAllDuplicates')).toEqual([0, 2]);
  });

  it('returns an empty array when nothing is duplicated', () => {
    const unique = findDuplicates('apple\nbanana\ncherry', lineOptions);
    expect(indicesForBulkRemoval(unique, 'keepFirstOccurrence')).toEqual([]);
    expect(indicesForBulkRemoval(unique, 'removeAllDuplicates')).toEqual([]);
  });
});

describe('toDuplicateHighlightSegments', () => {
  it('marks only duplicate occurrences as matches', () => {
    const text = 'apple\nbanana\napple';
    const occurrences = findDuplicates(text, lineOptions);
    const segments = toDuplicateHighlightSegments(text, occurrences);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.isMatch).map((s) => s.text)).toEqual(['apple']);
  });

  it('returns a single unmatched segment when there are no duplicates', () => {
    const text = 'apple\nbanana';
    const occurrences = findDuplicates(text, lineOptions);
    expect(toDuplicateHighlightSegments(text, occurrences)).toEqual([{ text, isMatch: false }]);
  });
});

describe('toOriginalHighlightSegments', () => {
  it('marks only the first occurrence of a key that has duplicates elsewhere', () => {
    const text = 'apple\nbanana\napple';
    const occurrences = findDuplicates(text, lineOptions);
    const segments = toOriginalHighlightSegments(text, occurrences);
    expect(segments.filter((s) => s.isMatch).map((s) => s.text)).toEqual(['apple']);
  });

  it('does not mark a unique line as an original', () => {
    const text = 'apple\nbanana';
    const occurrences = findDuplicates(text, lineOptions);
    expect(toOriginalHighlightSegments(text, occurrences).some((s) => s.isMatch)).toBe(false);
  });
});

describe('describeDuplicateOccurrence', () => {
  it('describes the original as "Original", listing every other line it repeats at', () => {
    const occurrences = findDuplicates('apple\nbanana\napple\napple', lineOptions);
    expect(describeDuplicateOccurrence(occurrences[0]!)).toBe('Original — line 1, also at lines 3, 4: "apple"');
  });

  it('describes a later copy as "Duplicate"', () => {
    const occurrences = findDuplicates('apple\nbanana\napple', lineOptions);
    expect(describeDuplicateOccurrence(occurrences[2]!)).toBe('Duplicate — line 3, also at line 1: "apple"');
  });

  it('truncates a long sample', () => {
    const long = 'x'.repeat(100);
    const occurrences = findDuplicates(`${long}\n${long}`, lineOptions);
    expect(describeDuplicateOccurrence(occurrences[0]!)).toContain('…"');
  });
});

describe('toDuplicateHintSegments', () => {
  it('carries a hint only on segments involved in a duplicate group', () => {
    const text = 'apple\nbanana\napple';
    const occurrences = findDuplicates(text, lineOptions);
    const segments = toDuplicateHintSegments(text, occurrences);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    const hinted = segments.filter((s) => s.hint !== null);
    expect(hinted).toHaveLength(2); // both "apple" occurrences
    expect(hinted[0]!.hint).toContain('Original');
    expect(hinted[1]!.hint).toContain('Duplicate');
  });

  it('returns a single hint-free segment when nothing is duplicated', () => {
    const text = 'apple\nbanana';
    const occurrences = findDuplicates(text, lineOptions);
    expect(toDuplicateHintSegments(text, occurrences)).toEqual([{ text, hint: null }]);
  });

  it('returns no segments for empty text', () => {
    expect(toDuplicateHintSegments('', [])).toEqual([]);
  });
});
