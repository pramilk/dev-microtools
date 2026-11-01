import { type ToolResult, ok, err } from './result';
import { moveItem, normalizePdfName, plural, type BatchLimits } from './fileBatch';
import { MAX_MERGE_TOTAL_BYTES, MAX_SELECTED_PAGES, baseName, type Rotation } from './pdfMerge';
import type { PdfPresetId } from './pdfCompress';

/**
 * Page list editing, history, page stamps (page numbers, header/footer, watermark, background)
 * and planning for Organize PDF — deliberately free of any heavy import, since the island
 * imports this module on page load. The pdf-lib work lives in `pdfOrganizeEngine.ts`, which
 * only the tool's Web Worker loads.
 *
 * The document being edited is a plain list of `OrganizePage`s: every edit (move, rotate,
 * remove, duplicate, insert a blank page or another PDF's pages, collate a duplex scan) is a
 * pure function from one list to the next, which is what makes undo/redo a matter of keeping
 * the old lists around.
 *
 * Pages can come from more than one file: file 0 is the PDF the visitor opened, and every PDF
 * inserted later is appended to the tool's file list, so a page's `file` index never changes.
 */

export type { Rotation } from './pdfMerge';

/** Where a page comes from: the tool's file list index (0 = the opened PDF) and its 0-based page. */
export interface PageSource {
  file: number;
  page: number;
}

export interface OrganizePage {
  /** Stable identity across edits — for list keys, selection, drag and focus. */
  id: number;
  /** The page it shows, or null for an inserted blank page. */
  source: PageSource | null;
  /** Clockwise rotation on top of the page's own. */
  rotation: Rotation;
}

export const SAMPLE_FILE_NAME = 'quarterly-report.pdf';

/** Bounds the files a document can draw pages from: every file's bytes, pdf-lib's parsed copy
 *  and the output all live in the tab at once. */
export const ORGANIZE_FILE_LIMITS: BatchLimits = {
  maxFiles: 20,
  maxBytes: MAX_MERGE_TOTAL_BYTES,
  toolName: 'Organize PDF',
  noun: 'PDF',
  sizeAdvice: 'Compress the big ones first with the PDF Compressor.',
};

export function initialPages(pageCount: number): OrganizePage[] {
  return Array.from({ length: pageCount }, (_, index) => ({ id: index + 1, source: { file: 0, page: index }, rotation: 0 }));
}

const nextIdOf = (pages: readonly OrganizePage[]): number => pages.reduce((max, page) => Math.max(max, page.id), 0) + 1;

const turn = (rotation: number, delta: number): Rotation => ((((Math.round((rotation + delta) / 90) * 90) % 360) + 360) % 360) as Rotation;

/** True while the list is exactly the opened document, page for page. */
export function isPristine(pages: readonly OrganizePage[], pageCount: number): boolean {
  return pages.length === pageCount && pages.every((page, index) => page.source?.file === 0 && page.source.page === index && page.rotation === 0);
}

/** Turns the pages in `ids` by `delta` degrees clockwise (negative turns them anticlockwise). */
export function rotatePages(pages: readonly OrganizePage[], ids: ReadonlySet<number>, delta: number): OrganizePage[] {
  return pages.map((page) => (ids.has(page.id) ? { ...page, rotation: turn(page.rotation, delta) } : page));
}

export function removePages(pages: readonly OrganizePage[], ids: ReadonlySet<number>): OrganizePage[] {
  return pages.filter((page) => !ids.has(page.id));
}

/** Puts a copy of each page in `ids` straight after it. */
export function duplicatePages(pages: readonly OrganizePage[], ids: ReadonlySet<number>): OrganizePage[] {
  let id = nextIdOf(pages);
  return pages.flatMap((page) => (ids.has(page.id) ? [page, { ...page, id: id++ }] : [page]));
}

/** Where an insert goes: after the last page in `ids`, or at the end when nothing is selected. */
function insertionPoint(pages: readonly OrganizePage[], ids: ReadonlySet<number>): number {
  for (let index = pages.length - 1; index >= 0; index--) if (ids.has(pages[index]?.id ?? -1)) return index + 1;
  return pages.length;
}

/** Inserts a blank page after the last page in `ids`, or at the end when nothing is selected. */
export function insertBlankPage(pages: readonly OrganizePage[], ids: ReadonlySet<number>): { pages: OrganizePage[]; id: number } {
  const id = nextIdOf(pages);
  const next = [...pages];
  next.splice(insertionPoint(pages, ids), 0, { id, source: null, rotation: 0 });
  return { pages: next, id };
}

