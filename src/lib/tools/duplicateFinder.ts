/**
 * Finds and removes duplicate lines, sentences, or paragraphs in a block of text — all
 * pure text transforms with no DOM or framework dependency, per this repo's lib/tools
 * layering.
 */

import { toHighlightSegments, type TextMatch, type HighlightSegment } from './wordCounter';

export type Granularity = 'line' | 'sentence' | 'paragraph';

export interface DuplicateOptions {
  granularity: Granularity;
  caseSensitive: boolean;
  trimWhitespace: boolean;
  /** Blank/whitespace-only lines are excluded from duplicate detection entirely. */
  ignoreEmptyLines: boolean;
}

export interface TextItem {
  text: string;
  start: number;
  end: number;
}

export interface DuplicateOccurrence extends TextItem {
  /** Index into the full splitItems() array — the stable id used by removeItems(). */
  itemIndex: number;
  /** Normalized comparison key (case/trim applied per options). */
  key: string;
  /** 1-based: which occurrence of this key this is. */
  occurrenceNumber: number;
  /** True for every occurrence after the first. */
  isDuplicate: boolean;
  /** 1-based physical line number in the original text where this item starts. */
  line: number;
  /** True when this key appears more than once anywhere in the text (this occurrence included). */
  hasDuplicates: boolean;
  /** Physical line numbers of every OTHER occurrence sharing this same key, in document order. */
  relatedLines: number[];
}

export interface DuplicateStats {
  total: number;
  unique: number;
  duplicateOccurrences: number;
}

/** Splits text into lines, tracking each line's offset in the original text. */
function splitLines(text: string): TextItem[] {
  if (text === '') return [];
  const items: TextItem[] = [];
  let cursor = 0;
  for (const line of text.split('\n')) {
    items.push({ text: line, start: cursor, end: cursor + line.length });
    cursor += line.length + 1;
  }
  return items;
}

/**
 * Splits text into sentences. Uses the same run-matching approach as
 * wordCounter.ts's countSentences (a trailing fragment with no terminal punctuation
 * still counts as one sentence), but tracks offsets and trims each match down to its
 * visible text so a duplicate can be highlighted at its exact position in the textarea.
 */
function splitSentences(text: string): TextItem[] {
  const items: TextItem[] = [];
  const re = /[^.!?]*[.!?]+|[^.!?]+$/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    if (raw.trim() === '') continue;
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const start = match.index + leading;
    items.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return items;
}

