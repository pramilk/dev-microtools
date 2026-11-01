import { describe, it, expect } from 'vitest';
import { BLANK_INK_RATIO, inkCoverage, looksBlank } from './blankPage';

/** A `width`×`height` RGBA image, white unless `ink` says otherwise. */
function image(width: number, height: number, ink: (x: number, y: number) => [number, number, number, number] | null = () => null): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = ink(x, y);
      if (pixel) data.set(pixel, (y * width + x) * 4);
    }
  }
  return data;
}

describe('inkCoverage', () => {
  it('is zero for white paper, one for a black page', () => {
    expect(inkCoverage(image(100, 100), 100, 100)).toBe(0);
    expect(inkCoverage(image(100, 100, () => [0, 0, 0, 255]), 100, 100)).toBe(1);
  });

  it('treats off-white scanned paper and transparency as paper', () => {
    expect(inkCoverage(image(50, 50, () => [236, 232, 220, 255]), 50, 50)).toBe(0);
    expect(inkCoverage(image(50, 50, () => [0, 0, 0, 0]), 50, 50)).toBe(0);
  });

  it('ignores dark scanner borders in the margin', () => {
    const bordered = image(100, 100, (x, y) => (x < 4 || y < 4 || x > 95 || y > 95 ? [0, 0, 0, 255] : null));
    expect(inkCoverage(bordered, 100, 100)).toBe(0);
    expect(inkCoverage(bordered, 100, 100, 0)).toBeGreaterThan(0.05);
  });

  it('handles empty and tiny images', () => {
    expect(inkCoverage(new Uint8ClampedArray(0), 0, 0)).toBe(0);
    expect(inkCoverage(image(1, 1, () => [0, 0, 0, 255]), 1, 1)).toBe(1);
  });

  it('handles a large image', () => {
    expect(inkCoverage(image(2000, 2800), 2000, 2800)).toBe(0);
  });
});

describe('looksBlank', () => {
  it('calls a page with a few specks blank, but not one with a line of text', () => {
    // 150×200, like the measuring render: three specks of dust.
    const specks = image(150, 200, (x, y) => ((x === 40 && y === 50) || (x === 90 && y === 120) || (x === 70 && y === 160) ? [30, 30, 30, 255] : null));
    expect(looksBlank(inkCoverage(specks, 150, 200))).toBe(true);
    // A short line of text: a 60×3 dark strip.
    const line = image(150, 200, (x, y) => (x >= 40 && x < 100 && y >= 30 && y < 33 ? [20, 20, 20, 255] : null));
    expect(looksBlank(inkCoverage(line, 150, 200))).toBe(false);
    expect(looksBlank(BLANK_INK_RATIO)).toBe(false);
  });
});