/** Inserts every page of file `file` (which has `pageCount` pages), in order, after the last
 *  page in `ids` — or at the end when nothing is selected. Returns the new pages' ids. */
export function insertFilePages(pages: readonly OrganizePage[], ids: ReadonlySet<number>, file: number, pageCount: number): { pages: OrganizePage[]; ids: number[] } {
  const first = nextIdOf(pages);
  const added: OrganizePage[] = Array.from({ length: pageCount }, (_, page) => ({ id: first + page, source: { file, page }, rotation: 0 }));
  const next = [...pages];
  next.splice(insertionPoint(pages, ids), 0, ...added);
  return { pages: next, ids: added.map((page) => page.id) };
}

/**
 * Puts a one-sided scan of a double-sided stack back in reading order. Scanning every front,
 * then turning the stack over to scan the backs, gives fronts 1, 2, 3 … followed by the backs
 * from the last sheet to the first; this interleaves the first half with the second half
 * reversed: front 1, back 1, front 2, back 2 … (`backsReversed: false` is for a scanner that
 * feeds the backs in order.) With an odd count, the extra page counts as a front — usually a
 * last sheet whose blank back wasn't scanned.
 */
export function collateDuplex(pages: readonly OrganizePage[], backsReversed = true): OrganizePage[] {
  const frontCount = Math.ceil(pages.length / 2);
  const fronts = pages.slice(0, frontCount);
  const backs = pages.slice(frontCount);
  if (backsReversed) backs.reverse();
  return fronts.flatMap((front, index) => {
    const back = backs[index];
    return back ? [front, back] : [front];
  });
}

/**
 * Moves every page in `ids` one place earlier (-1) or later (1). Selected pages already
 * against the start (or end) stay put, and the rest close up behind them, so a scattered
 * selection gathers as it's moved — the behaviour of every slide sorter.
 */
export function moveSelection(pages: readonly OrganizePage[], ids: ReadonlySet<number>, direction: -1 | 1): OrganizePage[] {
  const next = [...pages];
  const selectedAt = (index: number) => ids.has((next[index] as OrganizePage).id);
  const swap = (a: number, b: number) => {
    const item = next[a] as OrganizePage;
    next[a] = next[b] as OrganizePage;
    next[b] = item;
  };
  if (direction < 0) {
    for (let i = 1; i < next.length; i++) if (selectedAt(i) && !selectedAt(i - 1)) swap(i, i - 1);
  } else {
    for (let i = next.length - 2; i >= 0; i--) if (selectedAt(i) && !selectedAt(i + 1)) swap(i, i + 1);
  }
  return next;
}

/** Whether `moveSelection` would change anything — for disabling the move buttons. */
export function canMoveSelection(pages: readonly OrganizePage[], ids: ReadonlySet<number>, direction: -1 | 1): boolean {
  return pages.some((page, index) => {
    const neighbour = pages[index + direction];
    return ids.has(page.id) && neighbour !== undefined && !ids.has(neighbour.id);
  });
}

/** Moves one page to position `to` (already adjusted for its own removal) — a drag and drop. */
export function movePage(pages: readonly OrganizePage[], id: number, to: number): OrganizePage[] {
  const from = pages.findIndex((page) => page.id === id);
  return from < 0 ? [...pages] : moveItem(pages, from, to);
}

export function reversePages(pages: readonly OrganizePage[]): OrganizePage[] {
  return [...pages].reverse();
}

/** The ids from `anchorId` to `id` in list order — what Shift-click selects. */
export function selectionRun(pages: readonly OrganizePage[], anchorId: number | null, id: number): number[] {
  const to = pages.findIndex((page) => page.id === id);
  const from = anchorId === null ? -1 : pages.findIndex((page) => page.id === anchorId);
  if (to < 0) return [];
  if (from < 0) return [id];
  const [start, end] = from <= to ? [from, to] : [to, from];
  return pages.slice(start, end + 1).map((page) => page.id);
}

const sourceKey = (source: PageSource): string => `${source.file}:${source.page}`;

/** What has changed compared with the opened file (which has `pageCount` pages), for the line
 *  above the page grid. */
