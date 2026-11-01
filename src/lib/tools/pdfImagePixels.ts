import { zlibSync } from 'fflate';
import type { RgbaImageData } from './imageCompress';

/**
 * Pure pixel math for the PDF image tools: turning the raw sample data inside a PDF image
 * XObject into RGBA pixels (with its transparency), resampling them, and packing them back
 * into a Flate-encoded image stream. No DOM, no pdf-lib — the PDF object handling lives in
 * `pdfImageStream.ts` and the per-tool engines, which call into this.
 *
 * pdf-lib's own stream decoder can inflate a FlateDecode stream but doesn't undo PNG/TIFF
 * predictors (which almost every PDF generator applies to image data), and knows nothing
 * about bit depths, colour spaces or palettes — hence this module.
 */

/** How a PDF image's samples map to colour. Lab, Separation/DeviceN are skipped upstream.
 *  CMYK is representable, but only converted naively (no ICC profile) — fine for viewing an
 *  extracted image, not for re-encoding print colours, so PDF Compressor skips it. */
export type PixelColorModel =
  | { kind: 'gray' }
  | { kind: 'rgb' }
  | { kind: 'cmyk' }
  /** `lookup` is the palette: `(hival + 1) × base-components` bytes, always 8 bits each. */
  | { kind: 'indexed'; base: 'gray' | 'rgb' | 'cmyk'; hival: number; lookup: Uint8Array };

/** Samples per pixel in the *encoded* data — an indexed image stores one palette index. */
export function componentsOf(model: PixelColorModel): number {
  return model.kind === 'rgb' ? 3 : model.kind === 'cmyk' ? 4 : 1;
}

/** Bytes per row of packed samples, which PDF (like PNG) pads to a whole byte. */
export function packedRowBytes(width: number, components: number, bitsPerComponent: number): number {
  return Math.ceil((width * components * bitsPerComponent) / 8);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

/**
 * Reverses PNG-style row filtering (PDF `/Predictor` 10-15): each row is prefixed with a
 * filter-type byte (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth). `bytesPerPixel` is the
 * filter's left-neighbour distance — `ceil(components × bpc / 8)`, never less than 1.
 * Returns null for malformed data (truncated rows, an unknown filter type) rather than
 * producing garbage pixels.
 */
export function unfilterPngRows(data: Uint8Array, rowBytes: number, bytesPerPixel: number, rows: number): Uint8Array | null {
  if (rowBytes <= 0 || rows <= 0) return null;
  if (data.length < rows * (rowBytes + 1)) return null;

  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const filter = data[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prev = dst - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[src + x];
      const left = x >= bytesPerPixel ? out[dst + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prev + x - bytesPerPixel] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          return null;
      }
      out[dst + x] = value & 0xff;
    }
  }
  return out;
}

/**
 * The inverse of `unfilterPngRows`, choosing a filter per row with the standard PNG
 * encoder heuristic (the smallest sum of absolute signed residuals). This is what PDF's
 * `/Predictor 15` means, and it routinely makes the deflated result 20-50% smaller than
 * deflating raw pixels — the same reason PNG itself filters before compressing.
 */
export function filterPngRowsAdaptive(raw: Uint8Array, rowBytes: number, bytesPerPixel: number, rows: number): Uint8Array {
  const out = new Uint8Array(rows * (rowBytes + 1));
  const candidate = new Uint8Array(rowBytes);
  const best = new Uint8Array(rowBytes);

  for (let y = 0; y < rows; y++) {
    const cur = y * rowBytes;
    const prev = cur - rowBytes;
    let bestFilter = 0;
    let bestScore = Infinity;

    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < rowBytes; x++) {
        const value = raw[cur + x];
        const left = x >= bytesPerPixel ? raw[cur + x - bytesPerPixel] : 0;
        const up = y > 0 ? raw[prev + x] : 0;
        const upLeft = y > 0 && x >= bytesPerPixel ? raw[prev + x - bytesPerPixel] : 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
        const residual = (value - predicted) & 0xff;
        candidate[x] = residual;
        score += residual < 128 ? residual : 256 - residual;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best.set(candidate);
      }
    }

    out[y * (rowBytes + 1)] = bestFilter;
    out.set(best, y * (rowBytes + 1) + 1);
  }
  return out;
}

