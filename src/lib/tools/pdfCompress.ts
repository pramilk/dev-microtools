// File-level checks moved to `pdfFile.ts` once Merge PDF needed them too; re-exported so
// this module's existing importers keep working unchanged.
export { MAX_PDF_FILE_SIZE, looksLikePdf, validatePdfFile } from './pdfFile';

/**
 * Settings, presets and validation for the PDF Compressor — deliberately free of any heavy
 * import, since the island imports this module on page load. The pdf-lib pipeline itself
 * lives in `pdfCompressEngine.ts`, which only the tool's Web Worker loads.
 */

/**
 * What each embedded image is re-encoded as. There is no WebP, AVIF or PNG option because a
 * PDF can't contain those: the format only defines JPEG (`DCTDecode`), JPEG 2000 and
 * Flate-compressed pixels. Flate with PNG row filters *is* how a PDF stores a PNG-style
 * lossless image — that's the "Lossless" choice here. Browsers can't encode JPEG 2000.
 */
export type PdfImageFormat = 'jpeg' | 'lossless' | 'match';

export const PDF_IMAGE_FORMATS: PdfImageFormat[] = ['jpeg', 'lossless', 'match'];

export const PDF_IMAGE_FORMAT_LABELS: Record<PdfImageFormat, string> = {
  jpeg: 'JPEG',
  lossless: 'Lossless',
  match: 'Match original',
};

export const PDF_IMAGE_FORMAT_HINTS: Record<PdfImageFormat, string> = {
  jpeg: 'Re-encode every image as JPEG at the chosen quality — the smallest files, best for photos and scans.',
  lossless: 'Flate (PNG-style) compression — no pixel changes, so only downsampling and grayscale shrink images.',
  match: 'JPEG images stay JPEG (at the chosen quality); lossless images stay lossless, keeping screenshots and line art crisp.',
};

export interface PdfCompressOptions {
  imageFormat: PdfImageFormat;
  /** 0-1 JPEG quality. Ignored for images that end up lossless. */
  quality: number;
  /** Downsample images above this resolution, measured against the document's largest
   *  page. Null keeps every image at its original pixel size. */
  maxDpi: number | null;
  grayscale: boolean;
  /** Document info (title, author, producer…), XMP metadata streams and editor-private
   *  `/PieceInfo` data. */
  removeMetadata: boolean;
  /** Embedded page-thumbnail images, which modern viewers regenerate on the fly anyway. */
  removeThumbnails: boolean;
}

export type PdfPresetId = 'light' | 'balanced' | 'strong';

export const PDF_PRESET_IDS: PdfPresetId[] = ['light', 'balanced', 'strong'];

export const PDF_PRESETS: Record<PdfPresetId, { label: string; hint: string; options: PdfCompressOptions }> = {
  light: {
    label: 'Light',
    hint: 'High quality, print-ready: images capped at 300 DPI, JPEG images kept at 85% quality, lossless images stay lossless.',
    options: { imageFormat: 'match', quality: 0.85, maxDpi: 300, grayscale: false, removeMetadata: false, removeThumbnails: true },
  },
  balanced: {
    label: 'Balanced',
    hint: 'Good on screen and fine for office printing: every image as 70% JPEG, capped at 150 DPI.',
    options: { imageFormat: 'jpeg', quality: 0.7, maxDpi: 150, grayscale: false, removeMetadata: false, removeThumbnails: true },
  },
  strong: {
    label: 'Strong',
    hint: 'Smallest file for email and uploads: 50% JPEG at 96 DPI, metadata removed. Fine print may soften.',
    options: { imageFormat: 'jpeg', quality: 0.5, maxDpi: 96, grayscale: false, removeMetadata: true, removeThumbnails: true },
  },
};

export const DEFAULT_PRESET: PdfPresetId = 'balanced';

/** The Max-resolution choices offered in Advanced options; null = keep original size. */
export const DPI_CHOICES: (number | null)[] = [72, 96, 150, 200, 300, null];


/** Which preset (if any) exactly matches a set of options — "Custom" once any advanced
 *  setting diverges, so the preset buttons never claim a selection that isn't true. */
export function presetMatching(options: PdfCompressOptions): PdfPresetId | null {
  return (
    PDF_PRESET_IDS.find((id) => {
      const preset = PDF_PRESETS[id].options;
      return (Object.keys(preset) as (keyof PdfCompressOptions)[]).every((key) => preset[key] === options[key]);
    }) ?? null
  );
}

/** True when some image could come out of these options as JPEG, i.e. the quality slider
 *  actually does something. */
export function usesJpegQuality(options: Pick<PdfCompressOptions, 'imageFormat'>): boolean {
  return options.imageFormat !== 'lossless';
}

/**
 * The longest side, in pixels, an image may keep under a DPI cap. Measured against the
 * document's largest page side (in PDF points, 72 per inch) rather than each image's own
 * placed size: an image drawn full-page gets exactly the requested DPI, and one drawn
 * smaller keeps proportionally more detail than it strictly needs — erring on the side of
 * never over-softening. Null means no cap.
 */
export function maxImagePixels(maxDpi: number | null, largestPageSidePoints: number): number | null {
  if (maxDpi === null || maxDpi <= 0) return null;
  const sideInches = largestPageSidePoints > 0 ? largestPageSidePoints / 72 : 11;
  return Math.max(16, Math.round(maxDpi * sideInches));
}

/** Why an image was left exactly as it was, phrased for the results panel. */
export type UnsupportedImageReason =
  | 'jpeg2000'
  | 'jbig2'
  | 'ccitt'
  | 'cmyk'
  | 'special-color'
  | 'stencil-mask'
  | 'color-key-mask'
  | 'decode-array'
  | 'bit-depth'
  | 'encoding'
  | 'corrupt';

export const UNSUPPORTED_REASON_LABELS: Record<UnsupportedImageReason, string> = {
  jpeg2000: 'JPEG 2000 images (browsers can’t decode them)',
  jbig2: 'JBIG2 black-and-white scans (already extremely compact)',
  ccitt: 'CCITT fax-encoded scans (already extremely compact)',
  cmyk: 'CMYK images (re-encoding in a browser would shift print colours)',
  'special-color': 'spot-colour, Lab or DeviceN images',
  'stencil-mask': '1-bit stencil masks (already minimal)',
  'color-key-mask': 'colour-key masked images (lossy re-encoding would break the mask)',
  'decode-array': 'images with a custom decode mapping',
  'bit-depth': 'images with an unusual bit depth or predictor',
  encoding: 'images using an uncommon stream encoding',
  corrupt: 'images whose data couldn’t be decoded',
};

export interface PdfCompressReport {
  pageCount: number;
  originalBytes: number;
  outputBytes: number;
  /** The rewritten file wasn't smaller, so the original bytes were returned unchanged. */
  keptOriginal: boolean;
  images: {
    total: number;
    recompressed: number;
    /** Supported, but re-encoding didn't shrink it (or it was already tiny). */
    unchanged: number;
    unsupported: number;
  };
  unsupportedReasons: UnsupportedImageReason[];
  /** Page content, font and other non-image streams re-deflated at maximum level. */
  streamsRecompressed: number;
  duplicatesMerged: number;
  unusedObjectsRemoved: number;
  metadataRemoved: boolean;
  thumbnailsRemoved: number;
}

/** "3 of 5 images" style pluralisation shared by the results panel. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