export function describeChanges(pages: readonly OrganizePage[], pageCount: number): string {
  const sourced = pages.flatMap((page) => (page.source ? [page.source] : []));
  const distinct = new Set(sourced.map(sourceKey));
  const own = sourced.filter((source) => source.file === 0);
  const removed = pageCount - new Set(own.map((source) => source.page)).size;
  const duplicated = sourced.length - distinct.size;
  const inserted = new Set(sourced.filter((source) => source.file !== 0).map(sourceKey)).size;
  const blanks = pages.length - sourced.length;
  const rotated = pages.filter((page) => page.rotation !== 0).length;
  const order = own.map((source) => source.page).filter((page, index, all) => all.indexOf(page) === index);
  const reordered = order.some((page, index) => index > 0 && page < (order[index - 1] as number));
  const parts = [
    reordered && 'reordered',
    rotated > 0 && `${plural(rotated, 'page')} rotated`,
    removed > 0 && `${plural(removed, 'page')} removed`,
    inserted > 0 && `${plural(inserted, 'page')} inserted from other PDFs`,
    duplicated > 0 && `${plural(duplicated, 'copy', 'copies')} added`,
    blanks > 0 && `${plural(blanks, 'blank page')} added`,
  ].filter((part): part is string => Boolean(part));
  return parts.length === 0 ? 'No changes to the pages yet' : parts.join(' · ');
}

// ---------------------------------------------------------------------- history

/** An undo/redo stack of immutable snapshots. */
export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

/** How many steps Undo can go back — snapshots are small, but a long session shouldn't grow forever. */
export const MAX_HISTORY = 100;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-MAX_HISTORY), present: next, future: [] };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

// ------------------------------------------------------------- page geometry

/** A page's visible area in PDF user space (its crop box). */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where to draw text in PDF user space: the origin of its baseline, and its angle in degrees
 *  anticlockwise — what pdf-lib's `drawText` takes. */
export interface UserSpacePlacement {
  x: number;
  y: number;
  angle: number;
}

/** The page as the reader sees it — width and height after its `/Rotate`. */
export function displaySize(box: PageBox, rotation: number): { width: number; height: number } {
  return turn(rotation, 0) % 180 === 90 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/**
 * The matrix `[a b c d e f]` that maps a point on the page *as displayed* (origin at the
 * bottom-left of what the reader sees, after the page's clockwise `/Rotate`) into PDF user
 * space: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. A page rotated 90° shows its user-space
 * left edge along the top, so anything meant for "the bottom of the page" has to be drawn along
 * its user-space right edge, turned 90° — this is what makes stamps come out upright.
 */
export function displayToUserMatrix(box: PageBox, rotation: number): [number, number, number, number, number, number] {
  const { x, y, width: w, height: h } = box;
  switch (turn(rotation, 0)) {
    case 90:
      return [0, 1, -1, 0, x + w, y];
    case 180:
      return [-1, 0, 0, -1, x + w, y + h];
    case 270:
      return [0, -1, 1, 0, x, y + h];
    default:
      return [1, 0, 0, 1, x, y];
  }
}

/** Converts a point and angle on the page as displayed into PDF user space (see `displayToUserMatrix`). */
export function toUserSpace(box: PageBox, rotation: number, dx: number, dy: number, angle = 0): UserSpacePlacement {
  const [a, b, c, d, e, f] = displayToUserMatrix(box, rotation);
  return { x: a * dx + c * dy + e, y: b * dx + d * dy + f, angle: angle + turn(rotation, 0) };
}

// --------------------------------------------------------------- text stamps

/**
 * Page numbers, the header/footer and the watermark are drawn with the PDF standard font
 * Helvetica, which every viewer has built in (so nothing is embedded), but which can only draw
 * the Windows-1252 (WinAnsi) character set. Anything else is caught here, with a message,
 * rather than failing inside the worker.
 */
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function unsupportedCharacter(text: string): string | null {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const supported = (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff && code !== 0xad) || WIN_ANSI_EXTRAS.has(char);
    if (!supported) return char;
  }
  return null;
}

/** Collapses runs of whitespace (including non-breaking spaces and new lines) to one space. */
export const cleanStampText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const fontCoverageError = (what: string, char: string) =>
  `“${char}” can’t be drawn — the ${what} uses the PDF’s built-in Helvetica font, which covers Western European letters, digits and common symbols only.`;

