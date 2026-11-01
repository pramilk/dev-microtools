import { type ToolResult, ok, err } from './result';
import { baseName, parsePageRanges } from './pdfMerge';
import { normalizePdfName, plural } from './fileBatch';

/**
 * Settings, range parsing and part planning for Split PDF — deliberately free of any heavy
 * import, since the island imports this module on page load. The pdf-lib work lives in
 * `pdfSplitEngine.ts`, which only the tool's Web Worker loads.
 */

export type SplitMode = 'ranges' | 'pick' | 'every' | 'bookmarks' | 'size';

export const SPLIT_MODES: readonly SplitMode[] = ['ranges', 'pick', 'every', 'bookmarks', 'size'];

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  ranges: 'Page ranges',
  pick: 'Pick pages',
  every: 'Every N pages',
  bookmarks: 'By bookmarks',
  size: 'By file size',
};

export const SPLIT_MODE_HINTS: Record<SplitMode, string> = {
  ranges: 'One file per range you type — e.g. 1-3, 4-8, 9-',
  pick: 'See every page and click the ones you want — they’re saved as a new PDF',
  every: 'Fixed-size chunks — every page on its own, every 10 pages, and so on',
  bookmarks: 'One file per chapter or section, using the PDF’s own bookmarks',
  size: 'As few files as possible, each under a size limit — e.g. an email attachment cap',
};

/** How deep into the bookmark tree "By bookmarks" looks for split points. */
export type BookmarkLevel = 1 | 2 | 3;

export const BOOKMARK_LEVELS: readonly BookmarkLevel[] = [1, 2, 3];

export const MAX_BOOKMARK_LEVEL: BookmarkLevel = 3;

export interface PdfSplitSettings {
  mode: SplitMode;
  /** The ranges as typed — one output file per range. */
  ranges: string;
  /** Pages per file for "Every N pages", as typed. */
  everyN: string;
  bookmarkLevel: BookmarkLevel;
  /** Size limit per file for "By file size", as typed, in `maxSizeUnit`. */
  maxSize: string;
  maxSizeUnit: SizeUnit;
  /** Ranges mode only: put every range into one file instead of a file per range — the
   *  "extract pages" job. */
  combine: boolean;
  /** "Pick pages" only: the 0-based pages clicked, in any order. */
  pickedPages: readonly number[];
  /** "Pick pages" only: one file per picked page instead of one file of them all. */
  pickSeparate: boolean;
  /** Carry the bookmarks that point into each part across to it. */
  keepBookmarks: boolean;
  /** What part names start with; empty uses the source file's name. */
  prefix: string;
}

export const DEFAULT_SPLIT_SETTINGS: PdfSplitSettings = {
  mode: 'ranges',
  ranges: '',
  everyN: '1',
  bookmarkLevel: 1,
  maxSize: '5',
  maxSizeUnit: 'MB',
  combine: false,
  pickedPages: [],
  pickSeparate: false,
  keepBookmarks: true,
  prefix: '',
};

/** A bookmark that can start a part: its title, the page it opens, and its depth (1 = top). */
export interface SplitBookmark {
  title: string;
  pageIndex: number;
  level: number;
}

/** What the worker reports about a PDF as soon as it's chosen. */
export interface PdfSplitSourceInfo {
  pageCount: number;
  /** Bookmarks down to `MAX_BOOKMARK_LEVEL`, in document order, that resolve to a page. */
  bookmarks: SplitBookmark[];
  /** Every outline item, counted recursively. */
  bookmarkCount: number;
  formFieldCount: number;
  /** Carries a digital signature, which no part can keep. */
  signed: boolean;
}

/** One output file: its download name, which pages (0-based, in order), and how to describe it. */
export interface SplitPartPlan {
  name: string;
  pages: number[];
  /** "Pages 1–3", or the bookmark title in "By bookmarks" mode. */
  label: string;
}

/**
 * What the worker is asked to write. Most modes know every part up front; "By file size" can
 * only find its cut points by measuring pages inside the worker, so it carries the limit and
 * the name prefix instead.
 */
export type SplitPlan = { kind: 'parts'; parts: SplitPartPlan[] } | { kind: 'size'; maxBytes: number; base: string; /** The pages to pack, in order. */ pages: number[] };

export interface PdfSplitOptions {
  keepBookmarks: boolean;
}

export interface SplitPartReport {
  pageCount: number;
  bookmarkCount: number;
  formFieldCount: number;
  /** Internal links that pointed into a different part, removed rather than left dangling. */
  linksRemoved: number;
  /** "By file size" only: a single page that is bigger than the limit on its own. */
  overLimit: boolean;
}

