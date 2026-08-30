import { type ToolResult, ok, err } from './result';
import { hasImageExtension } from './imageFile';

export type OutputFormat = 'image/jpeg' | 'image/webp' | 'image/png';

export const OUTPUT_FORMATS: OutputFormat[] = ['image/jpeg', 'image/webp', 'image/png'];

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/png': 'PNG',
};

export const OUTPUT_FORMAT_EXTENSIONS: Record<OutputFormat, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

/** Formats whose re-encoding is lossy and controlled by a quality value. PNG output is
 *  always lossless — the browser's canvas PNG encoder has no quality parameter. */
export const LOSSY_FORMATS = new Set<OutputFormat>(['image/jpeg', 'image/webp']);

export const DEFAULT_QUALITY = 0.8;

/** Above this, decoding and re-encoding on the main thread risks an unresponsive tab. */
export const MAX_INPUT_FILE_SIZE = 25 * 1024 * 1024;

/** Caps a single batch upload — all jobs compress concurrently on the main thread, with no queue or progress reporting past this size. */
export const MAX_BATCH_FILES = 30;

/**
 * Formats deliberately rejected before any canvas work is attempted, each for a reason a
 * generic "not an image" message wouldn't convey. GIF: canvas re-encoding only ever
 * captures a single frame, silently flattening any animation with no warning — a real
 * data-loss surprise, not just a missed optimization. SVG: it's a vector format, not
 * raster; re-encoding through canvas doesn't apply to it at all.
 */
const REJECTED_TYPE_MESSAGES: Record<string, string> = {
  'image/gif':
    "GIF isn't supported here — re-encoding through canvas would flatten any animation into a single still frame with no warning. Use a dedicated GIF tool if you need to shrink an animated GIF.",
  'image/svg+xml':
    'SVG is a vector format, not a raster one — canvas re-encoding doesn’t apply to it. Use the SVG Optimizer tool instead.',
};

/**
 * Checks a chosen file before any decode is attempted. Mirrors the Image ↔ Base64
 * Converter's leniency: a file with no declared `type` (some drag sources omit it) falls
 * back to checking its extension rather than being rejected outright, since a browser
 * genuinely doesn't always set `type` for a real image dropped this way — but also rather
 * than being waved through unconditionally, which is what let an arbitrary non-image file
 * with no declared type slip past this check via drag-and-drop (which bypasses an
 * `<input accept>` filter entirely — that only constrains the native file-picker dialog).
 */
export function validateImageFile(file: { type: string; size: number; name: string }): ToolResult<true> {
  const rejectedMessage = REJECTED_TYPE_MESSAGES[file.type];
  if (rejectedMessage) return err(rejectedMessage);

  if (file.type !== '' && !file.type.startsWith('image/')) {
    return err(`"${file.name}" is a ${file.type} file, not an image — choose a JPEG, PNG, or WebP image instead.`);
  }
  if (file.type === '' && !hasImageExtension(file.name)) {
    return err(`"${file.name}" doesn't look like an image (no recognized type or file extension) — choose a JPEG, PNG, or WebP file instead.`);
  }

  if (file.size > MAX_INPUT_FILE_SIZE) {
    return err(
      `That file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB, limit ${MAX_INPUT_FILE_SIZE / (1024 * 1024)} MB) — resize it with a desktop tool first.`
    );
  }

  return ok(true);
}

/**
 * Computes output dimensions that preserve aspect ratio, downscaling only if the image's
 * longer side exceeds `maxDimension`. Never upscales — a null/non-positive cap means
 * "don't resize" rather than "resize to nothing".
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxDimension: number | null
): { width: number; height: number } {
  if (!maxDimension || maxDimension <= 0) return { width, height };

  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };

  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Loaded lazily so its ~260KB WASM binary is fetched only when someone picks PNG output
// in the Image Compressor — never on page load, and never for JPEG/WebP users.
let oxipngModule: typeof import('@jsquash/oxipng') | null = null;
async function loadOxipng(): Promise<typeof import('@jsquash/oxipng')> {
  oxipngModule ??= await import('@jsquash/oxipng');
  return oxipngModule;
}

/**
 * Re-compresses an already-encoded PNG losslessly via Oxipng (WebAssembly) — the same
 * category of optimization `scripts/optimize-images.mjs` does at build time with sharp,
 * exposed here to the browser tool. No pixel changes; the canvas PNG encoder that produces
 * the input only does a generic deflate pass with no further optimization, which this
 * closes a meaningful gap on. Falls back to returning the input unchanged if the WASM
 * module can't load or run, so a codec failure degrades the result rather than breaking
 * the tool outright.
 */
