import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import {
  alphaFromColorKey,
  alphaFromMaskSamples,
  applyAlpha,
  applyDecodeArray,
  componentsOf,
  downscaleRgba,
  encodeLossless,
  filterPngRowsAdaptive,
  isGrayscale,
  jpegComponentCount,
  packChannels,
  packedRowBytes,
  rgbaToGrayscale,
  samplesToRgba,
  undoTiffPredictor,
  unfilterPngRows,
  unpackSamples,
} from './pdfImagePixels';

const rgba = (width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
};

describe('packedRowBytes / componentsOf', () => {
  it('pads sub-byte rows up to a whole byte', () => {
    expect(packedRowBytes(10, 1, 1)).toBe(2);
    expect(packedRowBytes(3, 3, 8)).toBe(9);
    expect(packedRowBytes(3, 1, 4)).toBe(2);
    expect(packedRowBytes(2, 3, 16)).toBe(12);
  });

  it('counts one component per pixel for indexed images', () => {
    expect(componentsOf({ kind: 'gray' })).toBe(1);
    expect(componentsOf({ kind: 'rgb' })).toBe(3);
    expect(componentsOf({ kind: 'indexed', base: 'rgb', hival: 1, lookup: new Uint8Array(6) })).toBe(1);
  });
});

describe('unfilterPngRows', () => {
  // A known PNG-filtered 3×2 grayscale image, one row per filter type under test.
  it('reverses each of the five PNG filter types', () => {
    const raw = new Uint8Array([10, 20, 30, 40, 50, 60]);
    for (let filter = 0; filter <= 4; filter++) {
      const filtered = new Uint8Array(8);
      // Row 0 with `filter`, row 1 unfiltered — then check row 0 decodes back.
      const left = (x: number) => (x > 0 ? raw[x - 1] : 0);
      for (let x = 0; x < 3; x++) {
        const predicted = [0, left(x), 0, left(x) >> 1, left(x)][filter];
        filtered[1 + x] = (raw[x] - predicted) & 0xff;
      }
      filtered[0] = filter;
      filtered.set([0, 40, 50, 60], 4);
      expect(Array.from(unfilterPngRows(filtered, 3, 1, 2) ?? [])).toEqual(Array.from(raw));
    }
  });

  it('uses the row above for Up, Average and Paeth', () => {
    const raw = new Uint8Array([1, 2, 3, 200, 150, 100]);
    const filtered = filterPngRowsAdaptive(raw, 3, 1, 2);
    expect(Array.from(unfilterPngRows(filtered, 3, 1, 2) ?? [])).toEqual(Array.from(raw));
  });

  it('returns null for truncated data, an unknown filter type, or degenerate sizes', () => {
    expect(unfilterPngRows(new Uint8Array([0, 1, 2]), 3, 1, 1)).toBeNull();
    expect(unfilterPngRows(new Uint8Array([9, 1, 2, 3]), 3, 1, 1)).toBeNull();
    expect(unfilterPngRows(new Uint8Array([]), 0, 1, 0)).toBeNull();
  });

  it('tolerates trailing bytes after the last row', () => {
    expect(Array.from(unfilterPngRows(new Uint8Array([0, 7, 8, 9, 99, 99]), 3, 1, 1) ?? [])).toEqual([7, 8, 9]);
  });
});

describe('filterPngRowsAdaptive', () => {
  it('round-trips random multi-byte-per-pixel data exactly', () => {
    let seed = 42;
    const raw = new Uint8Array(24 * 17 * 3).map(() => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed >>> 24;
    });
    const filtered = filterPngRowsAdaptive(raw, 24 * 3, 3, 17);
    expect(filtered.length).toBe(17 * (24 * 3 + 1));
    expect(unfilterPngRows(filtered, 24 * 3, 3, 17)).toEqual(raw);
  });

  it('picks a predicting filter for a smooth gradient, so it compresses well', () => {
    const raw = new Uint8Array(64 * 4).map((_, i) => (i % 64) * 4);
    const filtered = filterPngRowsAdaptive(raw, 64, 1, 4);
    expect(filtered[0]).not.toBe(0);
  });
});

