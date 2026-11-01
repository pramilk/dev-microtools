import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPLIT_SETTINGS,
  MAX_SPLIT_PARTS,
  bookmarkSections,
  chunkPages,
  defaultRangesFor,
  pageRun,
  updatePicked,
  describePages,
  nameRangeParts,
  parseEveryN,
  convertSizeInput,
  parseMaxSize,
  parseSplitRanges,
  planSplit,
  zipNameFor,
  type PdfSplitSettings,
  type PdfSplitSourceInfo,
  type SplitBookmark,
  type SplitPartPlan,
} from './pdfSplit';

const info = (pageCount: number, bookmarks: SplitBookmark[] = []): PdfSplitSourceInfo => ({ pageCount, bookmarks, bookmarkCount: bookmarks.length, formFieldCount: 0, signed: false });
const settings = (patch: Partial<PdfSplitSettings>): PdfSplitSettings => ({ ...DEFAULT_SPLIT_SETTINGS, ...patch });
const valueOf = <T,>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.value;
};
const errorOf = (result: { ok: boolean; error?: string }): string => {
  if (result.ok) throw new Error('expected an error');
  return result.error ?? '';
};
const partsOf = (result: ReturnType<typeof planSplit>): SplitPartPlan[] => {
  const plan = valueOf(result);
  if (plan.kind !== 'parts') throw new Error('expected a parts plan');
  return plan.parts;
};

describe('parseSplitRanges', () => {
  it('makes one part per range, 0-based and in order', () => {
    expect(valueOf(parseSplitRanges('1-3, 4-8, 9-', 10))).toEqual([[0, 1, 2], [3, 4, 5, 6, 7], [8, 9]]);
  });

  it('accepts semicolons, spaces, new lines and dashes with spaces as separators', () => {
    expect(valueOf(parseSplitRanges('1 - 2; 3\n4 – 5 6', 6))).toEqual([[0, 1], [2], [3, 4], [5]]);
  });

  it('joins pieces with + into one part, keeping the typed order', () => {
    expect(valueOf(parseSplitRanges('1-2 + 5, 4+3', 5))).toEqual([[0, 1, 4], [3, 2]]);
  });

  it('supports reversed, open-ended, odd and even ranges', () => {
    expect(valueOf(parseSplitRanges('3-1, -2, 4-, odd, even', 5))).toEqual([[2, 1, 0], [0, 1], [3, 4], [0, 2, 4], [1, 3]]);
  });

  it('ignores stray separators and a lone +', () => {
    expect(valueOf(parseSplitRanges(',, 2 ,+, ', 3))).toEqual([[1]]);
  });

  it('rejects empty input and out-of-range or malformed pages with a helpful message', () => {
    expect(errorOf(parseSplitRanges('   ', 3))).toMatch(/type at least one page range/i);
    expect(errorOf(parseSplitRanges('+', 3))).toMatch(/type at least one page range/i);
    expect(errorOf(parseSplitRanges('1-2, 9', 3))).toMatch(/Page 9 doesn’t exist — this file has 3 pages/);
    expect(errorOf(parseSplitRanges('0', 3))).toMatch(/numbered from 1/);
    expect(errorOf(parseSplitRanges('abc', 3))).toMatch(/“abc” isn’t a page number or range/);
  });

  it('caps the number of parts', () => {
    const many = Array.from({ length: MAX_SPLIT_PARTS + 1 }, () => '1').join(',');
    expect(errorOf(parseSplitRanges(many, 1))).toMatch(/limit is 1,000/);
  });
});

describe('parseEveryN and chunkPages', () => {
  it('parses a whole number of pages', () => {
    expect(valueOf(parseEveryN(' 3 ', 10))).toBe(3);
  });

  it('rejects empty, zero, decimals and words', () => {
    expect(errorOf(parseEveryN('', 10))).toMatch(/how many pages/);
    expect(errorOf(parseEveryN('0', 10))).toMatch(/at least 1 page/);
    expect(errorOf(parseEveryN('2.5', 10))).toMatch(/isn’t a whole number/);
    expect(errorOf(parseEveryN('two', 10))).toMatch(/isn’t a whole number/);
  });

  it('rejects a chunk size that would make too many files', () => {
    expect(errorOf(parseEveryN('1', MAX_SPLIT_PARTS + 1))).toMatch(/1,001\+ files/);
  });

  it('chunks pages, with a shorter last chunk', () => {
    expect(chunkPages(2, 5)).toEqual([[0, 1], [2, 3], [4]]);
    expect(chunkPages(10, 3)).toEqual([[0, 1, 2]]);
    expect(chunkPages(1, 0)).toEqual([]);
  });
});

