// File-level checks are shared with the other PDF tools; re-exported so the island has a
// single import for everything it needs on page load.
export { MAX_PDF_FILE_SIZE, looksLikePdf, validatePdfFile } from './pdfFile';

/**
 * Types, labels and naming for the PDF Image Extractor — deliberately free of any heavy
 * import, since the island imports this module on page load. The pdf-lib pipeline lives in
 * `pdfImageExtractEngine.ts`, which only the tool's Web Worker loads.
 */

/**
 * The file format an image comes out as. JPEGs are saved byte-for-byte as stored in the
 * PDF (no re-encoding, so no quality loss) and JPEG 2000 likewise; everything else — raw or
 * Flate-compressed pixels, which have no file format of their own — becomes a PNG.
 */
export type ExtractedImageFormat = 'jpeg' | 'png' | 'jp2';

export const IMAGE_FORMAT_INFO: Record<ExtractedImageFormat, { label: string; mime: string; extension: string; previewable: boolean }> = {
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', previewable: true },
  png: { label: 'PNG', mime: 'image/png', extension: 'png', previewable: true },
  // Only Safari can display JPEG 2000, so the gallery never tries — the file still downloads.
  jp2: { label: 'JPEG 2000', mime: 'image/jp2', extension: 'jp2', previewable: false },
};

/** How the image's colours were stored in the PDF, for the per-image details line. */
export type ExtractedImageColor = 'rgb' | 'gray' | 'cmyk' | 'indexed' | 'stencil' | 'unknown';

export const IMAGE_COLOR_LABELS: Record<ExtractedImageColor, string> = {
  rgb: 'RGB',
  gray: 'Grayscale',
  cmyk: 'CMYK',
  indexed: 'Palette',
  stencil: '1-bit mask',
  unknown: 'Embedded colour',
};

export interface ExtractedPdfImage {
  /** 1-based, in order of first appearance — stable for file names and the viewer. */
  number: number;
  bytes: Uint8Array;
  format: ExtractedImageFormat;
  width: number;
  height: number;
  /** 1-based page numbers the image is drawn on, ascending. Usually one; a repeated logo
   *  or letterhead lists every page it appears on. */
  pages: number[];
  color: ExtractedImageColor;
  /** The PDF gave it transparency (a soft mask, stencil or colour key), now in the PNG. */
  hasAlpha: boolean;
}

/** Why an image found on a page couldn't be saved out. */
export type SkippedImageReason = 'jbig2' | 'ccitt' | 'special-color' | 'decode-array' | 'bit-depth' | 'encoding' | 'too-large' | 'corrupt';

export const SKIPPED_REASON_LABELS: Record<SkippedImageReason, string> = {
  jbig2: 'JBIG2 black-and-white scans (browsers can’t decode them)',
  ccitt: 'CCITT fax-encoded scans (browsers can’t decode them)',
  'special-color': 'spot-colour, Lab or DeviceN images',
  'decode-array': 'images with an unusual decode mapping',
  'bit-depth': 'images with an unusual bit depth or predictor',
  encoding: 'images using an uncommon stream encoding',
  'too-large': 'images too large to decode in a browser tab',
  corrupt: 'images whose data couldn’t be decoded',
};

export interface PdfImageExtractReport {
  pageCount: number;
  /** Distinct images found on the pages, extracted or not. */
  found: number;
  extracted: number;
  /** Byte-identical copies (the same logo embedded separately on every page) folded into
   *  one entry whose `pages` lists them all. */
  duplicatesMerged: number;
  skipped: number;
  skippedReasons: SkippedImageReason[];
}

/** Below this on either side an image is almost always a spacer, bullet or rule — hidden
 *  by default so a typical document's gallery isn't buried under them. */
export const DEFAULT_MIN_SIDE = 32;

export function isTinyImage(image: Pick<ExtractedPdfImage, 'width' | 'height'>, minSide: number = DEFAULT_MIN_SIDE): boolean {
  return image.width < minSide || image.height < minSide;
}

/** The PDF's own name minus `.pdf`, made safe for use inside a download file name. */
export function baseNameOf(fileName: string): string {
  const stem = fileName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim();
  return stem || 'document';
}

/**
 * `report-p3-img07.jpg`: the page it first appears on, then its number zero-padded to the
 * width of the total so the files sort correctly in any file manager.
 */
export function imageFileName(pdfFileName: string, image: Pick<ExtractedPdfImage, 'number' | 'pages' | 'format'>, total: number): string {
  const digits = Math.max(2, String(total).length);
  const page = image.pages[0] ?? 1;
  return `${baseNameOf(pdfFileName)}-p${page}-img${String(image.number).padStart(digits, '0')}.${IMAGE_FORMAT_INFO[image.format].extension}`;
}

export function zipFileName(pdfFileName: string): string {
  return `${baseNameOf(pdfFileName)}-images.zip`;
}

/** "p. 3" / "pp. 1, 2, 5" / "pp. 1–4, 7" — consecutive runs collapsed so a letterhead on
 *  a 40-page document doesn't print forty numbers. */
export function formatPages(pages: readonly number[]): string {
  if (pages.length === 0) return '';
  const runs: string[] = [];
  let start = pages[0];
  let prev = pages[0];
  for (let i = 1; i <= pages.length; i++) {
    const current = pages[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    runs.push(start === prev ? String(start) : prev === start + 1 ? `${start}, ${prev}` : `${start}–${prev}`);
    start = current;
    prev = current;
  }
  return `${pages.length === 1 ? 'p.' : 'pp.'} ${runs.join(', ')}`;
}

export { plural } from './fileBatch';
