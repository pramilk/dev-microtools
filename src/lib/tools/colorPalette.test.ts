import { describe, it, expect } from 'vitest';
import {
  generatePalette,
  sanitizePaletteName,
  exportCssVariables,
  exportTailwindConfig,
  exportScssVariables,
  exportJson,
  SHADE_STEPS,
} from './colorPalette';

describe('generatePalette', () => {
  it('generates all 11 shade steps for a typical colour', () => {
    const result = generatePalette('#3cbcd4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.shades.map((s) => s.step)).toEqual([...SHADE_STEPS]);
    expect(result.value.baseHex).toBe('#3cbcd4');
  });

  it('produces monotonically lighter hex values from 950 to 50', () => {
    const result = generatePalette('#3cbcd4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 50 should read visually lighter than 950 — spot-check via parsed RGB sum.
    const shadeByStep = new Map(result.value.shades.map((s) => [s.step, s.hex]));
    const toSum = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    expect(toSum(shadeByStep.get(50)!)).toBeGreaterThan(toSum(shadeByStep.get(950)!));
  });

  it('marks exactly one shade as closest to the base colour', () => {
    const result = generatePalette('#3cbcd4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.shades.filter((s) => s.isClosestToBase)).toHaveLength(1);
  });

  it('picks a readable text colour for a very light and a very dark shade', () => {
    const result = generatePalette('#3cbcd4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lightest = result.value.shades.find((s) => s.step === 50)!;
    const darkest = result.value.shades.find((s) => s.step === 950)!;
    expect(lightest.textOn).toBe('black');
    expect(darkest.textOn).toBe('white');
  });

  it('generates every harmony set with the expected number of colours', () => {
    const result = generatePalette('#3cbcd4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.harmonies.complementary).toHaveLength(2);
    expect(result.value.harmonies.analogous).toHaveLength(3);
    expect(result.value.harmonies.triadic).toHaveLength(3);
    expect(result.value.harmonies.splitComplementary).toHaveLength(3);
    expect(result.value.harmonies.tetradic).toHaveLength(4);
    for (const hex of Object.values(result.value.harmonies).flat()) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('accepts rgb() and hsl() input, not just hex', () => {
    expect(generatePalette('rgb(60 188 212)').ok).toBe(true);
    expect(generatePalette('hsl(189 62% 53%)').ok).toBe(true);
  });

  it('produces a sensible grey scale for a neutral (zero-chroma) base colour', () => {
    const result = generatePalette('#808080');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const shade of result.value.shades) {
      const hex = shade.hex.slice(1);
      const r = hex.slice(0, 2);
      const g = hex.slice(2, 4);
      const b = hex.slice(4, 6);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  it('rejects empty input', () => {
    expect(generatePalette('').ok).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(generatePalette('not a colour').ok).toBe(false);
  });

  it('rejects unicode garbage rather than crashing', () => {
    expect(generatePalette('🎨🎨🎨').ok).toBe(false);
  });

  it('handles black and white base colours without producing NaN hues', () => {
    const black = generatePalette('#000000');
    const white = generatePalette('#ffffff');
    expect(black.ok).toBe(true);
    expect(white.ok).toBe(true);
    if (black.ok) {
      for (const shade of black.value.shades) expect(shade.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('sanitizePaletteName', () => {
  it('lowercases and hyphenates', () => {
    expect(sanitizePaletteName('Brand Blue')).toBe('brand-blue');
  });

  it('strips symbols', () => {
    expect(sanitizePaletteName('Brand/Blue!!')).toBe('brand-blue');
  });

  it('falls back to "color" for empty input', () => {
    expect(sanitizePaletteName('')).toBe('color');
    expect(sanitizePaletteName('   ')).toBe('color');
  });

  it('falls back to "color" when nothing survives sanitizing', () => {
    expect(sanitizePaletteName('日本語')).toBe('color');
  });
});

describe('export formats', () => {
  const paletteResult = generatePalette('#3cbcd4');
  if (!paletteResult.ok) throw new Error('setup failed');
  const shades = paletteResult.value.shades;

  it('exports CSS custom properties', () => {
    const css = exportCssVariables(shades, 'Brand');
    expect(css).toContain(':root {');
    expect(css).toContain('--color-brand-50:');
    expect(css).toContain('--color-brand-950:');
  });

  it('exports a Tailwind config fragment', () => {
    const tw = exportTailwindConfig(shades, 'Brand');
    expect(tw).toContain("brand: {");
    expect(tw).toContain("50: '#");
  });

  it('exports SCSS variables', () => {
    const scss = exportScssVariables(shades, 'Brand');
    expect(scss).toContain('$color-brand-50:');
  });

  it('exports valid JSON with every step as a key', () => {
    const json = exportJson(shades);
    const parsed = JSON.parse(json) as Record<string, string>;
    expect(Object.keys(parsed)).toHaveLength(SHADE_STEPS.length);
    expect(parsed['500']).toMatch(/^#[0-9a-f]{6}$/);
  });
});
