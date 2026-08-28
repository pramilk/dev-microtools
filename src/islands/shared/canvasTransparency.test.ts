import { describe, it, expect, vi } from 'vitest';
import { canvasHasTransparency } from './canvasTransparency';

/**
 * jsdom has no real 2D canvas, and this function only ever touches `getImageData`, so a
 * stub context returning a hand-built RGBA buffer is the whole environment it needs.
 */
function contextReturning(data: Uint8ClampedArray): CanvasRenderingContext2D {
  return {
    getImageData: vi.fn(() => ({ data })),
  } as unknown as CanvasRenderingContext2D;
}

/** `width * height` opaque white pixels, with the alpha of `transparentAt` knocked down. */
function pixels(count: number, transparentAt?: { index: number; alpha: number }): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4).fill(255);
  if (transparentAt) data[transparentAt.index * 4 + 3] = transparentAt.alpha;
  return data;
}

describe('canvasHasTransparency', () => {
  it('reports false when every pixel is fully opaque', () => {
    expect(canvasHasTransparency(contextReturning(pixels(16)), 4, 4)).toBe(false);
  });

  it('reports true for a fully transparent pixel', () => {
    const data = pixels(16, { index: 7, alpha: 0 });
    expect(canvasHasTransparency(contextReturning(data), 4, 4)).toBe(true);
  });

  it('reports true for a merely semi-transparent pixel', () => {
    // Anything below 255 loses information when flattened onto a JPEG background, so
    // alpha 254 has to count as transparency just as much as alpha 0 does.
    const data = pixels(16, { index: 0, alpha: 254 });
    expect(canvasHasTransparency(contextReturning(data), 4, 4)).toBe(true);
  });

  it('finds transparency in the very last pixel', () => {
    // Guards the loop bound: an off-by-one on `i < data.length` would miss this one.
    const data = pixels(16, { index: 15, alpha: 0 });
    expect(canvasHasTransparency(contextReturning(data), 4, 4)).toBe(true);
  });

  it('ignores non-alpha channels that happen to be zero', () => {
    // A pure black opaque pixel is R=0 G=0 B=0 A=255 — scanning the wrong offset would
    // read one of those zeroes and wrongly call an opaque image transparent.
    const data = pixels(4);
    data[0] = 0;
    data[1] = 0;
    data[2] = 0;
    expect(canvasHasTransparency(contextReturning(data), 2, 2)).toBe(false);
  });

  it('reports false for an empty canvas rather than throwing', () => {
    expect(canvasHasTransparency(contextReturning(new Uint8ClampedArray(0)), 0, 0)).toBe(false);
  });

  it('scans the full requested region', () => {
    const context = contextReturning(pixels(1024 * 4));
    expect(canvasHasTransparency(context, 128, 32)).toBe(false);
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 128, 32);
  });
});
