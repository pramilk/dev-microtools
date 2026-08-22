import { type ToolResult, ok, err } from './result';

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0-1. Defaults to 1 when the input format carries no alpha. */
  a: number;
}

export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  oklch: string;
  /** Contrast ratio against white and black, for accessibility decisions. */
  contrastWhite: number;
  contrastBlack: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, places = 0): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/* ------------------------------------------------------------------ parsing */

const parseHex = (input: string): Rgb | null => {
  const match = /^#?([0-9a-f]{3,8})$/i.exec(input.trim());
  if (!match) return null;

  let hex = match[1]!;
  // Expand shorthand: #abc -> #aabbcc, #abcd -> #aabbccdd
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (hex.length !== 6 && hex.length !== 8) return null;

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
};

const parseRgbFunction = (input: string): Rgb | null => {
  const match = /^rgba?\(([^)]+)\)$/i.exec(input.trim());
  if (!match) return null;

  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;

  const channel = (raw: string): number | null => {
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return null;
    return raw.trim().endsWith('%') ? clamp((value / 100) * 255, 0, 255) : clamp(value, 0, 255);
  };

  const r = channel(parts[0]!);
  const g = channel(parts[1]!);
  const b = channel(parts[2]!);
  if (r === null || g === null || b === null) return null;

  let a = 1;
  if (parts[3] !== undefined) {
    const raw = parts[3];
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return null;
    a = clamp(raw.trim().endsWith('%') ? value / 100 : value, 0, 1);
  }

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
};

const hslToRgb = (h: number, s: number, l: number, a: number): Rgb => {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;

  const [r1, g1, b1] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    a,
  };
};

const parseHslFunction = (input: string): Rgb | null => {
  const match = /^hsla?\(([^)]+)\)$/i.exec(input.trim());
  if (!match) return null;

  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;

  const h = Number.parseFloat(parts[0]!);
  const s = Number.parseFloat(parts[1]!) / 100;
  const l = Number.parseFloat(parts[2]!) / 100;
  if ([h, s, l].some(Number.isNaN)) return null;

  let a = 1;
  if (parts[3] !== undefined) {
    const raw = parts[3];
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return null;
    a = clamp(raw.trim().endsWith('%') ? value / 100 : value, 0, 1);
  }

  return hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1), a);
};

/** Accepts hex, rgb()/rgba(), and hsl()/hsla() in both comma and space syntax. */
export function parseColor(input: string): ToolResult<Rgb> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a colour — hex, rgb() or hsl().');

  const parsed = parseHex(trimmed) ?? parseRgbFunction(trimmed) ?? parseHslFunction(trimmed);
  if (!parsed) {
    return err('Could not read that colour. Try a form like #3cbcd4, rgb(60 188 212) or hsl(189 62% 53%).');
  }
  return ok(parsed);
}

/* --------------------------------------------------------------- conversion */

export const rgbToHex = ({ r, g, b, a }: Rgb): string => {
  const pair = (value: number): string => Math.round(value).toString(16).padStart(2, '0');
  const base = `#${pair(r)}${pair(g)}${pair(b)}`;
  return a < 1 ? `${base}${pair(a * 255)}` : base;
};

export const rgbToHsl = ({ r, g, b }: Rgb): { h: number; s: number; l: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn
      ? 60 * (((gn - bn) / delta) % 6)
      : max === gn
        ? 60 * ((bn - rn) / delta + 2)
        : 60 * ((rn - gn) / delta + 4);

  return { h: (h + 360) % 360, s, l };
};

/** sRGB -> linear light, the first step of both OKLab and contrast maths. */
const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Converts to OKLCH, the perceptually-uniform space modern CSS prefers. */
export const rgbToOklch = ({ r, g, b }: Rgb): { l: number; c: number; h: number } => {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;

  return { l: okL, c: chroma, h: hue };
};

/** WCAG relative luminance. */
export const luminance = ({ r, g, b }: Rgb): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG contrast ratio between two colours. Ranges from 1 to 21. */
export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const la = luminance(a);
  const lb = luminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
};

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };

/** Renders one colour in every supported notation. */
export function convertColor(input: string): ToolResult<ColorFormats> {
  const parsed = parseColor(input);
  if (!parsed.ok) return parsed;

  const rgb = parsed.value;
  const { h, s, l } = rgbToHsl(rgb);
  const oklch = rgbToOklch(rgb);
  const alpha = rgb.a < 1 ? ` / ${round(rgb.a, 3)}` : '';

  return ok({
    hex: rgbToHex(rgb),
    rgb: `rgb(${rgb.r} ${rgb.g} ${rgb.b}${alpha})`,
    hsl: `hsl(${round(h, 1)} ${round(s * 100, 1)}% ${round(l * 100, 1)}%${alpha})`,
    oklch: `oklch(${round(oklch.l * 100, 2)}% ${round(oklch.c, 4)} ${round(oklch.h, 2)}${alpha})`,
    contrastWhite: round(contrastRatio(rgb, WHITE), 2),
    contrastBlack: round(contrastRatio(rgb, BLACK), 2),
  });
}
