import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OUTPUT_NAME,
  MAX_MERGE_FILES,
  MAX_MERGE_TOTAL_BYTES,
  MAX_SELECTED_PAGES,
  baseName,
  batchRoom,
  describeSelection,
  moveItem,
  nextRotation,
  normalizeOutputName,
  parsePageRanges,
  plural,
  sortByName,
} from './pdfMerge';

const pages = (input: string, count: number) => {
  const result = parsePageRanges(input, count);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.value.map((index) => index + 1);
};

const rangeError = (input: string, count: number) => {
  const result = parsePageRanges(input, count);
  if (result.ok) throw new Error(`expected an error for "${input}"`);
  return result.error;
};

describe('parsePageRanges', () => {
  it('selects every page for empty input or "all"', () => {
    expect(pages('', 3)).toEqual([1, 2, 3]);
    expect(pages('   ', 3)).toEqual([1, 2, 3]);
    expect(pages('ALL', 2)).toEqual([1, 2]);
  });

  it('parses single pages and inclusive ranges in the order typed', () => {
    expect(pages('1-3, 5', 6)).toEqual([1, 2, 3, 5]);
    expect(pages('5, 1-2', 6)).toEqual([5, 1, 2]);
  });

  it('supports open-ended, reversed and repeated ranges', () => {
    expect(pages('4-', 6)).toEqual([4, 5, 6]);
    expect(pages('-2', 6)).toEqual([1, 2]);
    expect(pages('3-1', 6)).toEqual([3, 2, 1]);
    expect(pages('1,1,2', 6)).toEqual([1, 1, 2]);
  });

  it('supports odd and even', () => {
    expect(pages('odd', 5)).toEqual([1, 3, 5]);
    expect(pages('even', 5)).toEqual([2, 4]);
    expect(pages('odd even', 4)).toEqual([1, 3, 2, 4]);
  });

  it('tolerates spaces, semicolons, en/em dashes and stray separators', () => {
    expect(pages(' 1 - 2 ; 4 ', 6)).toEqual([1, 2, 4]);
    expect(pages('1–3', 6)).toEqual([1, 2, 3]);
    expect(pages('2—3,', 6)).toEqual([2, 3]);
    expect(pages(',,1,,', 6)).toEqual([1]);
    expect(pages('1 3 5', 6)).toEqual([1, 3, 5]);
  });

  it('explains pages that do not exist', () => {
    expect(rangeError('7', 6)).toMatch(/Page 7 doesn’t exist — this file has 6 pages/);
    expect(rangeError('2', 1)).toMatch(/this file has 1 page\b/);
    expect(rangeError('0', 6)).toMatch(/numbered from 1/);
    expect(rangeError('2-9', 6)).toMatch(/Page 9 .* \(in “2-9”\)/);
  });

  it('explains malformed input', () => {
    expect(rangeError('abc', 6)).toMatch(/“abc” isn’t a page number or range/);
    expect(rangeError('1-2-3', 6)).toMatch(/isn’t a page number/);
    expect(rangeError('-', 6)).toMatch(/isn’t a page number/);
    expect(rangeError('1.5', 6)).toMatch(/isn’t a page number/);
    expect(rangeError('٣', 6)).toMatch(/isn’t a page number/);
  });

  it('rejects a selection that is empty or absurdly large', () => {
    expect(rangeError('even', 1)).toMatch(/no pages/);
    const huge = Array.from({ length: 30 }, () => '1-500').join(',');
    expect(rangeError(huge, 500)).toMatch(new RegExp(`more than ${MAX_SELECTED_PAGES.toLocaleString('en-US')}`));
  });
});

describe('describeSelection', () => {
  it('describes all, some, repeated and single-page selections', () => {
    expect(describeSelection([0, 1, 2], 3)).toBe('All 3 pages');
    expect(describeSelection([0], 1)).toBe('The only page');
    expect(describeSelection([0, 2], 3)).toBe('2 of 3 pages');
    expect(describeSelection([2, 1, 0], 3)).toBe('3 of 3 pages');
    expect(describeSelection([0, 0, 1], 3)).toBe('3 pages (2 distinct, some repeated)');
  });
});