describe('parseMaxSize', () => {
  it('parses MB into bytes, with a decimal point or comma', () => {
    expect(valueOf(parseMaxSize('10', 'MB'))).toBe(10 * 1024 * 1024);
    expect(valueOf(parseMaxSize('2.5', 'MB'))).toBe(Math.round(2.5 * 1024 * 1024));
    expect(valueOf(parseMaxSize('0,5', 'MB'))).toBe(512 * 1024);
    expect(valueOf(parseMaxSize('.5', 'MB'))).toBe(512 * 1024);
  });

  it('parses KB into bytes', () => {
    expect(valueOf(parseMaxSize('500', 'KB'))).toBe(500 * 1024);
    expect(valueOf(parseMaxSize('50', 'KB'))).toBe(50 * 1024);
    expect(valueOf(parseMaxSize('750.5', 'KB'))).toBe(Math.round(750.5 * 1024));
  });

  it('rejects empty, non-numeric and tiny limits, naming the unit', () => {
    expect(errorOf(parseMaxSize('', 'MB'))).toMatch(/largest size .* in MB/);
    expect(errorOf(parseMaxSize('', 'KB'))).toMatch(/in KB — for example 500/);
    expect(errorOf(parseMaxSize('10mb', 'MB'))).toMatch(/isn’t a size/);
    expect(errorOf(parseMaxSize('-1', 'KB'))).toMatch(/number of KB/);
    expect(errorOf(parseMaxSize('0.01', 'MB'))).toMatch(/at least 50 KB/);
    expect(errorOf(parseMaxSize('49', 'KB'))).toMatch(/at least 50 KB/);
  });
});

describe('convertSizeInput', () => {
  it('keeps the same limit when the unit changes', () => {
    expect(convertSizeInput('5', 'MB', 'KB')).toBe('5120');
    expect(convertSizeInput('5120', 'KB', 'MB')).toBe('5');
    expect(convertSizeInput('500', 'KB', 'MB')).toBe('0.49');
    expect(convertSizeInput('2,5', 'MB', 'KB')).toBe('2560');
  });

  it('leaves text that isn’t a number yet, and same-unit switches, untouched', () => {
    expect(convertSizeInput('abc', 'MB', 'KB')).toBe('abc');
    expect(convertSizeInput('', 'KB', 'MB')).toBe('');
    expect(convertSizeInput(' 5 ', 'MB', 'MB')).toBe(' 5 ');
  });
});

describe('bookmarkSections', () => {
  const bookmarks: SplitBookmark[] = [
    { title: 'Intro', pageIndex: 2, level: 1 },
    { title: 'Intro detail', pageIndex: 3, level: 2 },
    { title: 'Body', pageIndex: 5, level: 1 },
    { title: 'Same page as Body', pageIndex: 5, level: 1 },
  ];

  it('cuts at top-level bookmarks, with the pages before the first as their own section', () => {
    expect(bookmarkSections(bookmarks, 1, 8)).toEqual([
      { title: null, pages: [0, 1] },
      { title: 'Intro', pages: [2, 3, 4] },
      { title: 'Body', pages: [5, 6, 7] },
    ]);
  });

  it('includes deeper levels when asked', () => {
    expect(bookmarkSections(bookmarks, 2, 8).map((section) => section.title)).toEqual([null, 'Intro', 'Intro detail', 'Body']);
  });

  it('takes bookmarks in page order even when the outline lists them out of order', () => {
    const shuffled: SplitBookmark[] = [
      { title: 'B', pageIndex: 3, level: 1 },
      { title: 'A', pageIndex: 0, level: 1 },
    ];
    expect(bookmarkSections(shuffled, 1, 5)).toEqual([
      { title: 'A', pages: [0, 1, 2] },
      { title: 'B', pages: [3, 4] },
    ]);
  });

  it('ignores bookmarks pointing past the last page, and returns nothing when none are usable', () => {
    expect(bookmarkSections([{ title: 'Ghost', pageIndex: 9, level: 1 }], 1, 3)).toEqual([]);
  });
});

describe('describePages', () => {
  it('describes single pages, runs and scattered selections', () => {
    expect(describePages([4])).toBe('Page 5');
    expect(describePages([0, 1, 2])).toBe('Pages 1–3');
    expect(describePages([0, 1, 4])).toBe('Pages 1–2, 5');
    expect(describePages([2, 1, 0])).toBe('Pages 3, 2, 1');
    expect(describePages([0, 2, 4, 6, 8])).toBe('Pages 1, 3, 5, 7, …');
  });
});

describe('nameRangeParts', () => {
  it('names plain runs after their pages and anything else by position', () => {
    expect(nameRangeParts('report', [[0, 1, 2], [4], [5, 7]]).map((part) => part.name)).toEqual(['report-pages-1-3.pdf', 'report-page-5.pdf', 'report-part-03.pdf']);
  });

  it('keeps names unique when the same range appears twice', () => {
    expect(nameRangeParts('r', [[0], [0], [0]]).map((part) => part.name)).toEqual(['r-page-1.pdf', 'r-page-1-2.pdf', 'r-page-1-3.pdf']);
  });
});

