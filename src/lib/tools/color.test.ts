import { describe, it, expect } from 'vitest';
import {
  parseColor,
  convertColor,
  rgbToHex,
  rgbToHsl,
  contrastRatio,
  luminance,
  nearestAccessibleShade,
  NAMED_COLOR_NAMES,
} from './color';

describe('parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#3cbcd4')).toEqual({ ok: true, value: { r: 60, g: 188, b: 212, a: 1 } });
  });

  it('parses hex without the leading hash', () => {
    expect(parseColor('3cbcd4')).toEqual({ ok: true, value: { r: 60, g: 188, b: 212, a: 1 } });
  });

  it('expands 3-digit shorthand', () => {
    expect(parseColor('#abc')).toEqual({ ok: true, value: { r: 170, g: 187, b: 204, a: 1 } });
  });

  it('parses 8-digit hex with alpha', () => {
    const result = parseColor('#ff000080');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.a).toBeCloseTo(0.502, 2);
  });

  it('parses rgb() in both comma and space syntax', () => {
    expect(parseColor('rgb(60, 188, 212)')).toEqual({
      ok: true,
      value: { r: 60, g: 188, b: 212, a: 1 },
    });
    expect(parseColor('rgb(60 188 212)')).toEqual({
      ok: true,
      value: { r: 60, g: 188, b: 212, a: 1 },
    });
  });

  it('parses rgba() with alpha', () => {
    const result = parseColor('rgba(255, 0, 0, 0.5)');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.a).toBe(0.5);
  });

  it('parses hsl()', () => {
    const result = parseColor('hsl(0 100% 50%)');
    expect(result).toEqual({ ok: true, value: { r: 255, g: 0, b: 0, a: 1 } });
  });

  it('parses hsl with zero saturation as grey', () => {
    expect(parseColor('hsl(0 0% 50%)')).toEqual({
      ok: true,
      value: { r: 128, g: 128, b: 128, a: 1 },
    });
  });

  it('clamps out-of-range rgb channels rather than producing nonsense', () => {
    const result = parseColor('rgb(300 -20 128)');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ r: 255, g: 0, b: 128 });
  });

  it('rejects nonsense with an actionable message', () => {
    const result = parseColor('banana');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/#3cbcd4/);
  });

  it('rejects empty input', () => {
    expect(parseColor('   ').ok).toBe(false);
  });

  it('rejects a hex string of invalid length', () => {
    expect(parseColor('#12345').ok).toBe(false);
  });

  it('parses a CSS named colour', () => {
    expect(parseColor('rebeccapurple')).toEqual({
      ok: true,
      value: { r: 102, g: 51, b: 153, a: 1 },
    });
  });

  it('is case-insensitive for named colours', () => {
    expect(parseColor('RED')).toEqual({ ok: true, value: { r: 255, g: 0, b: 0, a: 1 } });
  });

  it('parses "transparent" as zero alpha', () => {
    const result = parseColor('transparent');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.a).toBe(0);
  });
});

describe('NAMED_COLOR_NAMES', () => {
  it('includes the standard set and transparent', () => {
    expect(NAMED_COLOR_NAMES).toContain('rebeccapurple');
    expect(NAMED_COLOR_NAMES).toContain('cornflowerblue');
    expect(NAMED_COLOR_NAMES).toContain('transparent');
  });

  it('has no duplicates', () => {
    expect(new Set(NAMED_COLOR_NAMES).size).toBe(NAMED_COLOR_NAMES.length);
  });
});

describe('rgbToHex', () => {
  it('round-trips a parsed colour', () => {
    expect(rgbToHex({ r: 60, g: 188, b: 212, a: 1 })).toBe('#3cbcd4');
  });

  it('pads single-digit channels', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0, a: 1 })).toBe('#000000');
  });

  it('appends the alpha channel when it is not fully opaque', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
  });
});