/** Every part is a complete PDF held in the tab's memory at once (and zipped together on
 *  "Download all"), so the count has to be bounded. */
export const MAX_SPLIT_PARTS = 1000;

/** The sample "Load example" generates, and the ranges it starts with — the content page's
 *  worked example describes exactly this, so keep the two in step. */
export const SAMPLE_FILE_NAME = 'employee-handbook.pdf';
export const SAMPLE_RANGES = '1, 2-3, 4-6';

const tooManyParts = (count: number) =>
  `That would make ${count.toLocaleString('en-US')}+ files — the limit is ${MAX_SPLIT_PARTS.toLocaleString('en-US')}. Use bigger chunks or fewer ranges.`;

/**
 * Parses split ranges like `1-3, 4-8, 9-` into one page list per output file.
 *
 * - Commas, semicolons, spaces or new lines separate files.
 * - Each file takes anything Merge PDF's page box does: `5`, `2-4`, `8-` (to the end), `-3`,
 *   `5-1` (reversed), `odd`, `even`.
 * - `+` joins several pieces into one file: `1-2+5` is pages 1, 2 and 5 together.
 */
export function parseSplitRanges(input: string, pageCount: number): ToolResult<number[][]> {
  const normalized = input
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s*\+\s*/g, '+');
  const tokens = normalized.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) return err('Type at least one page range — for example 1-3, 4-8, 9-.');

  const parts: number[][] = [];
  for (const token of tokens) {
    const pieces = token.split('+').filter(Boolean);
    // A stray "+" on its own selects nothing — and parsePageRanges would read "" as every page.
    if (pieces.length === 0) continue;
    const selection = parsePageRanges(pieces.join(','), pageCount);
    if (!selection.ok) return selection;
    parts.push(selection.value);
    if (parts.length > MAX_SPLIT_PARTS) return err(tooManyParts(MAX_SPLIT_PARTS));
  }
  if (parts.length === 0) return err('Type at least one page range — for example 1-3, 4-8, 9-.');
  return ok(parts);
}

/** Parses the "pages per file" box. */
export function parseEveryN(input: string, pageCount: number): ToolResult<number> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter how many pages each file should have — 1 puts every page in its own file.');
  if (!/^\d+$/.test(trimmed)) return err(`“${trimmed}” isn’t a whole number — enter a page count like 1, 2 or 10.`);
  const n = Number(trimmed);
  if (n < 1) return err('Each file needs at least 1 page.');
  if (Math.ceil(pageCount / n) > MAX_SPLIT_PARTS) return err(tooManyParts(Math.ceil(pageCount / n)));
  return ok(n);
}

export type SizeUnit = 'KB' | 'MB';

export const SIZE_UNITS: readonly SizeUnit[] = ['KB', 'MB'];

const UNIT_BYTES: Record<SizeUnit, number> = { KB: 1024, MB: 1024 * 1024 };

const NOTHING_PICKED_MESSAGE = 'No pages picked yet — click the pages you want to keep.';

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

/** Smallest limit worth asking for: below this, a typical page with a font is already over. */
export const MIN_SPLIT_SIZE_KB = 50;

/** Parses the "max size per file" box (decimals allowed, comma or point) into bytes. */
export function parseMaxSize(input: string, unit: SizeUnit): ToolResult<number> {
  const trimmed = input.trim().replace(',', '.');
  if (trimmed === '') return err(`Enter the largest size each file may be, in ${unit} — for example ${unit === 'MB' ? '10' : '500'}.`);
  if (!/^\d*\.?\d+$/.test(trimmed)) return err(`“${input.trim()}” isn’t a size — enter a number of ${unit} like ${unit === 'MB' ? '5 or 2.5' : '500 or 750'}.`);
  const bytes = Math.round(Number(trimmed) * UNIT_BYTES[unit]);
  if (bytes < MIN_SPLIT_SIZE_KB * 1024) return err(`Use at least ${MIN_SPLIT_SIZE_KB} KB (0.05 MB) — anything smaller can’t hold a typical page.`);
  return ok(bytes);
}

/**
 * Re-expresses a typed size in another unit, so switching KB ↔ MB keeps the same limit
 * (5 MB → 5120 KB) instead of silently making it 1024× bigger or smaller. Text that isn't a
 * number yet is left as typed.
 */
