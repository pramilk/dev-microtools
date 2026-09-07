import { type ToolResult, ok } from './result';
import { parseColor, rgbToHex, rgbToOklch, oklchToRgb, contrastRatio } from './color';

/** Tailwind-style shade scale: 50 is near-white, 950 is near-black. */
export const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ShadeStep = (typeof SHADE_STEPS)[number];

/**
 * Target OKLCH lightness per step. Fixed rather than derived from the base colour, so
 * every generated scale spans the same visual range from near-white to near-black —
 * only hue and chroma come from the colour the visitor entered.
 */
const STEP_LIGHTNESS: Record<ShadeStep, number> = {
  50: 0.98,
  100: 0.95,
  200: 0.9,
  300: 0.82,
  400: 0.71,
  500: 0.6,
  600: 0.5,
  700: 0.42,
  800: 0.32,
  900: 0.24,
  950: 0.15,
};

/**
 * Chroma multiplier per step, relative to the base colour's own chroma. Tapered at both
 * ends: a colour pushed to near-white or near-black can't hold much chroma without
 * either clipping out of gamut or reading as a tinted grey rather than a shade of the
 * original hue, so the peak sits mid-scale where the base colour's chroma fits naturally.
 */
const STEP_CHROMA_FACTOR: Record<ShadeStep, number> = {
  50: 0.12,
  100: 0.25,
  200: 0.45,
  300: 0.65,
  400: 0.85,
  500: 1,
  600: 0.95,
  700: 0.85,
  800: 0.7,
  900: 0.55,
  950: 0.4,
};

export interface Shade {
  step: ShadeStep;
  hex: string;
  /** The step whose target lightness is closest to the base colour's own lightness. */
  isClosestToBase: boolean;
  /** Whichever of black/white text reads better against this shade. */
  textOn: 'black' | 'white';
}

export interface HarmonySet {
  complementary: string[];
  analogous: string[];
  triadic: string[];
  splitComplementary: string[];
  tetradic: string[];
}

export interface PaletteResult {
  baseHex: string;
  shades: Shade[];
  harmonies: HarmonySet;
}

/** Whichever of black/white text reads better on a given hex background. */
export const textOnFor = (hex: string): 'black' | 'white' => {
  const rgb = parseColor(hex);
  if (!rgb.ok) return 'black';
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  return contrastRatio(rgb.value, white) >= contrastRatio(rgb.value, black) ? 'white' : 'black';
};

const hueColors = (l: number, c: number, hues: number[]): string[] =>
  hues.map((h) => rgbToHex(oklchToRgb(l, c, (h + 360) % 360)));

/** Generates an 11-step tint/shade scale and five colour-harmony sets from a base colour. */
export function generatePalette(input: string): ToolResult<PaletteResult> {
  const parsed = parseColor(input);
  if (!parsed.ok) return parsed;

  const rgb = parsed.value;
  const baseOklch = rgbToOklch(rgb);

  const closestStep = SHADE_STEPS.reduce((best, step) =>
    Math.abs(STEP_LIGHTNESS[step] - baseOklch.l) < Math.abs(STEP_LIGHTNESS[best] - baseOklch.l) ? step : best
  );

  const shades: Shade[] = SHADE_STEPS.map((step) => {
    const l = STEP_LIGHTNESS[step];
    const c = baseOklch.c * STEP_CHROMA_FACTOR[step];
    const hex = rgbToHex(oklchToRgb(l, c, baseOklch.h));
    return { step, hex, isClosestToBase: step === closestStep, textOn: textOnFor(hex) };
  });

  const { l, c, h } = baseOklch;
  const harmonies: HarmonySet = {
    complementary: hueColors(l, c, [h, h + 180]),
    analogous: hueColors(l, c, [h - 30, h, h + 30]),
    triadic: hueColors(l, c, [h, h + 120, h + 240]),
    splitComplementary: hueColors(l, c, [h, h + 150, h + 210]),
    tetradic: hueColors(l, c, [h, h + 90, h + 180, h + 270]),
  };

  return ok({ baseHex: rgbToHex(rgb), shades, harmonies });
}

/** Sanitises a free-text palette name into a token-safe identifier, e.g. "Brand Blue" -> "brand-blue". */
export function sanitizePaletteName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'color' : cleaned;
}

export function exportCssVariables(shades: Shade[], name: string): string {
  const safeName = sanitizePaletteName(name);
  const lines = shades.map((shade) => `  --color-${safeName}-${shade.step}: ${shade.hex};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

export function exportTailwindConfig(shades: Shade[], name: string): string {
  const safeName = sanitizePaletteName(name);
  const lines = shades.map((shade) => `    ${shade.step}: '${shade.hex}',`);
  return `${safeName}: {\n${lines.join('\n')}\n  },`;
}

export function exportScssVariables(shades: Shade[], name: string): string {
  const safeName = sanitizePaletteName(name);
  return shades.map((shade) => `$color-${safeName}-${shade.step}: ${shade.hex};`).join('\n');
}

export function exportJson(shades: Shade[]): string {
  const entries = Object.fromEntries(shades.map((shade) => [String(shade.step), shade.hex]));
  return JSON.stringify(entries, null, 2);
}