/** Reverses TIFF Predictor 2 (horizontal differencing) for 8-bit samples, in place on a
 *  copy. Other bit depths are rejected upstream — they're vanishingly rare in practice. */
export function undoTiffPredictor(data: Uint8Array, rowBytes: number, components: number, rows: number): Uint8Array | null {
  if (data.length < rowBytes * rows) return null;
  const out = data.slice(0, rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const start = y * rowBytes;
    for (let x = components; x < rowBytes; x++) {
      out[start + x] = (out[start + x] + out[start + x - components]) & 0xff;
    }
  }
  return out;
}

/**
 * Unpacks byte-padded rows of 1/2/4/8/16-bit samples into one byte per sample. Values are
 * left unscaled (a 4-bit sample stays 0-15) because an indexed image needs the raw palette
 * index; `maxValue` says what full intensity is. 16-bit samples keep their high byte,
 * which is all an 8-bit output can represent anyway.
 */
export function unpackSamples(
  data: Uint8Array,
  width: number,
  height: number,
  components: number,
  bitsPerComponent: number
): { samples: Uint8Array; maxValue: number } | null {
  if (![1, 2, 4, 8, 16].includes(bitsPerComponent)) return null;
  const rowBytes = packedRowBytes(width, components, bitsPerComponent);
  if (width <= 0 || height <= 0 || data.length < rowBytes * height) return null;

  const perRow = width * components;
  const samples = new Uint8Array(perRow * height);

  if (bitsPerComponent === 8) {
    for (let y = 0; y < height; y++) samples.set(data.subarray(y * rowBytes, y * rowBytes + perRow), y * perRow);
    return { samples, maxValue: 255 };
  }

  if (bitsPerComponent === 16) {
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < perRow; i++) samples[y * perRow + i] = data[y * rowBytes + i * 2];
    }
    return { samples, maxValue: 255 };
  }

  const mask = (1 << bitsPerComponent) - 1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let i = 0; i < perRow; i++) {
      const bit = i * bitsPerComponent;
      const byte = data[rowStart + (bit >> 3)];
      const shift = 8 - bitsPerComponent - (bit & 7);
      samples[y * perRow + i] = (byte >> shift) & mask;
    }
  }
  return { samples, maxValue: mask };
}

/** The naive, profile-free CMYK → RGB conversion (each ink multiplies away the light it
 *  absorbs). Colours come out a little more saturated than a colour-managed viewer shows,
 *  but without the cost of shipping an ICC engine. Writes into `out` at `offset`. */
function cmykToRgb(c: number, m: number, y: number, k: number, out: Uint8ClampedArray, offset: number): void {
  const white = (255 - k) / 255;
  out[offset] = (255 - c) * white;
  out[offset + 1] = (255 - m) * white;
  out[offset + 2] = (255 - y) * white;
}

/** Expands unpacked samples to opaque RGBA. Alpha is always 255: a PDF image's
 *  transparency lives in a separate `/SMask` image, never in its own samples. */
