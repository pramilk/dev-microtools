import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRESET,
  PDF_PRESETS,
  PDF_PRESET_IDS,
  maxImagePixels,
  plural,
  presetMatching,
  usesJpegQuality,
} from './pdfCompress';

describe('maxImagePixels', () => {
  it('converts a DPI cap to pixels against the largest page side', () => {
    // US Letter's long side is 792pt = 11in.
    expect(maxImagePixels(150, 792)).toBe(1650);
    expect(maxImagePixels(300, 842)).toBe(3508); // A4
  });

  it('returns null when no cap is set', () => {
    expect(maxImagePixels(null, 792)).toBeNull();
    expect(maxImagePixels(0, 792)).toBeNull();
  });

  it('falls back to an 11-inch page when page size is unknown, and never goes below 16px', () => {
    expect(maxImagePixels(100, 0)).toBe(1100);
    expect(maxImagePixels(1, 10)).toBe(16);
  });
});

describe('presets', () => {
  it('recognises each preset from its own options and the default is Balanced', () => {
    for (const id of PDF_PRESET_IDS) expect(presetMatching(PDF_PRESETS[id].options)).toBe(id);
    expect(DEFAULT_PRESET).toBe('balanced');
  });

  it('reports Custom (null) once any option diverges', () => {
    expect(presetMatching({ ...PDF_PRESETS.balanced.options, quality: 0.71 })).toBeNull();
    expect(presetMatching({ ...PDF_PRESETS.strong.options, grayscale: true })).toBeNull();
  });

  it('orders presets from gentlest to strongest', () => {
    const [light, balanced, strong] = PDF_PRESET_IDS.map((id) => PDF_PRESETS[id].options);
    expect(light.quality).toBeGreaterThan(balanced.quality);
    expect(balanced.quality).toBeGreaterThan(strong.quality);
    expect(light.maxDpi ?? Infinity).toBeGreaterThan(balanced.maxDpi ?? Infinity);
    expect(balanced.maxDpi ?? Infinity).toBeGreaterThan(strong.maxDpi ?? Infinity);
  });
});

describe('usesJpegQuality / plural', () => {
  it('shows the quality slider only when some image can be JPEG', () => {
    expect(usesJpegQuality({ imageFormat: 'jpeg' })).toBe(true);
    expect(usesJpegQuality({ imageFormat: 'match' })).toBe(true);
    expect(usesJpegQuality({ imageFormat: 'lossless' })).toBe(false);
  });

  it('pluralises', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(0, 'page')).toBe('0 pages');
    expect(plural(2, 'duplicate')).toBe('2 duplicates');
  });
});