/** Where a page number or header/footer line sits on the page as displayed. */
export type StampPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';

export const STAMP_POSITIONS: readonly StampPosition[] = ['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left'];

export const STAMP_POSITION_LABELS: Record<StampPosition, string> = {
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
  'top-left': 'Top left',
};

export const STAMP_SIZES: readonly number[] = [8, 10, 12, 14];

/** Distance from the page edge to a page number or header/footer line, in points (about 1 cm). */
export const STAMP_MARGIN = 28;

/** Where a page number or header/footer line goes on the page as displayed: its baseline origin. */
export function stampOrigin(position: StampPosition, page: { width: number; height: number }, textWidth: number, size: number): { dx: number; dy: number } {
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const dx = horizontal === 'left' ? STAMP_MARGIN : horizontal === 'right' ? page.width - STAMP_MARGIN - textWidth : (page.width - textWidth) / 2;
  // Helvetica's capitals stand about 0.72 em tall, so this puts their tops at the margin.
  const dy = vertical === 'bottom' ? STAMP_MARGIN : page.height - STAMP_MARGIN - size * 0.72;
  return { dx, dy };
}

// ---------------------------------------------------------------- page numbers

export type NumberFormat = 'n' | 'page-n' | 'n-of-total' | 'page-n-of-total';

export const NUMBER_FORMATS: readonly NumberFormat[] = ['n', 'page-n', 'n-of-total', 'page-n-of-total'];

export function formatPageNumber(format: NumberFormat, number: number, total: number): string {
  switch (format) {
    case 'page-n':
      return `Page ${number}`;
    case 'n-of-total':
      return `${number} / ${total}`;
    case 'page-n-of-total':
      return `Page ${number} of ${total}`;
    default:
      return String(number);
  }
}

export interface PageNumberSettings {
  enabled: boolean;
  position: StampPosition;
  format: NumberFormat;
  /** The number the first numbered page gets, as typed. */
  start: string;
  /** The first page (1-based, in the organized document) that shows a number, as typed —
   *  2 leaves a cover page unnumbered. */
  fromPage: string;
  /** Point size. */
  size: number;
  /** Blank pages still count, but don't show their number. */
  skipBlank: boolean;
}

export const DEFAULT_PAGE_NUMBERS: PageNumberSettings = {
  enabled: false,
  position: 'bottom-center',
  format: 'n',
  start: '1',
  fromPage: '1',
  size: 10,
  skipBlank: true,
};

export interface PageNumberPlan {
  position: StampPosition;
  format: NumberFormat;
  start: number;
  /** 1-based. */
  fromPage: number;
  size: number;
  skipBlank: boolean;
}

const MAX_START_NUMBER = 999_999;

function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : null;
}

export function planPageNumbers(settings: PageNumberSettings, outputPageCount: number): ToolResult<PageNumberPlan | null> {
  if (!settings.enabled) return ok(null);
  const start = parseWhole(settings.start);
  if (start === null || start > MAX_START_NUMBER) return err('“Start at” needs a whole number, like 1.');
  const fromPage = parseWhole(settings.fromPage);
  if (fromPage === null || fromPage < 1) return err('“Number from page” needs a page number, like 1 — or 2 to leave a cover page unnumbered.');
  if (fromPage > outputPageCount) {
    return err(`“Number from page” is ${fromPage}, but the organized PDF has ${plural(outputPageCount, 'page')}.`);
  }
  return ok({ position: settings.position, format: settings.format, start, fromPage, size: settings.size, skipBlank: settings.skipBlank });
}

/** The label for every page of the organized document, or null where none is drawn. */
export function pageNumberLabels(plan: PageNumberPlan, blank: readonly boolean[]): (string | null)[] {
  const first = plan.fromPage - 1;
  const total = plan.start + (blank.length - plan.fromPage);
  return blank.map((isBlank, index) => {
    if (index < first || (isBlank && plan.skipBlank)) return null;
    return formatPageNumber(plan.format, plan.start + index - first, total);
  });
}

// --------------------------------------------------------------- header/footer

export interface HeaderFooterSettings {
  enabled: boolean;
  text: string;
  position: StampPosition;
  size: number;
  /** Leave inserted blank pages clean. */
  skipBlank: boolean;
}

export const DEFAULT_HEADER_FOOTER: HeaderFooterSettings = {
  enabled: false,
  text: '',
  position: 'top-center',
  size: 10,
  skipBlank: true,
};

