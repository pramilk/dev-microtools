import { type ToolResult, ok, err } from './result';
import { batchRoom as batchRoomFor, normalizePdfName, plural, type BatchLimits } from './fileBatch';

/**
 * Settings, page-range parsing and list helpers for Merge PDF — deliberately free of any
 * heavy import, since the island imports this module on page load. The pdf-lib merge itself
 * lives in `pdfMergeEngine.ts`, which only the tool's Web Worker loads.
 */

/** Clockwise rotation applied on top of each page's own rotation. */
export type Rotation = 0 | 90 | 180 | 270;

export const nextRotation = (rotation: Rotation): Rotation => ((rotation + 90) % 360) as Rotation;

export interface PdfMergeOptions {
  /** A top-level bookmark per file, named after it, pointing at the file's first page. */
  fileBookmarks: boolean;
  /** Carry each file's own bookmarks (outline) across, nested under its file bookmark
   *  when that's on. Bookmarks pointing at pages left out of the merge are dropped. */
  keepBookmarks: boolean;
  /** After any file contributing an odd number of pages (except the last), insert a blank
   *  page so the next file starts on a front side when printed double-sided. */
  blankPageAfterOdd: boolean;
  /** Document title written to the merged file's metadata; empty leaves it unset. */
  title: string;
}

export const DEFAULT_MERGE_OPTIONS: PdfMergeOptions = {
  fileBookmarks: true,
  keepBookmarks: true,
  blankPageAfterOdd: false,
  title: '',
};

/** One file's contribution to the merge: which of its pages, in what order, rotated how. */
export interface MergeSourcePlan {
  name: string;
  /** 0-based page indices, in output order. May repeat a page. */
  pages: number[];
  rotation: Rotation;
}

/** What the worker reports about a file as soon as it's added. */
export interface PdfSourceInfo {
  pageCount: number;
  /** Outline items (bookmarks), counted recursively. */
  bookmarkCount: number;
  /** Terminal form fields (the ones a person actually fills in). */
  formFieldCount: number;
  /** Carries a digital signature, which a merge necessarily invalidates. */
  signed: boolean;
}

export interface PdfMergeReport {
  pageCount: number;
  fileCount: number;
  /** Bookmarks in the merged outline, including the per-file ones. */
  bookmarkCount: number;
  formFieldCount: number;
  /** Form fields renamed because another file already used the same name — without this
   *  the two would silently share one value. */
  renamedFields: number;
  blankPagesAdded: number;
  /** Internal links whose target page was left out of the merge, so they were removed
   *  rather than left pointing nowhere. */
  linksRemoved: number;
  /** Files whose digital signature no longer applies to the merged document. */
  signedFiles: number;
}

/** Bounds the batch: every file's bytes, pdf-lib's parsed copy and the output all live in
 *  the tab at once, so the total — not just each file — has to be capped. */
export const MAX_MERGE_FILES = 50;
export const MAX_MERGE_TOTAL_BYTES = 250 * 1024 * 1024;

/** A guard against a range like "1-5,1-5,1-5…" pasted thousands of times. */
export const MAX_SELECTED_PAGES = 10_000;

export const DEFAULT_OUTPUT_NAME = 'merged.pdf';

const RANGE_TOKEN = /^(\d+)?-(\d+)?$/;

/**
 * Parses a page selection like `1-3, 5, 8-` into 0-based page indices, in the order typed.
 *
 * - Empty input (or `all`) selects every page.
 * - `a-b` is inclusive and may run backwards (`5-1` reverses those pages).
 * - `8-` runs to the last page and `-3` from the first.
 * - `odd` / `even` select alternating pages — handy for re-ordering duplex scans.
 * - Commas, semicolons or spaces separate parts; an en/em dash works like a hyphen.
 * - A page may be listed more than once, which repeats it in the output.
 */
export function parsePageRanges(input: string, pageCount: number): ToolResult<number[]> {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, '-');
  if (normalized === '' || normalized === 'all') return ok(Array.from({ length: pageCount }, (_, i) => i));

  const pages: number[] = [];
  const outOfRange = (page: number) =>
    page === 0 ? 'Pages are numbered from 1' : `Page ${page} doesn’t exist — this file has ${pageCount === 1 ? '1 page' : `${pageCount} pages`}`;

  for (const token of normalized.split(/[\s,;]+/).filter(Boolean)) {
    if (token === 'odd' || token === 'even') {
      for (let page = token === 'odd' ? 1 : 2; page <= pageCount; page += 2) pages.push(page - 1);
    } else if (/^\d+$/.test(token)) {
      const page = Number(token);
      if (page < 1 || page > pageCount) return err(`${outOfRange(page)}.`);
      pages.push(page - 1);
    } else {
      const match = RANGE_TOKEN.exec(token);
      if (!match || (match[1] === undefined && match[2] === undefined)) {
        return err(`“${token}” isn’t a page number or range — use something like 1-3, 5, 8- or odd.`);
      }
      const from = match[1] === undefined ? 1 : Number(match[1]);
      const to = match[2] === undefined ? pageCount : Number(match[2]);
      for (const page of [from, to]) {
        if (page < 1 || page > pageCount) return err(`${outOfRange(page)} (in “${token}”).`);
      }
      const step = from <= to ? 1 : -1;
      for (let page = from; page !== to + step; page += step) {
        pages.push(page - 1);
        if (pages.length > MAX_SELECTED_PAGES) break;
      }
    }
    if (pages.length > MAX_SELECTED_PAGES) {
      return err(`That selects more than ${MAX_SELECTED_PAGES.toLocaleString('en-US')} pages — list fewer ranges.`);
    }
  }
  if (pages.length === 0) return err('That selects no pages — a one-page file has no even pages.');
  return ok(pages);
}

/** "All 12 pages" / "4 of 12 pages" / "14 pages (some repeated)" for the line under a range. */
export function describeSelection(pages: number[], pageCount: number): string {
  const isAll = pages.length === pageCount && pages.every((page, i) => page === i);
  if (isAll) return pageCount === 1 ? 'The only page' : `All ${pageCount} pages`;
  const unique = new Set(pages).size;
  if (unique < pages.length) return `${plural(pages.length, 'page')} (${unique} distinct, some repeated)`;
  return `${pages.length} of ${plural(pageCount, 'page')}`;
}

/** A file's name without its .pdf extension — used for its bookmark title. */
export const baseName = (fileName: string): string => fileName.replace(/\.pdf$/i, '').trim() || fileName;

// The generic list helpers moved to `fileBatch.ts` once Image to PDF needed them too;
// re-exported (and wrapped with Merge PDF's own limits) so existing importers keep working.
export { moveItem, plural, sortByName } from './fileBatch';

const MERGE_LIMITS: BatchLimits = {
  maxFiles: MAX_MERGE_FILES,
  maxBytes: MAX_MERGE_TOTAL_BYTES,
  toolName: 'Merge PDF',
  noun: 'file',
  sizeAdvice: 'Merge in stages, or compress the largest files first.',
};

/** A safe download name for the merged file — `merged.pdf` when nothing usable was typed. */
export const normalizeOutputName = (input: string): string => normalizePdfName(input, DEFAULT_OUTPUT_NAME);

/** Checks a batch being added against Merge PDF's file-count and total-size caps. */
export const batchRoom = (existing: { count: number; bytes: number }, candidateSizes: number[]) => batchRoomFor(existing, candidateSizes, MERGE_LIMITS);