describe('undoTiffPredictor', () => {
  it('reverses horizontal differencing per component', () => {
    // Two RGB pixels: (10,20,30) then (+5,+5,+5) → (15,25,35).
    expect(Array.from(undoTiffPredictor(new Uint8Array([10, 20, 30, 5, 5, 5]), 6, 3, 1) ?? [])).toEqual([10, 20, 30, 15, 25, 35]);
  });

  it('wraps modulo 256 and rejects short data', () => {
    expect(Array.from(undoTiffPredictor(new Uint8Array([250, 10]), 2, 1, 1) ?? [])).toEqual([250, 4]);
    expect(undoTiffPredictor(new Uint8Array([1]), 2, 1, 1)).toBeNull();
  });
});

describe('unpackSamples', () => {
  it('unpacks 1-bit rows with per-row byte padding', () => {
    // Width 3: row 0 = 1,0,1 ; row 1 = 0,1,1 — each padded to a full byte.
    const result = unpackSamples(new Uint8Array([0b10100000, 0b01100000]), 3, 2, 1, 1);
    expect(result?.maxValue).toBe(1);
    expect(Array.from(result?.samples ?? [])).toEqual([1, 0, 1, 0, 1, 1]);
  });

  it('unpacks 2- and 4-bit samples', () => {
    expect(Array.from(unpackSamples(new Uint8Array([0b00011011]), 4, 1, 1, 2)?.samples ?? [])).toEqual([0, 1, 2, 3]);
    expect(Array.from(unpackSamples(new Uint8Array([0xab, 0xc0]), 3, 1, 1, 4)?.samples ?? [])).toEqual([10, 11, 12]);
  });

  it('keeps the high byte of 16-bit samples', () => {
    const result = unpackSamples(new Uint8Array([0x12, 0x34, 0xff, 0x00]), 2, 1, 1, 16);
    expect(result?.maxValue).toBe(255);
    expect(Array.from(result?.samples ?? [])).toEqual([0x12, 0xff]);
  });

  it('rejects unsupported bit depths, zero sizes and short data', () => {
    expect(unpackSamples(new Uint8Array(10), 2, 2, 1, 3)).toBeNull();
    expect(unpackSamples(new Uint8Array(10), 0, 2, 1, 8)).toBeNull();
    expect(unpackSamples(new Uint8Array(3), 2, 2, 1, 8)).toBeNull();
  });
});