export interface HeaderFooterPlan {
  text: string;
  position: StampPosition;
  size: number;
  skipBlank: boolean;
}

export const MAX_HEADER_LENGTH = 160;

export function planHeaderFooter(settings: HeaderFooterSettings): ToolResult<HeaderFooterPlan | null> {
  if (!settings.enabled) return ok(null);
  const text = cleanStampText(settings.text);
  if (text === '') return err('Type the header or footer text, such as your company name or “Confidential”.');
  if (text.length > MAX_HEADER_LENGTH) return err(`Keep the header or footer under ${MAX_HEADER_LENGTH} characters so it fits on one line.`);
  const bad = unsupportedCharacter(text);
  if (bad !== null) return err(fontCoverageError('header or footer', bad));
  return ok({ text, position: settings.position, size: settings.size, skipBlank: settings.skipBlank });
}

// ------------------------------------------------------------------- watermark

export type WatermarkLayout = 'diagonal' | 'horizontal';

export type WatermarkSize = 'small' | 'medium' | 'large';

export const WATERMARK_SIZES: readonly WatermarkSize[] = ['small', 'medium', 'large'];

/** How much of the line it's drawn along (the diagonal, or the width) the text spans. */
const WATERMARK_SPAN: Record<WatermarkSize, number> = { small: 0.4, medium: 0.6, large: 0.8 };

export type WatermarkColor = 'gray' | 'red' | 'blue';

export const WATERMARK_COLORS: readonly WatermarkColor[] = ['gray', 'red', 'blue'];

/** Ink colours for the PDF itself (0-1 RGB) — print colours, not UI theme colours. */
export const WATERMARK_RGB: Record<WatermarkColor, [number, number, number]> = {
  gray: [0.45, 0.45, 0.45],
  red: [0.8, 0.1, 0.1],
  blue: [0.1, 0.3, 0.75],
};

export interface WatermarkSettings {
  enabled: boolean;
  text: string;
  layout: WatermarkLayout;
  size: WatermarkSize;
  /** 5-100, as a percentage. */
  opacity: number;
  color: WatermarkColor;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  text: 'CONFIDENTIAL',
  layout: 'diagonal',
  size: 'medium',
  opacity: 20,
  color: 'gray',
};

export interface WatermarkPlan {
  text: string;
  layout: WatermarkLayout;
  /** Share of the diagonal (or width) the text spans. */
  span: number;
  /** 0-1. */
  opacity: number;
  color: [number, number, number];
}

export const MAX_WATERMARK_LENGTH = 80;

const percent = (value: number): number => Math.min(100, Math.max(5, Math.round(value))) / 100;

export function planWatermark(settings: WatermarkSettings): ToolResult<WatermarkPlan | null> {
  if (!settings.enabled) return ok(null);
  const text = cleanStampText(settings.text);
  if (text === '') return err('Type the watermark text, such as CONFIDENTIAL or DRAFT.');
  if (text.length > MAX_WATERMARK_LENGTH) return err(`Keep the watermark under ${MAX_WATERMARK_LENGTH} characters so it fits on the page.`);
  const bad = unsupportedCharacter(text);
  if (bad !== null) return err(fontCoverageError('watermark', bad));
  return ok({ text, layout: settings.layout, span: WATERMARK_SPAN[settings.size], opacity: percent(settings.opacity), color: WATERMARK_RGB[settings.color] });
}

/**
 * Size and placement of the watermark on a page as displayed: centred, along the diagonal from
 * bottom-left to top-right (or horizontally), scaled to span a share of that line, but never
 * taller than a third of the page's short side — one short word shouldn't become a giant letter.
 * `widthAt1pt` is the text's width at a 1-point font size.
 */
export function watermarkLayout(plan: Pick<WatermarkPlan, 'layout' | 'span'>, page: { width: number; height: number }, widthAt1pt: number): { size: number; dx: number; dy: number; angle: number } {
  const angle = plan.layout === 'diagonal' ? (Math.atan2(page.height, page.width) * 180) / Math.PI : 0;
  const line = plan.layout === 'diagonal' ? Math.hypot(page.width, page.height) : page.width;
  const size = Math.max(1, Math.min((line * plan.span) / Math.max(widthAt1pt, 0.01), Math.min(page.width, page.height) / 3));
  const textWidth = widthAt1pt * size;
  const capHeight = size * 0.72;
  const radians = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  // Back from the centre by half the text's width along its baseline, and half its cap height
  // across it, so the middle of the text lands on the middle of the page.
  const dx = page.width / 2 - (cos * textWidth) / 2 + (sin * capHeight) / 2;
  const dy = page.height / 2 - (sin * textWidth) / 2 - (cos * capHeight) / 2;
  return { size, dx, dy, angle };
}