export function samplesToRgba(
  samples: Uint8Array,
  width: number,
  height: number,
  model: PixelColorModel,
  maxValue: number
): RgbaImageData {
  const pixels = width * height;
  const data = new Uint8ClampedArray(pixels * 4);
  const scale = maxValue === 255 ? 1 : 255 / maxValue;

  for (let p = 0; p < pixels; p++) {
    const o = p * 4;
    if (model.kind === 'gray') {
      const v = samples[p] * scale;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
    } else if (model.kind === 'rgb') {
      data[o] = samples[p * 3] * scale;
      data[o + 1] = samples[p * 3 + 1] * scale;
      data[o + 2] = samples[p * 3 + 2] * scale;
    } else if (model.kind === 'cmyk') {
      cmykToRgb(samples[p * 4] * scale, samples[p * 4 + 1] * scale, samples[p * 4 + 2] * scale, samples[p * 4 + 3] * scale, data, o);
    } else {
      // Out-of-range indices are clamped to hival, and a short palette reads as black —
      // both are what mainstream viewers do with slightly malformed palettes.
      const index = Math.min(samples[p], model.hival);
      if (model.base === 'gray') {
        const v = model.lookup[index] ?? 0;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
      } else if (model.base === 'cmyk') {
        const { lookup } = model;
        cmykToRgb(lookup[index * 4] ?? 0, lookup[index * 4 + 1] ?? 0, lookup[index * 4 + 2] ?? 0, lookup[index * 4 + 3] ?? 255, data, o);
      } else {
        data[o] = model.lookup[index * 3] ?? 0;
        data[o + 1] = model.lookup[index * 3 + 1] ?? 0;
        data[o + 2] = model.lookup[index * 3 + 2] ?? 0;
      }
    }
    data[o + 3] = 255;
  }
  return { data, width, height };
}

/**
 * Applies a `/Decode` array to unpacked samples: each component's `[min, max]` pair linearly
 * remaps 0…`maxValue` (the usual non-default case is `[1 0]`, an inverted scan). Returns a
 * new array; the input is left untouched because a colour-key mask compares *raw* samples.
 */
export function applyDecodeArray(samples: Uint8Array, components: number, maxValue: number, ranges: readonly number[]): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const c = i % components;
    const min = ranges[c * 2];
    const max = ranges[c * 2 + 1];
    const mapped = min + (samples[i] / maxValue) * (max - min);
    out[i] = Math.round(Math.max(0, Math.min(1, mapped)) * maxValue);
  }
  return out;
}

/**
 * Alpha from a colour-key `/Mask` array: a pixel is transparent when *every* component falls
 * inside its `[min, max]` range (compared against raw samples, as the spec defines). 16-bit
 * ranges are reduced to the high byte to match `unpackSamples`.
 */
export function alphaFromColorKey(samples: Uint8Array, components: number, ranges: readonly number[], bitsPerComponent: number): Uint8Array {
  const shift = bitsPerComponent === 16 ? 8 : 0;
  const pixels = Math.floor(samples.length / components);
  const alpha = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) {
    let keyed = true;
    for (let c = 0; c < components && keyed; c++) {
      const value = samples[p * components + c];
      keyed = value >= ranges[c * 2] >> shift && value <= ranges[c * 2 + 1] >> shift;
    }
    alpha[p] = keyed ? 0 : 255;
  }
  return alpha;
}

/**
 * Alpha from a mask image's unpacked samples. A soft mask (`/SMask`) is a grayscale coverage
 * map scaled to 0-255. A stencil mask (`/ImageMask`, or an explicit `/Mask` image) is 1-bit,
 * where a sample of 0 means "paint" under the default `/Decode [0 1]` — `inverted` flips that
 * for `/Decode [1 0]`.
 */
export function alphaFromMaskSamples(samples: Uint8Array, maxValue: number, kind: 'soft' | 'stencil', inverted = false): Uint8Array {
  const alpha = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    if (kind === 'soft') alpha[i] = Math.round((samples[i] * 255) / maxValue);
    else alpha[i] = (samples[i] === 0) !== inverted ? 255 : 0;
  }
  return alpha;
}

/**
 * Multiplies an alpha map into an image. A mask may have a different resolution from the
 * image it masks (a 300 DPI photo with a 72 DPI soft mask is legal), so it's sampled
 * nearest-neighbour at each pixel's position.
 */
export function applyAlpha(image: RgbaImageData, alpha: Uint8Array, alphaWidth: number, alphaHeight: number): RgbaImageData {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data);
  const sameSize = alphaWidth === width && alphaHeight === height;
  for (let y = 0; y < height; y++) {
    const ay = sameSize ? y : Math.min(alphaHeight - 1, Math.floor(((y + 0.5) * alphaHeight) / height));
    for (let x = 0; x < width; x++) {
      const ax = sameSize ? x : Math.min(alphaWidth - 1, Math.floor(((x + 0.5) * alphaWidth) / width));
      const a = alpha[ay * alphaWidth + ax] ?? 255;
      const o = (y * width + x) * 4 + 3;
      data[o] = (data[o] * a) / 255;
    }
  }
  return { data, width, height };
}

