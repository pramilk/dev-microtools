import { type ToolResult, ok, err } from './result';
import { looksLikeImageFile } from './imageFile';
import { batchRoom as batchRoomFor, normalizePdfName, type BatchLimits } from './fileBatch';

export { moveItem, plural, sortByName } from './fileBatch';

/**
 * Settings, validation and page geometry for Image to PDF — pure and free of any heavy
 * import, since the island imports this module on page load. The pdf-lib work lives in
 * `imageToPdfEngine.ts`, which only the tool's Web Worker loads.
 */

export type PageSizeId = 'fit' | 'a4' | 'letter';
export type OrientationId = 'auto' | 'portrait' | 'landscape';
export type MarginId = 'none' | 'small' | 'large';
/** Clockwise rotation the visitor applied to one image, on top of its EXIF orientation. */
export type Rotation = 0 | 90 | 180 | 270;

export const nextRotation = (rotation: Rotation): Rotation => ((rotation + 90) % 360) as Rotation;

export interface ImageToPdfOptions {
  pageSize: PageSizeId;
  /** Ignored for `fit`, where each page takes its image's own shape. */
  orientation: OrientationId;
  margin: MarginId;
}

export const DEFAULT_IMAGE_TO_PDF_OPTIONS: ImageToPdfOptions = { pageSize: 'a4', orientation: 'auto', margin: 'small' };

export const PAGE_SIZE_IDS: PageSizeId[] = ['a4', 'letter', 'fit'];
export const ORIENTATION_IDS: OrientationId[] = ['auto', 'portrait', 'landscape'];
export const MARGIN_IDS: MarginId[] = ['none', 'small', 'large'];

/** Portrait width × height in PDF points (1/72 inch). */
const PAGE_DIMENSIONS: Record<Exclude<PageSizeId, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export const MARGIN_POINTS: Record<MarginId, number> = { none: 0, small: 18, large: 36 };

export const PAGE_SIZE_LABELS: Record<PageSizeId, { label: string; hint: string }> = {
  a4: { label: 'A4', hint: 'A4 pages (210 × 297 mm), each image scaled to fit — the standard outside North America.' },
  letter: { label: 'Letter', hint: 'US Letter pages (8.5 × 11 in), each image scaled to fit.' },
  fit: { label: 'Fit to image', hint: 'Each page is exactly the size of its image (at 96 pixels per inch), so nothing is scaled or letterboxed.' },
};

export const ORIENTATION_LABELS: Record<OrientationId, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'Landscape pages for wide images, portrait pages for tall ones.' },
  portrait: { label: 'Portrait', hint: 'Every page portrait; wide images are scaled down to fit the width.' },
  landscape: { label: 'Landscape', hint: 'Every page landscape; tall images are scaled down to fit the height.' },
};

export const MARGIN_LABELS: Record<MarginId, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'Images run to the edge of the page.' },
  small: { label: 'Small', hint: 'A ¼-inch (6 mm) white border around each image.' },
  large: { label: 'Large', hint: 'A ½-inch (13 mm) white border — leaves room for printers that can’t print to the edge.' },
};

/** Pixels → points for "Fit to image": 96 px per inch, the CSS reference pixel, so a
 *  screenshot comes out the size it looked on screen. */
export const POINTS_PER_PIXEL = 72 / 96;

/** Acrobat refuses pages larger than 200 inches on a side. */
export const MAX_PAGE_POINTS = 14_400;

export const MAX_IMAGES = 200;
export const MAX_IMAGES_TOTAL_BYTES = 300 * 1024 * 1024;
export const DEFAULT_OUTPUT_NAME = 'images.pdf';

const LIMITS: BatchLimits = {
  maxFiles: MAX_IMAGES,
  maxBytes: MAX_IMAGES_TOTAL_BYTES,
  toolName: 'Image to PDF',
  noun: 'image',
  sizeAdvice: 'Make the PDF in parts, or shrink the largest photos with the Image Compressor first.',
};

export const batchRoom = (existing: { count: number; bytes: number }, candidateSizes: number[]) => batchRoomFor(existing, candidateSizes, LIMITS);

export const normalizeOutputName = (input: string): string => normalizePdfName(input, DEFAULT_OUTPUT_NAME);

/**
 * Checks a chosen file before it's added. SVG is turned away here because it's vector
 * markup, not pixels — a background worker has no way to render it. Formats the browser
 * may not decode (HEIC, TIFF outside Safari) are let through and reported per image if
 * decoding fails, since some browsers can.
 */
export function validateImageFile(file: { type: string; size: number; name: string }): ToolResult<true> {
  if (!looksLikeImageFile(file)) {
    return err(`"${file.name}" isn't an image${file.type ? ` (it's ${file.type})` : ''} — choose JPG, PNG, WebP, GIF, BMP or AVIF files.`);
  }
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return err(`"${file.name}" is an SVG (vector) file, which can't be placed as a picture — export it as PNG from your editor first.`);
  }
  if (file.size === 0) return err(`"${file.name}" is empty (0 bytes) — the download or export that produced it probably failed.`);
  return ok(true);
}

// ─── EXIF orientation ─────────────────────────────────────────────────────────────────────

/** EXIF Orientation values 1-8: how the stored pixels must be flipped/rotated for display. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Reads a JPEG's EXIF Orientation tag (0x0112 in IFD0). Phone cameras store pixels in sensor
 * order and set this tag instead of rotating — and a PDF viewer never looks at it, so an
 * image embedded as-is would come out sideways. Returns 1 (as stored) when there's no tag
 * or the EXIF block is malformed; never throws.
 */
export function readExifOrientation(bytes: Uint8Array): ExifOrientation {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return 1;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // Image data starts — EXIF always comes before it.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return 1;
    const start = i + 4;
    const end = Math.min(bytes.length, i + 2 + length);
    // "Exif\0\0" header, then a TIFF structure.
    if (marker === 0xe1 && end - start > 14 && bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66) {
      return orientationFromTiff(bytes, start + 6, end);
    }
    i += 2 + length;
  }
  return 1;
}