describe('planSplit', () => {
  it('plans page ranges with labels and names from the file name', () => {
    expect(partsOf(planSplit(settings({ ranges: '1-2, 3' }), info(3), 'Q3 Report.pdf'))).toEqual([
      { name: 'Q3 Report-pages-1-2.pdf', pages: [0, 1], label: 'Pages 1–2' },
      { name: 'Q3 Report-page-3.pdf', pages: [2], label: 'Page 3' },
    ]);
  });

  it('uses a custom prefix when one is typed, made safe for a file name', () => {
    expect(partsOf(planSplit(settings({ ranges: '1', prefix: 'a/b: c' }), info(1), 'x.pdf'))[0]?.name).toBe('a b c-page-1.pdf');
  });

  it('combines every range into one file when asked', () => {
    expect(partsOf(planSplit(settings({ ranges: '1-2, 5', combine: true }), info(5), 'doc.pdf'))).toEqual([{ name: 'doc-extracted.pdf', pages: [0, 1, 4], label: 'Pages 1–2, 5' }]);
  });

  it('plans fixed-size chunks', () => {
    expect(partsOf(planSplit(settings({ mode: 'every', everyN: '2' }), info(5), 'doc.pdf')).map((part) => part.name)).toEqual([
      'doc-pages-1-2.pdf',
      'doc-pages-3-4.pdf',
      'doc-page-5.pdf',
    ]);
  });

  it('plans bookmark sections, named after numbered, slugified titles', () => {
    const bookmarks: SplitBookmark[] = [
      { title: 'Résumé & Summary', pageIndex: 1, level: 1 },
      { title: '!!!', pageIndex: 2, level: 1 },
    ];
    expect(partsOf(planSplit(settings({ mode: 'bookmarks' }), info(3, bookmarks), 'book.pdf'))).toEqual([
      { name: 'book-01-front-matter.pdf', pages: [0], label: 'Before the first bookmark' },
      { name: 'book-02-Resume-Summary.pdf', pages: [1], label: 'Résumé & Summary' },
      { name: 'book-03-section.pdf', pages: [2], label: '!!!' },
    ]);
  });

  it('explains that a PDF without bookmarks can’t be split by them', () => {
    expect(errorOf(planSplit(settings({ mode: 'bookmarks' }), info(3), 'a.pdf'))).toMatch(/no bookmarks/);
  });

  it('hands size splitting to the worker with the limit and the name prefix', () => {
    expect(valueOf(planSplit(settings({ mode: 'size', maxSize: '1' }), info(3), 'scan.pdf'))).toEqual({ kind: 'size', maxBytes: 1024 * 1024, base: 'scan', pages: [0, 1, 2] });
    expect(errorOf(planSplit(settings({ mode: 'size', maxSize: 'x' }), info(3), 'scan.pdf'))).toMatch(/isn’t a size/);
  });

  it('passes range errors through', () => {
    expect(errorOf(planSplit(settings({ ranges: '4' }), info(3), 'a.pdf'))).toMatch(/Page 4 doesn’t exist/);
  });

  it('copes with a file name that has nothing usable in it', () => {
    expect(partsOf(planSplit(settings({ ranges: '1' }), info(1), '.pdf'))[0]?.name).toBe('document-page-1.pdf');
  });
});

describe('planSplit in "Pick pages" mode', () => {
  it('puts the picked pages, in document order, into one file', () => {
    expect(partsOf(planSplit(settings({ mode: 'pick', pickedPages: [4, 0, 2, 2] }), info(6), 'd.pdf'))).toEqual([{ name: 'd-extracted.pdf', pages: [0, 2, 4], label: 'Pages 1, 3, 5' }]);
  });

  it('can save each picked page as its own file', () => {
    expect(partsOf(planSplit(settings({ mode: 'pick', pickedPages: [3, 1], pickSeparate: true }), info(6), 'd.pdf')).map((part) => part.name)).toEqual(['d-page-2.pdf', 'd-page-4.pdf']);
  });

  it('ignores picks outside the document, and asks for a pick when there are none', () => {
    expect(partsOf(planSplit(settings({ mode: 'pick', pickedPages: [1, 9, -1] }), info(3), 'd.pdf'))[0]?.pages).toEqual([1]);
    expect(errorOf(planSplit(settings({ mode: 'pick', pickedPages: [] }), info(3), 'd.pdf'))).toMatch(/No pages picked yet/);
  });
});

describe('pageRun and updatePicked', () => {
  it('spans a Shift-click run in either direction', () => {
    expect(pageRun(null, 3)).toEqual([3]);
    expect(pageRun(3, 3)).toEqual([3]);
    expect(pageRun(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageRun(4, 2)).toEqual([4, 3, 2]);
  });

  it('picks and unpicks, keeping the selection sorted and unique', () => {
    expect(updatePicked([5, 1], [3, 1], true)).toEqual([1, 3, 5]);
    expect(updatePicked([1, 3, 5], [3, 4, 5], false)).toEqual([1]);
    expect(updatePicked([], [], true)).toEqual([]);
  });
});

describe('defaultRangesFor and zipNameFor', () => {
  it('cuts the document in half', () => {
    expect(defaultRangesFor(1)).toBe('1');
    expect(defaultRangesFor(2)).toBe('1, 2');
    expect(defaultRangesFor(3)).toBe('1-2, 3');
    expect(defaultRangesFor(10)).toBe('1-5, 6-10');
  });

  it('names the archive after the file', () => {
    expect(zipNameFor('Annual report.PDF')).toBe('Annual report-split.zip');
  });
});
