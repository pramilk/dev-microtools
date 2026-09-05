import { describe, it, expect } from 'vitest';
import { computeUpscaledDimensions, validateUpscaleTarget, resizeLanczos, MAX_OUTPUT_PIXELS, UPSCALE_MULTIPLIERS } from './imageUpscale';

describe('UPSCALE_MULTIPLIERS', () => {
  it('offers 2x, 4x, 6x and 8x', () => {
    expect(UPSCALE_MULTIPLIERS).toEqual([2, 4, 6, 8]);
  });
});

describe('computeUpscaledDimensions', () => {
  it('multiplies both dimensions by the multiplier', () => {
    expect(computeUpscaledDimensions(300, 200, 2)).toEqual({ width: 600, height: 400 });
    expect(computeUpscaledDimensions(300, 200, 4)).toEqual({ width: 1200, height: 800 });
    expect(computeUpscaledDimensions(300, 200, 6)).toEqual({ width: 1800, height: 1200 });
    expect(computeUpscaledDimensions(300, 200, 8)).toEqual({ width: 2400, height: 1600 });
  });

  it('handles odd source dimensions exactly, with no rounding needed', () => {
    expect(computeUpscaledDimensions(299, 151, 2)).toEqual({ width: 598, height: 302 });
    expect(computeUpscaledDimensions(1, 1, 4)).toEqual({ width: 4, height: 4 });
  });
});

describe('validateUpscaleTarget', () => {
  it('accepts a request comfortably under the pixel cap', () => {
    const result = validateUpscaleTarget(1000, 1000, 2);
    expect(result).toEqual({ ok: true, value: { width: 2000, height: 2000 } });
  });

  it('accepts a request landing exactly at the pixel cap', () => {
    // 8000 * 5000 = 40,000,000 == MAX_OUTPUT_PIXELS exactly.
    const result = validateUpscaleTarget(4000, 2500, 2);
    expect(result.ok).toBe(true);
  });

  it('rejects a request that would exceed the pixel cap', () => {
    const result = validateUpscaleTarget(4000, 4000, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('16,000');
      expect(result.error).toContain('4x');
      expect(result.error).toContain(`${MAX_OUTPUT_PIXELS / 1_000_000}MP`);
    }
  });

  it('rejects 4x but would accept 2x for the same borderline source image', () => {
    // 2000x2000 * 4 = 64MP (over the 40MP cap); * 2 = 16MP (comfortably under it) — a size
    // picked so only the smaller multiplier fits, to prove the cap is evaluated per-multiplier
    // rather than once against the source image alone.
    expect(validateUpscaleTarget(2000, 2000, 4).ok).toBe(false);
    expect(validateUpscaleTarget(2000, 2000, 2).ok).toBe(true);
  });

  it('accepts a small source image at every multiplier, including 6x and 8x', () => {
    // A 500x500 icon/avatar-sized source stays under the cap even at the largest multiplier
    // (500*8 = 4000, 4000x4000 = 16MP) — 6x/8x are meant for exactly this kind of small
    // source, not a way to blow up an already-large photo.
    for (const multiplier of [2, 4, 6, 8] as const) {
      expect(validateUpscaleTarget(500, 500, multiplier).ok).toBe(true);
    }
  });

  it('rejects 8x well before 4x on a modestly sized source, since the cap scales with the square of the multiplier', () => {
    // 1200x1200 * 8 = 9600x9600 = 92MP (over cap); * 4 = 4800x4800 = 23MP (comfortably under).
    expect(validateUpscaleTarget(1200, 1200, 8).ok).toBe(false);
    expect(validateUpscaleTarget(1200, 1200, 4).ok).toBe(true);
  });
});

/** Builds a flat RGBA buffer from a 2D array of `[r,g,b,a]` pixels, row-major — a small,
 *  readable way to hand-construct known test images without a real decoded file. */
function makeImage(rows: number[][][]): { data: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rows[y]![x]!;
      const i = (y * width + x) * 4;
      data[i] = r!;
      data[i + 1] = g!;
      data[i + 2] = b!;
      data[i + 3] = a!;
    }
  }
  return { data, width, height };
}