/** The blank-line-separated paragraph split, matching wordCounter.ts's countParagraphs. */
function splitParagraphsByBlankLine(text: string): TextItem[] {
  const items: TextItem[] = [];
  const sepRe = /\n\s*\n+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushItem = (rawStart: number, rawEnd: number) => {
    const raw = text.slice(rawStart, rawEnd);
    if (raw.trim() === '') return;
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = rawStart + leading;
    const end = rawEnd - trailing;
    items.push({ text: text.slice(start, end), start, end });
  };

  while ((match = sepRe.exec(text)) !== null) {
    pushItem(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  pushItem(cursor, text.length);
  return items;
}

/**
 * Splits text into paragraphs. Blank lines (a full empty line between paragraphs) are
 * the primary separator, matching wordCounter.ts's countParagraphs — but a lot of
 * real-world text (chat exports, some editors, a browser's plain-text copy of two `<p>`
 * elements) separates paragraphs with a single newline instead. If the blank-line split
 * finds nothing to split (the whole text reads as one paragraph), this falls back to one
 * paragraph per non-blank line, so that style of text still gets split into comparable
 * units instead of being silently treated as a single, undividable block.
 */
function splitParagraphs(text: string): TextItem[] {
  const blankLineSeparated = splitParagraphsByBlankLine(text);
  if (blankLineSeparated.length > 1 || !text.includes('\n')) return blankLineSeparated;
  return splitLines(text).filter((item) => item.text.trim() !== '');
}

export function splitItems(text: string, granularity: Granularity): TextItem[] {
  switch (granularity) {
    case 'line':
      return splitLines(text);
    case 'sentence':
      return splitSentences(text);
    case 'paragraph':
      return splitParagraphs(text);
  }
}

/** The item (if any) whose range contains the given character offset. -1 if none does. */
export function itemIndexAtOffset(items: readonly TextItem[], offset: number): number {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (offset >= item.start && offset <= item.end) return i;
  }
  return -1;
}

function normalizeKey(itemText: string, options: DuplicateOptions): string {
  const value = options.trimWhitespace ? itemText.trim() : itemText;
  return options.caseSensitive ? value : value.toLowerCase();
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** Binary search for the 1-based physical line number containing a character offset. */
function lineNumberFor(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Finds every occurrence of every item, flagging which ones are duplicates (every
 * occurrence after the first of a given normalized key), and cross-referencing every
 * occurrence against every other occurrence sharing its key. Blank items are skipped
 * entirely when `ignoreEmptyLines` is set — they never appear in the result and never
 * count toward another blank item being a "duplicate".
 */
export function findDuplicates(text: string, options: DuplicateOptions): DuplicateOccurrence[] {
  const items = splitItems(text, options.granularity);
  const lineStarts = computeLineStarts(text);

  const keys: (string | null)[] = items.map((item) =>
    options.ignoreEmptyLines && item.text.trim() === '' ? null : normalizeKey(item.text, options)
  );

  // First pass: every occurrence's physical line, grouped by key, in document order —
  // occurrence N of a key lands at index N-1 in its list, since both passes walk `items`
  // in the same order.
  const linesByKey = new Map<string, number[]>();
  items.forEach((item, itemIndex) => {
    const key = keys[itemIndex];
    if (key === null || key === undefined) return;
    const line = lineNumberFor(lineStarts, item.start);
    const list = linesByKey.get(key);
    if (list) list.push(line);
    else linesByKey.set(key, [line]);
  });

  const seenCount = new Map<string, number>();
  const result: DuplicateOccurrence[] = [];

  items.forEach((item, itemIndex) => {
    const key = keys[itemIndex];
    if (key === null || key === undefined) return;

    const occurrenceNumber = (seenCount.get(key) ?? 0) + 1;
    seenCount.set(key, occurrenceNumber);

    const allLines = linesByKey.get(key)!;
    const line = allLines[occurrenceNumber - 1]!;

    result.push({
      ...item,
      itemIndex,
      key,
      occurrenceNumber,
      isDuplicate: occurrenceNumber > 1,
      line,
      hasDuplicates: allLines.length > 1,
      relatedLines: allLines.filter((_, idx) => idx !== occurrenceNumber - 1),
    });
  });

  return result;
}

export function computeStats(occurrences: readonly DuplicateOccurrence[]): DuplicateStats {
  const total = occurrences.length;
  const duplicateOccurrences = occurrences.filter((o) => o.isDuplicate).length;
  return { total, unique: total - duplicateOccurrences, duplicateOccurrences };
}

/**
 * Rebuilds the text with the given item indices removed. Line granularity rejoins with
 * `\n` (exact, since CSV/log/list dedup depends on preserving line structure precisely);
 * sentence and paragraph granularity rejoin with a single space / blank line rather than
 * preserving each removed item's exact original surrounding whitespace — a deliberate
 * simplification, since prose cleanup doesn't depend on byte-exact spacing the way line
 * dedup does.
 */
export function removeItems(text: string, indicesToRemove: readonly number[], granularity: Granularity): string {
  const removeSet = new Set(indicesToRemove);
  const kept = splitItems(text, granularity)
    .filter((_, index) => !removeSet.has(index))
    .map((item) => item.text);

  switch (granularity) {
    case 'line':
      return kept.join('\n');
    case 'sentence':
      return kept.join(' ');
    case 'paragraph':
      return kept.join('\n\n');
  }
}

export type BulkRemovalMode = 'keepFirstOccurrence' | 'removeAllDuplicates';

/**
 * Resolves a bulk action into the concrete item indices removeItems() should drop.
 * 'keepFirstOccurrence' is the standard dedupe: drop every occurrence after the first.
 * 'removeAllDuplicates' is more aggressive: drop every occurrence — including the
 * first — of any key that appears more than once, leaving only items that were
 * already unique.
 */
export function indicesForBulkRemoval(
  occurrences: readonly DuplicateOccurrence[],
  mode: BulkRemovalMode
): number[] {
  if (mode === 'keepFirstOccurrence') {
    return occurrences.filter((o) => o.isDuplicate).map((o) => o.itemIndex);
  }
  return occurrences.filter((o) => o.hasDuplicates).map((o) => o.itemIndex);
}

/** Splits text into highlighted/unhighlighted runs covering every duplicate occurrence. */
export function toDuplicateHighlightSegments(text: string, occurrences: readonly DuplicateOccurrence[]): HighlightSegment[] {
  const matches: TextMatch[] = occurrences.filter((o) => o.isDuplicate).map((o) => ({ start: o.start, end: o.end }));
  return toHighlightSegments(text, matches);
}

/**
 * Splits text into highlighted/unhighlighted runs covering every "original" occurrence —
 * the first occurrence of a key that has duplicates elsewhere — so the source of a
 * duplicate can be shown with its own distinct highlight, separate from the duplicates
 * themselves.
 */
export function toOriginalHighlightSegments(text: string, occurrences: readonly DuplicateOccurrence[]): HighlightSegment[] {
  const matches: TextMatch[] = occurrences
    .filter((o) => o.occurrenceNumber === 1 && o.hasDuplicates)
    .map((o) => ({ start: o.start, end: o.end }));
  return toHighlightSegments(text, matches);
}

function truncateForHint(text: string, limit = 60): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

/**
 * One line of human-readable text describing where an occurrence's duplicates live,
 * shared by the in-editor hover tooltip and the chip list so the wording never drifts
 * between the two.
 */
export function describeDuplicateOccurrence(o: DuplicateOccurrence): string {
  const role = o.occurrenceNumber === 1 ? 'Original' : 'Duplicate';
  const plural = o.relatedLines.length === 1 ? 'line' : 'lines';
  return `${role} — line ${o.line}, also at ${plural} ${o.relatedLines.join(', ')}: "${truncateForHint(o.text)}"`;
}

export interface HintSegment {
  text: string;
  /** Tooltip text for this segment, or null when it isn't part of any duplicate group. */
  hint: string | null;
}

/**
 * Splits text into runs, each carrying a tooltip describing its duplicate group (or
 * null for a run that isn't one) — the per-occurrence equivalent of
 * toDuplicateHighlightSegments/toOriginalHighlightSegments, used for the hover-only
 * layer that surfaces line numbers and cross-references without showing them by default.
 */
export function toDuplicateHintSegments(text: string, occurrences: readonly DuplicateOccurrence[]): HintSegment[] {
  const relevant = [...occurrences].filter((o) => o.hasDuplicates).sort((a, b) => a.start - b.start);
  if (relevant.length === 0) return text === '' ? [] : [{ text, hint: null }];

  const segments: HintSegment[] = [];
  let cursor = 0;
  for (const o of relevant) {
    if (o.start > cursor) segments.push({ text: text.slice(cursor, o.start), hint: null });
    segments.push({ text: text.slice(o.start, o.end), hint: describeDuplicateOccurrence(o) });
    cursor = o.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hint: null });
  return segments;
}