function orientationFromTiff(bytes: Uint8Array, tiff: number, end: number): ExifOrientation {
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return 1;
  const u16 = (at: number) => (at + 2 > end ? -1 : little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
  const u32 = (at: number) =>
    at + 4 > end ? -1 : little ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0 : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

  const ifd = u32(tiff + 4);
  if (ifd < 0) return 1;
  const entries = u16(tiff + ifd);
  if (entries < 0) return 1;
  for (let n = 0; n < entries; n++) {
    const entry = tiff + ifd + 2 + n * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1;
    }
  }
  return 1;
}

/**
 * Inserts a minimal EXIF block carrying just an Orientation tag right after a JPEG's SOI
 * marker — how a phone camera's sideways-stored photo looks. Used to build the "Load
 * example" photo and in tests; never applied to a visitor's files.
 */
export function withExifOrientation(jpeg: Uint8Array, orientation: ExifOrientation): Uint8Array {
  // "Exif\0\0", then a big-endian TIFF header and one IFD with a single SHORT entry.
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const segment = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif];
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2));
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

// ─── Page geometry ────────────────────────────────────────────────────────────────────────

/** True when an image's displayed width and height are its stored height and width. */
export function swapsAxes(orientation: ExifOrientation, rotation: Rotation): boolean {
  return orientation >= 5 !== (rotation === 90 || rotation === 270);
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  /** Where the (displayed, upright) image is drawn, in PDF points from the bottom-left. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Sizes the page and places an image of `width`×`height` displayed pixels on it: scaled to
 * fit inside the margins (up or down) and centred. For "Fit to image" the page wraps the
 * image at 96 px/inch plus margins, shrunk if needed to stay inside Acrobat's page limit.
 */
export function layoutPage(width: number, height: number, options: ImageToPdfOptions): PageLayout {
  const margin = MARGIN_POINTS[options.margin];

  if (options.pageSize === 'fit') {
    let imageWidth = width * POINTS_PER_PIXEL;
    let imageHeight = height * POINTS_PER_PIXEL;
    const limit = MAX_PAGE_POINTS - margin * 2;
    const shrink = Math.min(1, limit / imageWidth, limit / imageHeight);
    imageWidth *= shrink;
    imageHeight *= shrink;
    return { pageWidth: imageWidth + margin * 2, pageHeight: imageHeight + margin * 2, box: { x: margin, y: margin, width: imageWidth, height: imageHeight } };
  }

  const [short, long] = PAGE_DIMENSIONS[options.pageSize];
  const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && width > height);
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    box: { x: (pageWidth - drawWidth) / 2, y: (pageHeight - drawHeight) / 2, width: drawWidth, height: drawHeight },
  };
}

/** Maps a point of the stored image (u right, v down, both 0-1) to where it is displayed. */
type PointMap = (u: number, v: number) => [number, number];

/** Each EXIF orientation as "stored point → displayed point", straight from the tag's
 *  definition ("row 0 is the visual right-hand side, column 0 the visual top", etc.). */
const ORIENTATION_MAPS: Record<ExifOrientation, PointMap> = {
  1: (u, v) => [u, v],
  2: (u, v) => [1 - u, v],
  3: (u, v) => [1 - u, 1 - v],
  4: (u, v) => [u, 1 - v],
  5: (u, v) => [v, u],
  6: (u, v) => [1 - v, u],
  7: (u, v) => [1 - v, 1 - u],
  8: (u, v) => [v, 1 - u],
};

/** Clockwise rotation of displayed points. */
function rotate(rotation: Rotation, [s, t]: [number, number]): [number, number] {
  if (rotation === 90) return [1 - t, s];
  if (rotation === 180) return [1 - s, 1 - t];
  if (rotation === 270) return [t, 1 - s];
  return [s, t];
}

/**
 * The PDF transformation matrix `[a b c d e f]` that draws an image XObject — which PDF
 * always paints into the unit square, its first row at the top — upright into `box`, with
 * the EXIF orientation and the visitor's rotation applied. Because both are flips and
 * quarter-turns, the whole mapping is affine, so it's found by sending three corners of the
 * unit square through it.
 */
export function drawMatrix(orientation: ExifOrientation, rotation: Rotation, box: PageLayout['box']): [number, number, number, number, number, number] {
  const toPage = (p: number, q: number): [number, number] => {
    // Unit-square point → stored-image point (PDF's q runs up, image rows run down).
    const [s, t] = rotate(rotation, ORIENTATION_MAPS[orientation](p, 1 - q));
    return [box.x + s * box.width, box.y + (1 - t) * box.height];
  };
  const [e, f] = toPage(0, 0);
  const [x1, y1] = toPage(1, 0);
  const [x2, y2] = toPage(0, 1);
  return [x1 - e, y1 - f, x2 - e, y2 - f, e, f];
}

// ─── Report ───────────────────────────────────────────────────────────────────────────────

export interface ImageToPdfReport {
  pageCount: number;
  /** Images embedded byte-for-byte (JPEG), with no re-encoding at all. */
  embeddedAsIs: number;
  /** Images stored losslessly (PNG and anything with transparency). */
  lossless: number;
  /** WebP/AVIF/GIF/BMP photos with no transparency, stored as high-quality JPEG. */
  convertedToJpeg: number;
  /** Images rotated upright from their camera's EXIF orientation tag. */
  autoRotated: number;
  /** Images that couldn't be read, by their position in the request. */
  failed: { index: number; name: string; error: string }[];
}