/** True when any pixel is less than fully opaque. */
export function hasTransparency(image: RgbaImageData): boolean {
  for (let o = 3; o < image.data.length; o += 4) if (image.data[o] !== 255) return true;
  return false;
}

/** Converts to grayscale with Rec. 601 luma weights — the same weighting JPEG itself
 *  uses for its Y channel, so a later JPEG encode doesn't shift perceived brightness. */
export function rgbaToGrayscale(image: RgbaImageData): RgbaImageData {
  const data = new Uint8ClampedArray(image.data.length);
  for (let o = 0; o < data.length; o += 4) {
    const y = 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2];
    data[o] = y;
    data[o + 1] = y;
    data[o + 2] = y;
    data[o + 3] = image.data[o + 3];
  }
  return { data, width: image.width, height: image.height };
}

/** True when every pixel has R = G = B — an RGB-encoded scan of a black-and-white page,
 *  which can be stored with one channel instead of three at no loss at all. */
export function isGrayscale(image: RgbaImageData): boolean {
  const { data } = image;
  for (let o = 0; o < data.length; o += 4) {
    if (data[o] !== data[o + 1] || data[o] !== data[o + 2]) return false;
  }
  return true;
}

interface AxisWeights {
  starts: Int32Array;
  counts: Int32Array;
  offsets: Int32Array;
  weights: Float32Array;
}

/** Area-coverage weights for resampling one axis from `srcSize` down to `dstSize`: each
 *  output sample averages exactly the input span it covers, fractional edges included. */
function axisWeights(srcSize: number, dstSize: number): AxisWeights {
  const scale = srcSize / dstSize;
  const starts = new Int32Array(dstSize);
  const counts = new Int32Array(dstSize);
  const offsets = new Int32Array(dstSize);
  const weightList: number[] = [];

  for (let i = 0; i < dstSize; i++) {
    const begin = i * scale;
    const end = Math.min(srcSize, (i + 1) * scale);
    const first = Math.floor(begin);
    const last = Math.min(srcSize - 1, Math.ceil(end) - 1);
    starts[i] = first;
    offsets[i] = weightList.length;
    let total = 0;
    for (let j = first; j <= last; j++) {
      const overlap = Math.min(end, j + 1) - Math.max(begin, j);
      weightList.push(overlap);
      total += overlap;
    }
    counts[i] = last - first + 1;
    for (let k = offsets[i]; k < weightList.length; k++) weightList[k] /= total;
  }
  return { starts, counts, offsets, weights: Float32Array.from(weightList) };
}

/**
 * Downscales RGBA pixels by area averaging — the correct filter for shrinking (every
 * source pixel contributes exactly its share, so fine text in a scan doesn't alias the way
 * nearest-neighbour or plain bilinear sampling does). Done in plain JavaScript rather than
 * on a canvas so an 8000×10000 scan isn't at the mercy of per-browser canvas size limits
 * (Safari caps a canvas at ~16.7 megapixels). Streams one output row at a time, so memory
 * stays at the output image plus a couple of row buffers. Never upscales.
 */