describe('moveItem', () => {
  it('moves an item up or down without mutating the input', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores out-of-range and no-op moves', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

describe('sortByName', () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));
  const byName = (item: { name: string }) => item.name;

  it('sorts naturally, so 2 comes before 10, case-insensitively', () => {
    expect(sortByName(named('scan 10.pdf', 'Scan 2.pdf', 'scan 1.pdf'), byName).map((item) => item.name)).toEqual(['scan 1.pdf', 'Scan 2.pdf', 'scan 10.pdf']);
  });

  it('sorts descending, keeps ties in their original order, and handles Unicode names', () => {
    expect(sortByName(named('a.pdf', 'c.pdf', 'b.pdf'), byName, 'desc').map((item) => item.name)).toEqual(['c.pdf', 'b.pdf', 'a.pdf']);
    const ties = [
      { name: 'same.pdf', id: 1 },
      { name: 'SAME.pdf', id: 2 },
    ];
    expect(sortByName(ties, byName).map((item) => item.id)).toEqual([1, 2]);
    expect(sortByName(named('Été.pdf', 'avril.pdf', '📄.pdf'), byName).map((item) => item.name)[0]).toBe('📄.pdf');
  });
});

describe('normalizeOutputName', () => {
  it('adds .pdf and keeps a sensible name as typed', () => {
    expect(normalizeOutputName('Board pack')).toBe('Board pack.pdf');
    expect(normalizeOutputName('board-pack.PDF')).toBe('board-pack.pdf');
    expect(normalizeOutputName('résumé 📄')).toBe('résumé 📄.pdf');
  });

  it('strips path separators, forbidden characters and trailing dots', () => {
    expect(normalizeOutputName('../reports/q3:final?.pdf')).toBe('reports q3 final.pdf');
    expect(normalizeOutputName('notes...')).toBe('notes.pdf');
    expect(normalizeOutputName('a\u0000b')).toBe('a b.pdf');
  });

  it('falls back to the default for empty or unusable names, and caps the length', () => {
    expect(normalizeOutputName('')).toBe(DEFAULT_OUTPUT_NAME);
    expect(normalizeOutputName('  ///  ')).toBe(DEFAULT_OUTPUT_NAME);
    expect(normalizeOutputName('.pdf')).toBe(DEFAULT_OUTPUT_NAME);
    expect(normalizeOutputName('x'.repeat(500))).toBe(`${'x'.repeat(200)}.pdf`);
  });
});

describe('batchRoom', () => {
  it('accepts files that fit', () => {
    expect(batchRoom({ count: 0, bytes: 0 }, [100, 200])).toEqual({ accepted: 2, error: null });
  });

  it('stops at the file-count cap and says how many were left out', () => {
    const result = batchRoom({ count: MAX_MERGE_FILES - 1, bytes: 0 }, [1, 1, 1]);
    expect(result.accepted).toBe(1);
    expect(result.error).toMatch(/up to 50 files.*2 files weren’t added/);
    expect(batchRoom({ count: MAX_MERGE_FILES - 1, bytes: 0 }, [1, 1]).error).toMatch(/1 file wasn’t added/);
  });

  it('stops at the total-size cap', () => {
    const result = batchRoom({ count: 1, bytes: MAX_MERGE_TOTAL_BYTES - 10 }, [5, 10]);
    expect(result.accepted).toBe(1);
    expect(result.error).toMatch(/250 MB in total — 1 file wasn’t added/);
  });
});

describe('small helpers', () => {
  it('cycles rotation clockwise through the four right angles', () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(180)).toBe(270);
    expect(nextRotation(270)).toBe(0);
  });

  it('strips .pdf for bookmark titles but never returns an empty name', () => {
    expect(baseName('Chapter 1.PDF')).toBe('Chapter 1');
    expect(baseName('notes.pdf.pdf')).toBe('notes.pdf');
    expect(baseName('.pdf')).toBe('.pdf');
  });

  it('pluralises with thousands separators', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(1200, 'page')).toBe('1,200 pages');
  });
});