export async function optimizePngLosslessly(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const oxipng = await loadOxipng();
    return await oxipng.optimise(buffer, { level: 3 });
  } catch (error) {
    console.warn('PNG lossless optimization pass failed, keeping the canvas-encoded PNG as-is.', error);
    return buffer;
  }
}

/** PNG's optional compression mode: `lossless` (the default — no pixel is ever changed,
 *  see `optimizePngLosslessly` above) or `lossy` (palette color quantization, see
 *  `quantizePngPixels` below). Unlike JPEG/WebP, the browser's canvas PNG encoder itself
 *  has no lossy mode — lossiness has to be applied to the pixels before encoding. */
export type PngMode = 'lossless' | 'lossy';

/**
 * Maps the same 0-1 quality fraction already used for JPEG/WebP (displayed as the 0-100%
 * slider) onto a palette color count (2-256) for PNG lossy mode. Non-linear (`quality^1.5`)
 * so the slider's useful middle (roughly 60-90%) spans a wide, perceptually meaningful
 * color-count range rather than being crammed into a couple of steps near the top.
 */
export function qualityToColorCount(quality: number): number {
  const percent = Math.min(100, Math.max(1, Math.round(quality * 100)));
  return Math.max(2, Math.round(2 + (percent / 100) ** 1.5 * 254));
}

/**
 * Structurally compatible with the DOM's `ImageData`, declared locally so this module stays
 * DOM-free like the rest of `lib/tools` — a real `ImageData` satisfies this shape without
 * this file importing the DOM lib type, and tests can pass a plain object literal with no
 * jsdom canvas support required.
 */
export interface RgbaImageData {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

// Loaded lazily so its bundle is fetched only when someone picks PNG output *and* switches
// to Lossy mode — never on page load, never for lossless-PNG or JPEG/WebP users. Same
// pattern as loadOxipng above.
let imageQModule: typeof import('image-q') | null = null;
async function loadImageQ(): Promise<typeof import('image-q')> {
  imageQModule ??= await import('image-q');
  return imageQModule;
}

/**
 * Palette-quantizes raw RGBA pixel data via `image-q` (pure JavaScript Wu quantization plus
 * Floyd-Steinberg dithering, the same family of technique as the classic `pngquant` tool) —
 * a genuinely lossy step, unlike `optimizePngLosslessly` above: this changes pixel values by
 * design, trading a reduced color palette for a much smaller file. `quality` maps to color
 * count via `qualityToColorCount`. Falls back to returning the input unchanged if the module
 * can't load or run, matching `optimizePngLosslessly`'s fallback style — a failed
 * quantization pass degrades to the un-quantized pixels rather than breaking the tool.
 */
export async function quantizePngPixels(image: RgbaImageData, quality: number): Promise<RgbaImageData> {
  try {
    const { buildPaletteSync, applyPaletteSync, utils } = await loadImageQ();
    const input = utils.PointContainer.fromUint8Array(image.data, image.width, image.height);
    const palette = buildPaletteSync([input], { colors: qualityToColorCount(quality), paletteQuantization: 'wuquant' });
    const applied = applyPaletteSync(input, palette, { imageQuantization: 'floyd-steinberg' });
    // Copied into a freshly-sized, non-shared buffer (rather than wrapping the quantizer's
    // own output array directly) so this always satisfies the DOM `ImageData` constructor's
    // `Uint8ClampedArray<ArrayBuffer>` requirement, regardless of what buffer type the
    // quantizer library's own typings report.
    const data = new Uint8ClampedArray(image.width * image.height * 4);
    data.set(applied.toUint8Array());
    return { data, width: image.width, height: image.height };
  } catch (error) {
    console.warn('PNG lossy quantization failed, keeping the un-quantized pixels.', error);
    return image;
  }
}
