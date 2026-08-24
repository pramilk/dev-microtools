import { type ToolResult, ok, err } from './result';
import { hasImageExtension } from './imageFile';
import { computeTargetDimensions } from './imageCompress';

export type TargetFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/bmp' | 'image/x-icon';

export const TARGET_FORMATS: TargetFormat[] = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/x-icon'];

export const TARGET_FORMAT_LABELS: Record<TargetFormat, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/bmp': 'BMP',
  'image/x-icon': 'ICO',
};

export const TARGET_FORMAT_EXTENSIONS: Record<TargetFormat, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
};

/** Formats whose encoding is lossy and controlled by a quality value — only the two the
 *  canvas's own encoder supports a quality parameter for. PNG/BMP are always lossless, and
 *  ICO just wraps a losslessly-encoded PNG. */
export const LOSSY_TARGET_FORMATS = new Set<TargetFormat>(['image/jpeg', 'image/webp']);

export const DEFAULT_QUALITY = 0.85;

/** Above this, decoding and re-encoding on the main thread risks an unresponsive tab. */
export const MAX_INPUT_FILE_SIZE = 25 * 1024 * 1024;

/** Caps a single batch upload — all jobs convert concurrently on the main thread, with no queue or progress reporting past this size. */
export const MAX_BATCH_FILES = 30;

/** ICO is a legacy favicon/icon container with a practical size ceiling (the width/height
 *  byte in its directory entry can only address up to 256, with 0 meaning "256"). An image
 *  larger than this is downscaled to fit before encoding rather than silently producing a
 *  multi-hundred-KB "icon" nothing actually expects to be that large. */
export const MAX_ICO_DIMENSION = 256;

/**
 * Checks a chosen file before any decode is attempted. Deliberately more permissive than
 * Image Compressor's equivalent check: GIF and SVG are both real, useful inputs for a format
 * *converter* (rasterizing an SVG to PNG, or grabbing a still from a GIF) even though neither
 * makes sense for the compressor.
 */
export function validateImageFile(file: { type: string; size: number; name: string }): ToolResult<true> {
  if (file.type !== '' && !file.type.startsWith('image/')) {
    return err(`"${file.name}" is a ${file.type} file, not an image — choose an image file instead.`);
  }
  if (file.type === '' && !hasImageExtension(file.name)) {
    return err(`"${file.name}" doesn't look like an image (no recognized type or file extension) — choose an image file instead.`);
  }
  if (file.size > MAX_INPUT_FILE_SIZE) {
    return err(
      `That file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB, limit ${MAX_INPUT_FILE_SIZE / (1024 * 1024)} MB) — resize it with a desktop tool first.`
    );
  }
  return ok(true);
}

/**
 * A non-blocking heads-up for an input that will convert but not quite as expected — unlike
 * `validateImageFile`, nothing here stops the conversion. Returns null when there's nothing
 * worth mentioning.
 */
export function inputFormatWarning(file: { type: string; name: string }): string | null {
  if (file.type === 'image/gif' || (file.type === '' && /\.gif$/i.test(file.name))) {
    return 'GIF can be animated — only its first frame will be converted, with no warning baked into the file itself.';
  }
  return null;
}

const baseName = (filename: string): string => filename.replace(/\.[^./]+$/, '') || 'image';

/** The filename a converted file downloads as — the target format's extension appended to
 *  the original name's base, regardless of the uploaded file's own extension. */
export const outputFileName = (originalName: string, format: TargetFormat): string => `${baseName(originalName)}.${TARGET_FORMAT_EXTENSIONS[format]}`;

/** Caps ICO output to `MAX_ICO_DIMENSION` on its longer side, preserving aspect ratio — a
 *  thin wrapper so callers don't need to know ICO is the one format with a size ceiling. */
export const computeIcoDimensions = (width: number, height: number): { width: number; height: number } =>
  computeTargetDimensions(width, height, MAX_ICO_DIMENSION);

/**
 * Encodes raw RGBA pixel data (e.g. a canvas `ImageData.data`) as an uncompressed 32bpp BMP
 * — hand-rolled because no browser's canvas `toBlob` supports BMP output. The format itself
 * is simple enough that a full encoder is only ~50 lines: a 14-byte file header, a 40-byte
 * BITMAPINFOHEADER, then bottom-up, BGRA pixel rows (32bpp rows are always a multiple of 4
 * bytes, so unlike 24bpp BMP this needs no row-padding logic).
 */
export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): ArrayBuffer {
  const rowSize = width * 4;
  const pixelDataSize = rowSize * height;
  const pixelDataOffset = 54; // 14-byte file header + 40-byte DIB header
  const fileSize = pixelDataOffset + pixelDataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // reserved
  view.setUint32(10, pixelDataOffset, true);

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive height => bottom-up row order
  view.setUint16(26, 1, true); // color planes
  view.setUint16(28, 32, true); // bits per pixel
  view.setUint32(30, 0, true); // compression: BI_RGB (none)
  view.setUint32(34, pixelDataSize, true);
  view.setInt32(38, 2835, true); // ~72 DPI
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true); // colors in palette
  view.setUint32(50, 0, true); // important colors

  let offset = pixelDataOffset;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const srcIndex = (y * width + x) * 4;
      bytes[offset] = rgba[srcIndex + 2] ?? 0; // B
      bytes[offset + 1] = rgba[srcIndex + 1] ?? 0; // G
      bytes[offset + 2] = rgba[srcIndex] ?? 0; // R
      bytes[offset + 3] = rgba[srcIndex + 3] ?? 0; // A
      offset += 4;
    }
  }

  return buffer;
}

/**
 * Wraps an already-PNG-encoded image in a minimal ICO container — one `ICONDIR` plus one
 * `ICONDIRENTRY` pointing at the embedded PNG bytes. Every OS and browser has accepted a
 * PNG-compressed ICO entry since Vista, so there's no need to hand-roll a raw bitmap/AND-mask
 * icon image on top of the BMP encoder above.
 */
export function encodeIco(pngBytes: Uint8Array, width: number, height: number): ArrayBuffer {
  const headerSize = 6 + 16; // ICONDIR + one ICONDIRENTRY
  const buffer = new ArrayBuffer(headerSize + pngBytes.length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // reserved, must be 0
  view.setUint16(2, 1, true); // type: 1 = icon
  view.setUint16(4, 1, true); // image count

  // ICONDIRENTRY — width/height are single bytes; 0 encodes "256", the format's max.
  const dim = (n: number): number => (Math.min(n, 256) >= 256 ? 0 : Math.min(n, 256));
  bytes[6] = dim(width);
  bytes[7] = dim(height);
  bytes[8] = 0; // color count (0 = not a palette image)
  bytes[9] = 0; // reserved
  view.setUint16(10, 1, true); // color planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, pngBytes.length, true); // size of embedded image data
  view.setUint32(18, headerSize, true); // offset to embedded image data

  bytes.set(pngBytes, headerSize);
  return buffer;
}