describe('resizeLanczos', () => {
  it('produces a buffer of exactly the requested output dimensions', () => {
    const src = makeImage([
      [
        [10, 20, 30, 255],
        [40, 50, 60, 255],
      ],
      [
        [70, 80, 90, 255],
        [100, 110, 120, 255],
      ],
    ]);
    const out = resizeLanczos(src.data, src.width, src.height, 8, 6, 4);
    expect(out.length).toBe(8 * 6 * 4);
  });

  it('upscaling a flat, solid-color image reproduces that exact color everywhere', () => {
    // A Lanczos filter's weights always sum to 1 (normalized), so a constant input must map
    // to that same constant output with no overshoot/undershoot anywhere — a strong,
    // easy-to-check correctness property that doesn't depend on any specific pixel layout.
    const width = 5;
    const height = 4;
    const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => [128, 64, 200, 255]));
    const src = makeImage(rows);

    const out = resizeLanczos(src.data, width, height, width * 4, height * 4, 4);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(128);
      expect(out[i + 1]).toBe(64);
      expect(out[i + 2]).toBe(200);
      expect(out[i + 3]).toBe(255);
    }
  });

  it('keeps the four corner pixels close to the source corners (clamp-to-edge, not wraparound)', () => {
    const src = makeImage([
      [
        [255, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 255, 0, 255],
      ],
      [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ],
      [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ],
      [
        [0, 0, 255, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [255, 255, 0, 255],
      ],
    ]);
    const dstWidth = 16;
    const dstHeight = 16;
    const out = resizeLanczos(src.data, 4, 4, dstWidth, dstHeight, 4);

    const pixelAt = (x: number, y: number) => {
      const i = (y * dstWidth + x) * 4;
      return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    };

    // Top-left corner should stay predominantly red, not bleed in from the opposite edge.
    expect(pixelAt(0, 0)[0]!).toBeGreaterThan(150);
    expect(pixelAt(0, 0)[1]!).toBeLessThan(100);
    // Top-right corner should stay predominantly green.
    expect(pixelAt(dstWidth - 1, 0)[1]!).toBeGreaterThan(150);
    // Bottom-left corner should stay predominantly blue.
    expect(pixelAt(0, dstHeight - 1)[2]!).toBeGreaterThan(150);
    // Bottom-right corner should have both red and green (yellow), not the top-left's red.
    expect(pixelAt(dstWidth - 1, dstHeight - 1)[0]!).toBeGreaterThan(150);
    expect(pixelAt(dstWidth - 1, dstHeight - 1)[1]!).toBeGreaterThan(150);
  });

  it('clamps overshoot from the kernel side-lobes into the valid 0-255 range', () => {
    // A sharp black/white edge is exactly the case where Lanczos's negative side-lobes can
    // push a nearby sample below 0 or above 255 — Uint8ClampedArray must clamp it, never wrap
    // or produce out-of-range values.
    const rows = Array.from({ length: 6 }, () => Array.from({ length: 6 }, (_, x) => (x < 3 ? [0, 0, 0, 255] : [255, 255, 255, 255])));
    const src = makeImage(rows);
    const out = resizeLanczos(src.data, 6, 6, 24, 24, 4);
    for (const value of out) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });

  it('handles a 1x1 source image without dividing by zero or producing NaN', () => {
    const src = makeImage([[[10, 20, 30, 255]]]);
    const out = resizeLanczos(src.data, 1, 1, 4, 4, 4);
    for (const value of out) {
      expect(Number.isNaN(value)).toBe(false);
    }
    // A single-pixel source has nothing to resample against — every output pixel should
    // just be that one source color.
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });

  it('handles a single-row (1px tall) source image', () => {
    const src = makeImage([
      [
        [10, 20, 30, 255],
        [200, 100, 50, 255],
      ],
    ]);
    const out = resizeLanczos(src.data, 2, 1, 8, 4, 4);
    expect(out.length).toBe(8 * 4 * 4);
    for (const value of out) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});