// ------------------------------------------------------------------ background

export type BackgroundKind = 'none' | 'color' | 'image';

export const BACKGROUND_KINDS: readonly BackgroundKind[] = ['none', 'color', 'image'];

export type ImageFit = 'cover' | 'contain' | 'stretch';

export const IMAGE_FITS: readonly ImageFit[] = ['cover', 'contain', 'stretch'];

export interface BackgroundSettings {
  kind: BackgroundKind;
  /** `#rrggbb`, from a colour input. */
  color: string;
  fit: ImageFit;
  /** 5-100, as a percentage — how strongly the image shows. */
  opacity: number;
  /** Leave inserted blank pages white. */
  skipBlank: boolean;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'none',
  color: '#fff6dc',
  fit: 'cover',
  opacity: 100,
  skipBlank: false,
};

/** A PDF can only embed JPEG and PNG images directly (see the PDF Compressor's notes). */
export type BackgroundImageFormat = 'jpeg' | 'png';

export type BackgroundPlan =
  | { kind: 'color'; color: [number, number, number]; skipBlank: boolean }
  | { kind: 'image'; format: BackgroundImageFormat; fit: ImageFit; opacity: number; skipBlank: boolean };

/** Background images are drawn on every page, so this bounds the work and the output size. */
export const MAX_BACKGROUND_IMAGE_BYTES = 25 * 1024 * 1024;

export function parseHexColor(text: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text.trim());
  if (!match) return null;
  return [match[1], match[2], match[3]].map((part) => parseInt(part ?? '0', 16) / 255) as [number, number, number];
}

/** Which embeddable format a chosen image is, or why it can't be used. */
export function backgroundImageFormat(file: { type: string; name: string; size: number }): ToolResult<BackgroundImageFormat> {
  const type = file.type.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  let format: BackgroundImageFormat | null = null;
  if (type === 'image/jpeg' || ((type === '' || type === 'application/octet-stream') && (extension === 'jpg' || extension === 'jpeg'))) format = 'jpeg';
  else if (type === 'image/png' || ((type === '' || type === 'application/octet-stream') && extension === 'png')) format = 'png';
  if (!format) return err('Choose a JPG or PNG image — a PDF can only contain those directly. Convert other formats first with the Image Format Converter.');
  if (file.size > MAX_BACKGROUND_IMAGE_BYTES) return err(`That image is over ${MAX_BACKGROUND_IMAGE_BYTES / (1024 * 1024)} MB — it’s drawn on every page, so shrink it first with the Image Compressor.`);
  if (file.size === 0) return err('That image file is empty.');
  return ok(format);
}

export function planBackground(settings: BackgroundSettings, image: { type: string; name: string; size: number } | null): ToolResult<BackgroundPlan | null> {
  if (settings.kind === 'none') return ok(null);
  if (settings.kind === 'color') {
    const color = parseHexColor(settings.color);
    if (!color) return err('Pick a background colour.');
    return ok({ kind: 'color', color, skipBlank: settings.skipBlank });
  }
  if (!image) return err('Choose a JPG or PNG image to use as the background.');
  const format = backgroundImageFormat(image);
  if (!format.ok) return format;
  return ok({ kind: 'image', format: format.value, fit: settings.fit, opacity: percent(settings.opacity), skipBlank: settings.skipBlank });
}

/** The rectangle (on the page as displayed) an image of `image` size is drawn into. "Cover"
 *  overflows the page and is clipped to it; "contain" leaves bands; "stretch" distorts. */
export function fitImage(fit: ImageFit, page: { width: number; height: number }, image: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  if (fit === 'stretch' || image.width <= 0 || image.height <= 0) return { x: 0, y: 0, width: page.width, height: page.height };
  const scaleX = page.width / image.width;
  const scaleY = page.height / image.height;
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
}

// ------------------------------------------------------------------------ plan

export type CompressionChoice = 'off' | PdfPresetId;