export function downscaleRgba(image: RgbaImageData, width: number, height: number): RgbaImageData {
  if (width >= image.width && height >= image.height) return image;
  const dstW = Math.max(1, Math.min(width, image.width));
  const dstH = Math.max(1, Math.min(height, image.height));

  const xw = axisWeights(image.width, dstW);
  const yw = axisWeights(image.height, dstH);
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const rowBuf = new Float32Array(dstW * 4);
  const acc = new Float32Array(dstW * 4);
  const src = image.data;

  const resampleRow = (sy: number) => {
    const rowStart = sy * image.width * 4;
    for (let dx = 0; dx < dstW; dx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const start = xw.starts[dx];
      for (let k = 0; k < xw.counts[dx]; k++) {
        const w = xw.weights[xw.offsets[dx] + k];
        const o = rowStart + (start + k) * 4;
        r += src[o] * w;
        g += src[o + 1] * w;
        b += src[o + 2] * w;
        a += src[o + 3] * w;
      }
      rowBuf[dx * 4] = r;
      rowBuf[dx * 4 + 1] = g;
      rowBuf[dx * 4 + 2] = b;
      rowBuf[dx * 4 + 3] = a;
    }
  };

  for (let dy = 0; dy < dstH; dy++) {
    acc.fill(0);
    for (let k = 0; k < yw.counts[dy]; k++) {
      resampleRow(yw.starts[dy] + k);
      const w = yw.weights[yw.offsets[dy] + k];
      for (let i = 0; i < acc.length; i++) acc[i] += rowBuf[i] * w;
    }
    out.set(acc, dy * dstW * 4);
  }
  return { data: out, width: dstW, height: dstH };
}

/** Drops alpha (and, for one channel, G and B) — the packed 8-bit layout a PDF image
 *  stream with `/BitsPerComponent 8` expects. */
export function packChannels(image: RgbaImageData, channels: 1 | 3): Uint8Array {
  const pixels = image.width * image.height;
  const out = new Uint8Array(pixels * channels);
  for (let p = 0; p < pixels; p++) {
    if (channels === 1) {
      out[p] = image.data[p * 4];
    } else {
      out[p * 3] = image.data[p * 4];
      out[p * 3 + 1] = image.data[p * 4 + 1];
      out[p * 3 + 2] = image.data[p * 4 + 2];
    }
  }
  return out;
}

export interface LosslessImageEncoding {
  /** zlib-wrapped deflate data, ready to be a `/FlateDecode` stream's contents. */
  data: Uint8Array;
  channels: 1 | 3;
  /** The `/DecodeParms` a reader needs to undo the PNG row filtering. */
  decodeParms: { Predictor: number; Colors: number; BitsPerComponent: number; Columns: number };
}

/**
 * Encodes pixels as a lossless PDF image stream: PNG-filtered (Predictor 15) then deflated
 * at maximum level — byte-for-byte the scheme a PNG file uses internally, which is why
 * "PNG" isn't a separate option: PDF has no PNG container, this *is* how PDF stores PNG-
 * like images. A fully grayscale image is stored with one channel instead of three.
 */
export function encodeLossless(image: RgbaImageData, forceGray = false): LosslessImageEncoding {
  const channels: 1 | 3 = forceGray || isGrayscale(image) ? 1 : 3;
  const raw = packChannels(image, channels);
  const rowBytes = image.width * channels;
  const filtered = filterPngRowsAdaptive(raw, rowBytes, channels, image.height);
  return {
    data: zlibSync(filtered, { level: 9 }),
    channels,
    decodeParms: { Predictor: 15, Colors: channels, BitsPerComponent: 8, Columns: image.width },
  };
}

/** JPEG start-of-frame markers (baseline, progressive, lossless, arithmetic variants) —
 *  everything in 0xC0-0xCF except DHT (C4), JPG (C8) and DAC (CC). */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Reads a JPEG's component count (1 = grayscale, 3 = YCbCr/RGB, 4 = CMYK) from its
 * start-of-frame header. A PDF's `/ColorSpace` must agree with it exactly, and a browser's
 * canvas encoder is free to choose either 1 or 3 for gray content — so the engine asks the
 * encoded bytes rather than assuming. Returns null if no frame header is found.
 */
export function jpegComponentCount(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // Fill byte before a marker.
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // Standalone markers carry no length.
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // End of image / start of scan before any frame.
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (SOF_MARKERS.has(marker)) {
      const componentsAt = i + 9;
      return componentsAt < bytes.length ? bytes[componentsAt] : null;
    }
    i += 2 + length;
  }
  return null;
}
