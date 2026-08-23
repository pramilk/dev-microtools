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

/** The standard CSS Color Module named colours (plus `transparent`). */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000',
  olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
  plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513',
  salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee',
  sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
  white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** Every name `parseColor` accepts, for building autocomplete UI. */
export const NAMED_COLOR_NAMES: string[] = [...Object.keys(NAMED_COLORS), 'transparent'].sort();

const parseNamed = (input: string): Rgb | null => {
  const key = input.trim().toLowerCase();
  if (key === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = NAMED_COLORS[key];
  return hex ? parseHex(hex) : null;
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

  const parsed =
    parseHex(trimmed) ?? parseNamed(trimmed) ?? parseRgbFunction(trimmed) ?? parseHslFunction(trimmed);
  if (!parsed) {
    return err(
      'Could not read that colour. Try a form like #3cbcd4, rgb(60 188 212), hsl(189 62% 53%), or a CSS name like "rebeccapurple".'
    );
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

/**
 * Finds the closest shade of a colour (same hue and saturation, adjusted lightness)
 * that reaches a given contrast ratio against a white or black background.
 *
 * Darkening reaches further contrast against white, lightening reaches further
 * contrast against black, so each case searches lightness in the direction that
 * can actually succeed, converging on the boundary closest to the original shade.
 */
export function nearestAccessibleShade(
  rgb: Rgb,
  background: 'white' | 'black',
  minRatio = 4.5
): Rgb | null {
  const { h, s } = rgbToHsl(rgb);
  const target = background === 'white' ? WHITE : BLACK;
  const ratioAt = (l: number): number => contrastRatio(hslToRgb(h, s, l, 1), target);

  const bestPossible = background === 'white' ? ratioAt(0) : ratioAt(1);
  if (bestPossible < minRatio) return null;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const passes = ratioAt(mid) >= minRatio;
    if (background === 'white') {
      if (passes) lo = mid;
      else hi = mid;
    } else {
      if (passes) hi = mid;
      else lo = mid;
    }
  }

  return hslToRgb(h, s, background === 'white' ? lo : hi, 1);
}

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