describe('rgbToHsl', () => {
  it('converts pure red', () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0, a: 1 });
    expect(hsl.h).toBeCloseTo(0, 1);
    expect(hsl.s).toBeCloseTo(1, 3);
    expect(hsl.l).toBeCloseTo(0.5, 3);
  });

  it('converts pure green to hue 120', () => {
    expect(rgbToHsl({ r: 0, g: 255, b: 0, a: 1 }).h).toBeCloseTo(120, 1);
  });

  it('converts pure blue to hue 240', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 255, a: 1 }).h).toBeCloseTo(240, 1);
  });

  it('reports zero saturation for greys', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128, a: 1 }).s).toBe(0);
  });
});

describe('contrastRatio', () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };

  it('reports the maximum ratio of 21 for black on white', () => {
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
  });

  it('reports 1 for a colour against itself', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const a = { r: 60, g: 188, b: 212, a: 1 };
    expect(contrastRatio(a, black)).toBeCloseTo(contrastRatio(black, a), 10);
  });
});

describe('luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 5);
    expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
  });
});

describe('convertColor', () => {
  it('renders every notation for one colour', () => {
    const result = convertColor('#3cbcd4');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hex).toBe('#3cbcd4');
      expect(result.value.rgb).toBe('rgb(60 188 212)');
      expect(result.value.hsl).toMatch(/^hsl\(/);
      expect(result.value.oklch).toMatch(/^oklch\(/);
    }
  });

  it('includes contrast ratios against white and black', () => {
    const result = convertColor('#ffffff');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contrastWhite).toBeCloseTo(1, 1);
      expect(result.value.contrastBlack).toBeCloseTo(21, 0);
    }
  });

  it('carries alpha through to every notation', () => {
    const result = convertColor('rgba(255,0,0,0.5)');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rgb).toContain('/');
      expect(result.value.hsl).toContain('/');
    }
  });

  it('propagates a parse failure', () => {
    expect(convertColor('nope').ok).toBe(false);
  });
});

describe('nearestAccessibleShade', () => {
  it('finds a shade that reaches the requested contrast against white', () => {
    const shade = nearestAccessibleShade({ r: 200, g: 200, b: 200, a: 1 }, 'white', 4.5);
    expect(shade).not.toBeNull();
    if (shade) expect(contrastRatio(shade, { r: 255, g: 255, b: 255, a: 1 })).toBeGreaterThanOrEqual(4.45);
  });

  it('finds a shade that reaches the requested contrast against black', () => {
    const shade = nearestAccessibleShade({ r: 60, g: 60, b: 60, a: 1 }, 'black', 4.5);
    expect(shade).not.toBeNull();
    if (shade) expect(contrastRatio(shade, { r: 0, g: 0, b: 0, a: 1 })).toBeGreaterThanOrEqual(4.45);
  });

  it('suggests a darker shade when the original is too light against white', () => {
    const original = { r: 220, g: 220, b: 220, a: 1 };
    const shade = nearestAccessibleShade(original, 'white');
    expect(shade).not.toBeNull();
    if (shade) expect(rgbToHsl(shade).l).toBeLessThan(rgbToHsl(original).l);
  });

  it('suggests a lighter shade when the original is too dark against black', () => {
    const original = { r: 30, g: 30, b: 30, a: 1 };
    const shade = nearestAccessibleShade(original, 'black');
    expect(shade).not.toBeNull();
    if (shade) expect(rgbToHsl(shade).l).toBeGreaterThan(rgbToHsl(original).l);
  });

  it('preserves hue and saturation', () => {
    const original = { r: 60, g: 188, b: 212, a: 1 };
    const { h: h0, s: s0 } = rgbToHsl(original);
    const shade = nearestAccessibleShade(original, 'white');
    expect(shade).not.toBeNull();
    if (shade) {
      const { h, s } = rgbToHsl(shade);
      expect(h).toBeCloseTo(h0, 0);
      expect(s).toBeCloseTo(s0, 1);
    }
  });
});