export function convertSizeInput(input: string, from: SizeUnit, to: SizeUnit): string {
  const trimmed = input.trim().replace(',', '.');
  if (from === to || !/^\d*\.?\d+$/.test(trimmed)) return input;
  const converted = (Number(trimmed) * UNIT_BYTES[from]) / UNIT_BYTES[to];
  return String(Math.round(converted * 100) / 100);
}

/** Consecutive chunks of `size` pages; the last one takes whatever is left. */
export function chunkPages(size: number, pageCount: number): number[][] {
  const parts: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    parts.push(Array.from({ length: Math.min(size, pageCount - start) }, (_, i) => start + i));
  }
  return parts;
}

function everyNParts(input: string, pageCount: number): ToolResult<number[][]> {
  const n = parseEveryN(input, pageCount);
  return n.ok ? ok(chunkPages(n.value, pageCount)) : n;
}

/**
 * Cuts the document at every bookmark down to `level`. Each part runs from its bookmark's
 * page up to the next split point; pages before the first bookmark (a cover, a contents
 * page) become a part of their own, with a `null` title. Bookmarks are taken in page order
 * (an outline can list them out of order), and when several land on one page the first in
 * the outline names the part.
 */
export function bookmarkSections(bookmarks: SplitBookmark[], level: BookmarkLevel, pageCount: number): { title: string | null; pages: number[] }[] {
  const starts = new Map<number, string>();
  bookmarks
    .filter((bookmark) => bookmark.level <= level && bookmark.pageIndex >= 0 && bookmark.pageIndex < pageCount)
    .map((bookmark, order) => ({ ...bookmark, order }))
    .sort((a, b) => a.pageIndex - b.pageIndex || a.order - b.order)
    .forEach((bookmark) => {
      if (!starts.has(bookmark.pageIndex)) starts.set(bookmark.pageIndex, bookmark.title);
    });

  const startPages = [...starts.keys()];
  if (startPages.length === 0) return [];
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  const sections: { title: string | null; pages: number[] }[] = [];
  const first = startPages[0] ?? 0;
  if (first > 0) sections.push({ title: null, pages: range(0, first) });
  startPages.forEach((start, i) => sections.push({ title: starts.get(start) ?? null, pages: range(start, startPages[i + 1] ?? pageCount) }));
  return sections;
}

/** Runs of consecutive pages, 1-based: [0,1,2,4] → [[1,3],[5,5]]. */
function runsOf(pages: number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const page of pages) {
    const last = runs[runs.length - 1];
    if (last && page === last[1]) last[1] = page + 1;
    else runs.push([page + 1, page + 1]);
  }
  return runs;
}