export const COMPRESSION_CHOICES: readonly CompressionChoice[] = ['off', 'light', 'balanced', 'strong'];

export interface OrganizeSettings {
  compression: CompressionChoice;
  keepBookmarks: boolean;
  /** The download's name as typed; empty uses "<source>-organized.pdf". */
  fileName: string;
  numbers: PageNumberSettings;
  headerFooter: HeaderFooterSettings;
  watermark: WatermarkSettings;
  background: BackgroundSettings;
}

export const DEFAULT_ORGANIZE_SETTINGS: OrganizeSettings = {
  compression: 'off',
  keepBookmarks: true,
  fileName: '',
  numbers: DEFAULT_PAGE_NUMBERS,
  headerFooter: DEFAULT_HEADER_FOOTER,
  watermark: DEFAULT_WATERMARK,
  background: DEFAULT_BACKGROUND,
};

/** What the worker is asked to write. */
export interface OrganizePlan {
  pages: { source: PageSource | null; rotation: Rotation }[];
  keepBookmarks: boolean;
  pageNumbers: PageNumberPlan | null;
  headerFooter: HeaderFooterPlan | null;
  watermark: WatermarkPlan | null;
  background: BackgroundPlan | null;
  compression: PdfPresetId | null;
}

export const defaultOutputName = (sourceName: string): string => `${baseName(sourceName)}-organized.pdf`;

export const outputNameFor = (typed: string, sourceName: string): string => normalizePdfName(typed, defaultOutputName(sourceName));

/**
 * Checks the edited page list and settings, and turns them into what the worker writes.
 * `pageCounts` holds each file's page count, by file index; `backgroundImage` is the image
 * chosen for the background, if any.
 */
export function planOrganize(
  pages: readonly OrganizePage[],
  settings: OrganizeSettings,
  pageCounts: readonly number[],
  backgroundImage: { type: string; name: string; size: number } | null = null
): ToolResult<OrganizePlan> {
  if (pages.length === 0) return err('Every page has been removed — press Undo, or Reset to start again from the original.');
  if (!pages.some((page) => page.source !== null)) return err('Only blank pages are left — keep at least one page from a PDF.');
  if (pages.length > MAX_SELECTED_PAGES) return err(`The organized PDF can have up to ${MAX_SELECTED_PAGES.toLocaleString('en-US')} pages — remove some copies.`);
  const missing = pages.find(({ source }) => source !== null && !(source.page >= 0 && source.page < (pageCounts[source.file] ?? 0)));
  if (missing?.source) return err(`Page ${missing.source.page + 1} of file ${missing.source.file + 1} doesn’t exist, so it can’t be included.`);
  const numbers = planPageNumbers(settings.numbers, pages.length);
  if (!numbers.ok) return numbers;
  const headerFooter = planHeaderFooter(settings.headerFooter);
  if (!headerFooter.ok) return headerFooter;
  if (numbers.value && headerFooter.value && numbers.value.position === headerFooter.value.position) {
    return err(`The page numbers and the header/footer are both set to ${STAMP_POSITION_LABELS[numbers.value.position].toLowerCase()} — move one of them so they don’t overlap.`);
  }
  const watermark = planWatermark(settings.watermark);
  if (!watermark.ok) return watermark;
  const background = planBackground(settings.background, backgroundImage);
  if (!background.ok) return background;
  return ok({
    pages: pages.map(({ source, rotation }) => ({ source, rotation })),
    keepBookmarks: settings.keepBookmarks,
    pageNumbers: numbers.value,
    headerFooter: headerFooter.value,
    watermark: watermark.value,
    background: background.value,
    compression: settings.compression === 'off' ? null : settings.compression,
  });
}

/** What the worker reports about the written file. */
export interface OrganizeReport {
  pageCount: number;
  /** How many files the pages came from. */
  fileCount: number;
  bookmarkCount: number;
  formFieldCount: number;
  /** Internal links that pointed at a removed page, removed rather than left dangling. */
  linksRemoved: number;
  /** Form fields renamed because another inserted file used the same name. */
  renamedFields: number;
  /** Pages that got a page number. */
  numberedPages: number;
  /** Set when compression ran: the size before and after, and whether the uncompressed file
   *  was kept because compressing didn't make it smaller. */
  compression: { before: number; after: number; keptOriginal: boolean } | null;
  /** A source was digitally signed; the organized file can't carry the signature. */
  signed: boolean;
}