describe('samplesToRgba', () => {
  it('scales low-bit gray to the full 0-255 range', () => {
    const image = samplesToRgba(new Uint8Array([0, 1]), 2, 1, { kind: 'gray' }, 1);
    expect(Array.from(image.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('maps RGB samples straight through with opaque alpha', () => {
    const image = samplesToRgba(new Uint8Array([1, 2, 3]), 1, 1, { kind: 'rgb' }, 255);
    expect(Array.from(image.data)).toEqual([1, 2, 3, 255]);
  });

  it('looks up indexed colours, clamping out-of-range indices to hival', () => {
    const lookup = new Uint8Array([255, 0, 0, 0, 0, 255]);
    const image = samplesToRgba(new Uint8Array([1, 0, 7]), 3, 1, { kind: 'indexed', base: 'rgb', hival: 1, lookup }, 255);
    expect(Array.from(image.data)).toEqual([0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('supports gray-based palettes and reads a short palette as black', () => {
    const image = samplesToRgba(new Uint8Array([0, 1]), 2, 1, { kind: 'indexed', base: 'gray', hival: 1, lookup: new Uint8Array([128]) }, 255);
    expect(Array.from(image.data)).toEqual([128, 128, 128, 255, 0, 0, 0, 255]);
  });

  it('converts CMYK naively: no ink is white, full K is black, each ink removes its complement', () => {
    expect(componentsOf({ kind: 'cmyk' })).toBe(4);
    const samples = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 255, 128]);
    const image = samplesToRgba(samples, 4, 1, { kind: 'cmyk' }, 255);
    expect(Array.from(image.data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 255, 255, 127, 127, 0, 255]);
  });

  it('scales low-bit CMYK and supports CMYK-based palettes', () => {
    const lowBit = samplesToRgba(new Uint8Array([1, 0, 0, 0]), 1, 1, { kind: 'cmyk' }, 1);
    expect(Array.from(lowBit.data)).toEqual([0, 255, 255, 255]);
    const lookup = new Uint8Array([0, 255, 0, 0]);
    const indexed = samplesToRgba(new Uint8Array([0]), 1, 1, { kind: 'indexed', base: 'cmyk', hival: 0, lookup }, 255);
    expect(Array.from(indexed.data)).toEqual([255, 0, 255, 255]);
  });
});

describe('applyDecodeArray', () => {
  it('inverts with [1 0] and leaves the input untouched', () => {
    const input = new Uint8Array([0, 128, 255]);
    expect(Array.from(applyDecodeArray(input, 1, 255, [1, 0]))).toEqual([255, 127, 0]);
    expect(Array.from(input)).toEqual([0, 128, 255]);
  });

  it('maps each component by its own range, clamping out-of-range results', () => {
    expect(Array.from(applyDecodeArray(new Uint8Array([255, 255]), 2, 255, [0, 0.5, 0, 2]))).toEqual([128, 255]);
  });

  it('works in the sample range of low-bit images', () => {
    expect(Array.from(applyDecodeArray(new Uint8Array([0, 1]), 1, 1, [1, 0]))).toEqual([1, 0]);
  });

  it('handles empty input', () => {
    expect(applyDecodeArray(new Uint8Array(), 3, 255, [0, 1, 0, 1, 0, 1])).toHaveLength(0);
  });
});

describe('alphaFromColorKey', () => {
  it('keys out a pixel only when every component is inside its range', () => {
    const samples = new Uint8Array([0, 255, 0, 0, 255, 100, 10, 250, 5]);
    expect(Array.from(alphaFromColorKey(samples, 3, [0, 10, 240, 255, 0, 10], 8))).toEqual([0, 255, 0]);
  });

  it('compares 16-bit ranges against the high byte', () => {
    expect(Array.from(alphaFromColorKey(new Uint8Array([0x12, 0x13]), 1, [0x1200, 0x12ff], 16))).toEqual([0, 255]);
  });
});

describe('alphaFromMaskSamples', () => {
  it('scales soft-mask coverage to 0-255, including low-bit masks', () => {
    expect(Array.from(alphaFromMaskSamples(new Uint8Array([0, 128, 255]), 255, 'soft'))).toEqual([0, 128, 255]);
    expect(Array.from(alphaFromMaskSamples(new Uint8Array([0, 1, 3]), 3, 'soft'))).toEqual([0, 85, 255]);
  });

  it('paints stencil samples of 0, or of 1 when inverted', () => {
    expect(Array.from(alphaFromMaskSamples(new Uint8Array([0, 1]), 1, 'stencil'))).toEqual([255, 0]);
    expect(Array.from(alphaFromMaskSamples(new Uint8Array([0, 1]), 1, 'stencil', true))).toEqual([0, 255]);
  });
});

describe('applyAlpha', () => {
  it('multiplies a same-size mask into existing alpha without mutating the input', () => {
    const image = rgba(2, 1, (x) => [9, 9, 9, x === 0 ? 255 : 128]);
    const out = applyAlpha(image, new Uint8Array([128, 255]), 2, 1);
    expect(Array.from(out.data)).toEqual([9, 9, 9, 128, 9, 9, 9, 128]);
    expect(image.data[3]).toBe(255);
  });

  it('samples a lower-resolution mask nearest-neighbour', () => {
    const image = rgba(4, 4, () => [1, 2, 3, 255]);
    const out = applyAlpha(image, new Uint8Array([0, 255, 255, 0]), 2, 2);
    const alphaAt = (x: number, y: number) => out.data[(y * 4 + x) * 4 + 3];
    expect([alphaAt(0, 0), alphaAt(1, 1), alphaAt(2, 0), alphaAt(3, 1), alphaAt(0, 3), alphaAt(3, 3)]).toEqual([0, 0, 255, 255, 255, 0]);
  });

  it('samples a higher-resolution mask too, and treats a short mask as opaque', () => {
    const image = rgba(1, 1, () => [0, 0, 0, 255]);
    expect(applyAlpha(image, new Uint8Array([0, 0, 0, 0]), 2, 2).data[3]).toBe(0);
    expect(applyAlpha(image, new Uint8Array(), 1, 1).data[3]).toBe(255);
  });
});

describe('grayscale helpers', () => {
  it('converts with Rec. 601 weights and preserves alpha', () => {
    const gray = rgbaToGrayscale({ data: new Uint8ClampedArray([255, 0, 0, 77]), width: 1, height: 1 });
    expect(Array.from(gray.data)).toEqual([76, 76, 76, 77]);
  });

  it('detects whether an image is already grayscale', () => {
    expect(isGrayscale(rgba(2, 2, () => [9, 9, 9, 255]))).toBe(true);
    expect(isGrayscale(rgba(2, 2, (x) => (x ? [9, 9, 10, 255] : [9, 9, 9, 255])))).toBe(false);
  });
});

describe('downscaleRgba', () => {
  it('averages exact 2×2 blocks when halving', () => {
    const image = rgba(2, 2, (x, y) => (x + y === 1 ? [200, 0, 0, 255] : [0, 0, 100, 255]));
    const small = downscaleRgba(image, 1, 1);
    expect(Array.from(small.data)).toEqual([100, 0, 50, 255]);
  });

  it('handles non-integer ratios by fractional coverage', () => {
    // 3 → 2: output pixel 0 covers src [0, 1.5) → 2/3 of px0 + 1/3 of px1.
    const image = rgba(3, 1, (x) => [[0, 90, 180][x], 0, 0, 255]);
    const small = downscaleRgba(image, 2, 1);
    expect(small.data[0]).toBe(30);
    expect(small.data[4]).toBe(150);
  });

  it('never upscales and returns the same image when no shrink is needed', () => {
    const image = rgba(4, 4, () => [1, 2, 3, 255]);
    expect(downscaleRgba(image, 8, 8)).toBe(image);
  });

  it('keeps a solid colour exactly solid across a large downscale', () => {
    const big = rgba(1000, 800, () => [12, 34, 56, 255]);
    const small = downscaleRgba(big, 333, 267);
    expect(small.width).toBe(333);
    expect(small.height).toBe(267);
    for (let i = 0; i < small.data.length; i += 4) {
      expect([small.data[i], small.data[i + 1], small.data[i + 2], small.data[i + 3]]).toEqual([12, 34, 56, 255]);
    }
  });
});

describe('packChannels / encodeLossless', () => {
  it('packs RGB or single-channel layouts', () => {
    const image = rgba(2, 1, (x) => (x ? [4, 5, 6, 255] : [1, 2, 3, 255]));
    expect(Array.from(packChannels(image, 3))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(packChannels(image, 1))).toEqual([1, 4]);
  });

  it('round-trips losslessly through inflate + PNG unfilter', () => {
    const image = rgba(37, 23, (x, y) => [(x * 7) & 255, (y * 11) & 255, (x * y) & 255, 255]);
    const encoded = encodeLossless(image);
    expect(encoded.channels).toBe(3);
    expect(encoded.decodeParms).toEqual({ Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: 37 });
    const restored = unfilterPngRows(unzlibSync(encoded.data), 37 * 3, 3, 23);
    expect(restored).toEqual(packChannels(image, 3));
  });

  it('stores a grayscale image (or a forced-gray one) with one channel', () => {
    expect(encodeLossless(rgba(8, 8, (x) => [x, x, x, 255])).channels).toBe(1);
    expect(encodeLossless(rgba(8, 8, (x) => [x, 0, 0, 255]), true).channels).toBe(1);
  });

  it('compresses a flat image to a tiny fraction of its raw size', () => {
    const encoded = encodeLossless(rgba(500, 500, () => [240, 240, 240, 255]));
    expect(encoded.data.length).toBeLessThan(2000);
  });
});

describe('jpegComponentCount', () => {
  const sof = (components: number, marker = 0xc0) => new Uint8Array([0xff, 0xd8, 0xff, marker, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, components]);

  it('reads the component count from baseline and progressive frame headers', () => {
    expect(jpegComponentCount(sof(3))).toBe(3);
    expect(jpegComponentCount(sof(1, 0xc2))).toBe(1);
  });

  it('skips APPn segments before the frame header', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const bytes = new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 4]);
    expect(jpegComponentCount(bytes)).toBe(4);
  });

  it('does not mistake DHT (0xC4) for a frame header', () => {
    const dht = [0xff, 0xc4, 0x00, 0x03, 0x00];
    const bytes = new Uint8Array([0xff, 0xd8, ...dht, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 3]);
    expect(jpegComponentCount(bytes)).toBe(3);
  });

  it('returns null for non-JPEG, empty or truncated input', () => {
    expect(jpegComponentCount(new Uint8Array([]))).toBeNull();
    expect(jpegComponentCount(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegComponentCount(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull();
  });
});