/** "Page 5", "Pages 1–3", "Pages 1–2, 5" — long, scattered selections are cut short with "…". */
export function describePages(pages: number[]): string {
  const runs = runsOf(pages);
  const shown = runs.slice(0, 4).map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`));
  const text = `${shown.join(', ')}${runs.length > 4 ? ', …' : ''}`;
  return pages.length === 1 ? `Page ${text}` : `Pages ${text}`;
}

const slugify = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

/** Gives every part a distinct, safe file name: `-2`, `-3`… on a clash (the same range typed
 *  twice, two bookmarks with one title). */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((candidate) => {
    let unique = candidate;
    for (let suffix = 2; used.has(unique.toLowerCase()); suffix++) unique = candidate.replace(/\.pdf$/i, `-${suffix}.pdf`);
    used.add(unique.toLowerCase());
    return unique;
  });
}

/** `report-pages-1-3.pdf` for a plain run of pages, `report-part-04.pdf` for anything else. */
function rangePartName(base: string, pages: number[], index: number, pad: number): string {
  const runs = runsOf(pages);
  const run = runs.length === 1 ? runs[0] : undefined;
  if (run) return run[0] === run[1] ? `${base}-page-${run[0]}` : `${base}-pages-${run[0]}-${run[1]}`;
  return `${base}-part-${String(index + 1).padStart(pad, '0')}`;
}

/** Names parts that are plain page lists (ranges, chunks, size-based runs) after their pages. */
export function nameRangeParts(base: string, pageLists: number[][]): SplitPartPlan[] {
  const pad = Math.max(2, String(pageLists.length).length);
  const names = uniqueNames(pageLists.map((pages, index) => normalizePdfName(rangePartName(base, pages, index, pad), `part-${index + 1}.pdf`)));
  return pageLists.map((pages, index) => ({ name: names[index] ?? `part-${index + 1}.pdf`, pages, label: describePages(pages) }));
}

/** The file name parts are named after, made safe to use as a prefix. */
export const partBase = (fileName: string): string => normalizePdfName(baseName(fileName), 'document.pdf').replace(/\.pdf$/i, '');

/**
 * Turns the settings into what the worker should write — or a message explaining what's wrong
 * with them. Pure, so the island can show the plan (and any error) the moment a setting
 * changes, before the worker runs.
 */
export function planSplit(settings: PdfSplitSettings, info: PdfSplitSourceInfo, fileName: string): ToolResult<SplitPlan> {
  const base = partBase(settings.prefix.trim() || fileName);
  const { pageCount } = info;

  switch (settings.mode) {
    case 'pick': {
      const picked = [...new Set(settings.pickedPages)].filter((page) => Number.isInteger(page) && page >= 0 && page < pageCount).sort((a, b) => a - b);
      if (picked.length === 0) return err(NOTHING_PICKED_MESSAGE);
      if (settings.pickSeparate) return ok({ kind: 'parts', parts: nameRangeParts(base, picked.map((page) => [page])) });
      return ok({ kind: 'parts', parts: [{ name: normalizePdfName(`${base}-extracted`, 'extracted.pdf'), pages: picked, label: describePages(picked) }] });
    }
    case 'size': {
      const maxBytes = parseMaxSize(settings.maxSize, settings.maxSizeUnit);
      return maxBytes.ok ? ok({ kind: 'size', maxBytes: maxBytes.value, base, pages: range(0, pageCount) }) : maxBytes;
    }
    case 'bookmarks': {
      if (info.bookmarks.length === 0) return err('This PDF has no bookmarks to split at — split by page ranges instead.');
      const sections = bookmarkSections(info.bookmarks, settings.bookmarkLevel, pageCount);
      if (sections.length > MAX_SPLIT_PARTS) return err(tooManyParts(sections.length));
      const pad = Math.max(2, String(sections.length).length);
      const names = uniqueNames(
        sections.map(({ title }, index) =>
          normalizePdfName(`${base}-${String(index + 1).padStart(pad, '0')}-${(title === null ? 'front-matter' : slugify(title)) || 'section'}`, `part-${index + 1}.pdf`)
        )
      );
      return ok({
        kind: 'parts',
        parts: sections.map(({ title, pages }, index) => ({ name: names[index] ?? `part-${index + 1}.pdf`, pages, label: title ?? 'Before the first bookmark' })),
      });
    }
    case 'every':
    case 'ranges': {
      const pageLists = settings.mode === 'every' ? everyNParts(settings.everyN, pageCount) : parseSplitRanges(settings.ranges, pageCount);
      if (!pageLists.ok) return pageLists;
      if (settings.mode === 'ranges' && settings.combine) {
        const pages = pageLists.value.flat();
        return ok({ kind: 'parts', parts: [{ name: normalizePdfName(`${base}-extracted`, 'extracted.pdf'), pages, label: describePages(pages) }] });
      }
      return ok({ kind: 'parts', parts: nameRangeParts(base, pageLists.value) });
    }
  }
}

/**
 * The pages a Shift-click picks or unpicks: every page from the last one clicked to this one,
 * inclusive, in either direction. Without an earlier click it's just this page.
 */
export function pageRun(from: number | null, to: number): number[] {
  if (from === null || from === to) return [to];
  const step = from < to ? 1 : -1;
  return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + i * step);
}

/** Applies a pick or unpick of `pages` to the current selection, keeping it sorted. */
export function updatePicked(current: readonly number[], pages: readonly number[], picked: boolean): number[] {
  const next = new Set(current);
  for (const page of pages) {
    if (picked) next.add(page);
    else next.delete(page);
  }
  return [...next].sort((a, b) => a - b);
}

/** What the ranges box starts with for a newly chosen file: the document cut in half, so the
 *  tool shows a real result straight away and the visitor edits from there. */
export function defaultRangesFor(pageCount: number): string {
  if (pageCount <= 1) return '1';
  const half = Math.ceil(pageCount / 2);
  const span = (from: number, to: number) => (from === to ? `${from}` : `${from}-${to}`);
  return `${span(1, half)}, ${span(half + 1, pageCount)}`;
}

/** "Download all" archive name: `report-split.zip`. */
export const zipNameFor = (fileName: string): string => `${partBase(fileName)}-split.zip`;

/** "3 files", "1 file" — re-exported for the island alongside the rest of the split helpers. */
export { plural };
