import { type ToolResult, ok, err } from './result';
import { parsePageRanges, baseName } from './pdfMerge';
import { plural } from './fileBatch';

/**
 * Settings, page selection, output sizing and naming for PDF to Image — free of any heavy
 * import, since the island loads this on page load. The drawing itself is pdf.js, loaded
 * lazily by the island (see `islands/shared/pdfThumbnails.ts`).
 */

export { MAX_PDF_FILE_SIZE, validatePdfFile } from './pdfFile';
export { plural };

export type PageImageFormat = 'jpeg' | 'png';

export const IMAGE_FORMATS: readonly PageImageFormat[] = ['jpeg', 'png'];

export const FORMAT_INFO: Record<PageImageFormat, { label: string; mime: string; extension: string; hint: string }> = {
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', hint: 'Smaller files — best for photos and everyday sharing' },
  png: { label: 'PNG', mime: 'image/png', extension: 'png', hint: 'Lossless and sharp text, but larger — can keep a transparent background' },
};

/** Resolutions offered, in dots per inch. A PDF page is laid out at 72 points per inch. */
export const DPI_OPTIONS: readonly { dpi: number; label: string }[] = [
  { dpi: 72, label: '72 DPI — screen, smallest' },
  { dpi: 96, label: '96 DPI — web' },
  { dpi: 150, label: '150 DPI — good for reading' },
  { dpi: 200, label: '200 DPI — sharp' },
  { dpi: 300, label: '300 DPI — print' },
];

/** JPEG quality limits, in percent. Below 30 pages look visibly blocky; 100 is barely
 *  distinguishable from 95 yet much bigger. */
export const MIN_QUALITY = 30;
export const MAX_QUALITY = 100;

export const QUALITY_PRESETS: readonly { quality: number; label: string }[] = [
  { quality: 92, label: 'High' },
  { quality: 80, label: 'Balanced' },
  { quality: 60, label: 'Small' },
  { quality: 40, label: 'Smallest' },
];

export type PageSelection = 'all' | 'selected';

export interface PdfToImageSettings {
  format: PageImageFormat;
  /** JPEG only: 30–100. */
  quality: number;
  dpi: number;
  /** PNG only: leave the page background see-through instead of white. */
  transparent: boolean;
  selection: PageSelection;
  /** The page list as typed, for `selection: 'selected'` — e.g. `1-3, 5, 8-`. */
  pages: string;
}

export const DEFAULT_PDF_TO_IMAGE_SETTINGS: PdfToImageSettings = {
  format: 'jpeg',
  quality: 80,
  dpi: 150,
  transparent: false,
  selection: 'all',
  pages: '',
};

/** A rendered page is bounded so the browser's canvas can always hold it: browsers refuse
 *  canvases past roughly 16,384 px a side or 268 megapixels, and phones give up far sooner. */
export const MAX_OUTPUT_PIXELS = 40_000_000;
export const MAX_OUTPUT_SIDE = 12_000;

export interface RenderPlan {
  /** pdf.js viewport scale (1 = 72 DPI). */
  scale: number;
  width: number;
  height: number;
  /** True when the page was drawn smaller than the chosen DPI asks, to stay within limits. */
  capped: boolean;
}

/**
 * How big to draw a page of `widthPt` × `heightPt` points at `dpi`. A huge page (a poster or
 * a CAD sheet) at 300 DPI would exceed what a canvas can hold, so the scale is reduced to fit
 * and the result flagged as `capped`.
 */
export function planRender(widthPt: number, heightPt: number, dpi: number): RenderPlan {
  const wanted = dpi / 72;
  const longest = Math.max(widthPt, heightPt);
  const limit = Math.min(MAX_OUTPUT_SIDE / longest, Math.sqrt(MAX_OUTPUT_PIXELS / (widthPt * heightPt)));
  const scale = Math.min(wanted, limit);
  return {
    scale,
    width: Math.max(1, Math.round(widthPt * scale)),
    height: Math.max(1, Math.round(heightPt * scale)),
    capped: scale < wanted - 1e-9,
  };
}

/**
 * The 0-based pages to convert, each at most once and in page order. "All" is every page;
 * "selected" parses the typed list (`1-3, 5, 8-`, `odd`, `even`) — and an empty list is an
 * error rather than silently meaning "everything".
 */
export function pagesToConvert(settings: Pick<PdfToImageSettings, 'selection' | 'pages'>, pageCount: number): ToolResult<number[]> {
  if (settings.selection === 'all') return ok(Array.from({ length: pageCount }, (_, page) => page));
  if (settings.pages.trim() === '') return err('Choose at least one page — click pages below or type a list like 1-3, 5.');
  const parsed = parsePageRanges(settings.pages, pageCount);
  if (!parsed.ok) return parsed;
  return ok([...new Set(parsed.value)].sort((a, b) => a - b));
}

/** The compact list for a set of 0-based pages: `[0,1,2,4]` → `1-3, 5`. */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let end = i;
    while (end + 1 < sorted.length && (sorted[end + 1] as number) === (sorted[end] as number) + 1) end += 1;
    const from = (sorted[i] as number) + 1;
    const to = (sorted[end] as number) + 1;
    parts.push(from === to ? `${from}` : `${from}-${to}`);
    i = end + 1;
  }
  return parts.join(', ');
}

export function validateSettings(settings: PdfToImageSettings): ToolResult<PdfToImageSettings> {
  if (!DPI_OPTIONS.some((option) => option.dpi === settings.dpi)) return err('Choose one of the listed resolutions.');
  if (settings.format === 'jpeg' && !(settings.quality >= MIN_QUALITY && settings.quality <= MAX_QUALITY)) {
    return err(`JPEG quality must be between ${MIN_QUALITY} and ${MAX_QUALITY}.`);
  }
  return ok(settings);
}

/** `report-page-07.jpg` — the page number is zero-padded to the document's width so the files
 *  sort in page order in any file browser. */
export function pageImageName(pdfFileName: string, pageIndex: number, pageCount: number, format: PageImageFormat): string {
  const digits = String(pageCount).length;
  return `${imageBase(pdfFileName)}-page-${String(pageIndex + 1).padStart(digits, '0')}.${FORMAT_INFO[format].extension}`;
}

export const zipNameFor = (pdfFileName: string): string => `${imageBase(pdfFileName)}-images.zip`;

function imageBase(pdfFileName: string): string {
  return baseName(pdfFileName).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'document';
}

/** "Page 3", "Pages 1–3, 5" for the pages a run converted. */
export function describeSelection(pages: readonly number[]): string {
  return `${pages.length === 1 ? 'Page' : 'Pages'} ${formatPageList(pages).replace(/-/g, '–')}`;
}

export const SAMPLE_FILE_NAME = 'product-brief.pdf';
export const SAMPLE_PAGE_COUNT = 4;
