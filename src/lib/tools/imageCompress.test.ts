import { describe, it, expect, vi } from 'vitest';
import { validateImageFile, computeTargetDimensions, qualityToColorCount, quantizePngPixels, MAX_INPUT_FILE_SIZE, type RgbaImageData } from './imageCompress';

describe('validateImageFile', () => {
  it('accepts a JPEG under the size limit', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1024, name: 'photo.jpg' })).toEqual({ ok: true, value: true });
  });

  it('accepts a PNG and a WebP under the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: 1024, name: 'a.png' }).ok).toBe(true);
    expect(validateImageFile({ type: 'image/webp', size: 1024, name: 'a.webp' }).ok).toBe(true);
  });

  it('allows a file with no declared type through when its extension still looks like an image', () => {
    expect(validateImageFile({ type: '', size: 1024, name: 'photo.jpg' })).toEqual({ ok: true, value: true });
  });

  it('rejects a file with no declared type and no recognizable image extension, instead of waving it through unconditionally', () => {
    // This is the actual hole that let drag-and-dropping a non-image file (which bypasses an
    // <input accept> filter entirely — that only constrains the file-picker dialog) succeed:
    // many non-image files also arrive with a blank `type` from certain drag sources.
    const result = validateImageFile({ type: '', size: 1024, name: 'resume.docx' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't look like an image/i);
  });

  it('rejects an animated-capable GIF with a message explaining why, not a generic error', () => {
    const result = validateImageFile({ type: 'image/gif', size: 1024, name: 'a.gif' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/animation/i);
  });

  it('rejects SVG and points to the SVG Optimizer instead', () => {
    const result = validateImageFile({ type: 'image/svg+xml', size: 1024, name: 'a.svg' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/svg optimizer/i);
  });

  it('rejects a non-image file with a declared type', () => {
    const result = validateImageFile({ type: 'application/pdf', size: 1024, name: 'doc.pdf' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not an image/i);
  });

  it('rejects a file over the size limit', () => {
    const result = validateImageFile({ type: 'image/png', size: MAX_INPUT_FILE_SIZE + 1, name: 'huge.png' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_INPUT_FILE_SIZE, name: 'edge.png' }).ok).toBe(true);
  });
});

describe('computeTargetDimensions', () => {
  it('leaves dimensions unchanged when no cap is given', () => {
    expect(computeTargetDimensions(1000, 500, null)).toEqual({ width: 1000, height: 500 });
  });

  it('leaves dimensions unchanged when the cap is non-positive', () => {
    expect(computeTargetDimensions(1000, 500, 0)).toEqual({ width: 1000, height: 500 });
    expect(computeTargetDimensions(1000, 500, -10)).toEqual({ width: 1000, height: 500 });
  });

  it('leaves dimensions unchanged when the image is already within the cap', () => {
    expect(computeTargetDimensions(400, 300, 1000)).toEqual({ width: 400, height: 300 });
  });

  it('downscales a landscape image, preserving aspect ratio', () => {
    expect(computeTargetDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it('downscales a portrait image against its taller side', () => {
    expect(computeTargetDimensions(1000, 2000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it('downscales a square image', () => {
    expect(computeTargetDimensions(2000, 2000, 500)).toEqual({ width: 500, height: 500 });
  });

  it('caps the longer side exactly when the image is already square at the cap', () => {
    expect(computeTargetDimensions(500, 500, 500)).toEqual({ width: 500, height: 500 });
  });

  it('never rounds a dimension down to zero for an extreme aspect ratio', () => {
    const result = computeTargetDimensions(10000, 1, 10);
    expect(result.width).toBe(10);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe('qualityToColorCount', () => {
  it('maps full quality to the maximum palette size', () => {
    expect(qualityToColorCount(1)).toBe(256);
  });

  it('maps the lowest quality to the minimum palette size', () => {
    expect(qualityToColorCount(0.01)).toBe(2);
  });

  it('is monotonically non-decreasing as quality rises', () => {
    const counts = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map(qualityToColorCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
  });

  it('clamps quality values outside the 0-1 range instead of producing a nonsensical count', () => {
    expect(qualityToColorCount(2)).toBe(256);
    expect(qualityToColorCount(-1)).toBe(2);
  });

  it('is not linear — the midpoint quality maps well below the midpoint of the color range', () => {
    // A linear mapping would put quality 0.5 at ~129 colors (the midpoint of 2-256); the
    // curve is deliberately weighted so the slider's useful middle spans more color counts.
    expect(qualityToColorCount(0.5)).toBeLessThan(129);
  });
});

/** Builds a synthetic RGBA buffer with `count` distinct, evenly-spaced colors (repeated to
 *  fill the requested dimensions), so quantization has real palette-reduction work to do. */
function buildDistinctColorImage(width: number, height: number, count: number): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = i % count;
    const shade = Math.round((c / Math.max(1, count - 1)) * 255);
    data[i * 4] = shade;
    data[i * 4 + 1] = 255 - shade;
    data[i * 4 + 2] = (shade * 7) % 256;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function countDistinctColors(image: RgbaImageData): number {
  const seen = new Set<number>();
  for (let i = 0; i < image.data.length; i += 4) {
    seen.add((image.data[i]! << 24) | (image.data[i + 1]! << 16) | (image.data[i + 2]! << 8) | image.data[i + 3]!);
  }
  return seen.size;
}

describe('quantizePngPixels', () => {
  it('reduces a busy image to no more than the color count its quality maps to', async () => {
    const image = buildDistinctColorImage(8, 8, 64);
    const quality = 0.2;
    const result = await quantizePngPixels(image, quality);

    expect(result.width).toBe(image.width);
    expect(result.height).toBe(image.height);
    expect(countDistinctColors(result)).toBeLessThanOrEqual(qualityToColorCount(quality));
  });

  it('keeps a fully opaque image opaque', async () => {
    const image = buildDistinctColorImage(4, 4, 16);
    const result = await quantizePngPixels(image, 0.5);

    for (let i = 3; i < result.data.length; i += 4) expect(result.data[i]).toBe(255);
  });

  it('round-trips a fully transparent image without throwing', async () => {
    const image: RgbaImageData = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    const result = await quantizePngPixels(image, 0.5);

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    for (let i = 3; i < result.data.length; i += 4) expect(result.data[i]).toBe(0);
  });

  it('resolves without throwing for a degenerate zero-size image', async () => {
    const image: RgbaImageData = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    await expect(quantizePngPixels(image, 0.5)).resolves.toBeTruthy();
  });

  it('handles a larger image and returns correctly-sized output', async () => {
    const image = buildDistinctColorImage(64, 64, 200);
    const result = await quantizePngPixels(image, 0.7);

    expect(result.data.length).toBe(64 * 64 * 4);
  });

  it('falls back to the original, un-quantized pixels if the quantizer module fails to load', async () => {
    vi.resetModules();
    vi.doMock('image-q', () => {
      throw new Error('module failed to load');
    });

    const { quantizePngPixels: quantizeWithBrokenModule } = await import('./imageCompress');
    const image: RgbaImageData = { data: new Uint8ClampedArray([10, 20, 30, 40]), width: 1, height: 1 };
    const result = await quantizeWithBrokenModule(image, 0.5);

    expect(result).toEqual(image);

    vi.doUnmock('image-q');
    vi.resetModules();
  });
});
