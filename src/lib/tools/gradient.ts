import { type ToolResult, ok, err } from './result';
import { parseColor, rgbToHex } from './color';

export const GRADIENT_TYPES = ['linear', 'radial', 'conic'] as const;
export type GradientType = (typeof GRADIENT_TYPES)[number];

export interface GradientStop {
  /** Any format `parseColor` accepts — hex, rgb()/rgba(), hsl()/hsla(), or a CSS name. */
  color: string;
  /** 0-100 */
  position: number;
}

export interface GradientOptions {
  type: GradientType;
  /** Degrees, linear gradients only. */
  angle: number;
  /** radial gradients only. */
  shape: 'circle' | 'ellipse';
  /** radial/conic gradients only, e.g. "center", "top left". */
  position: string;
  stops: GradientStop[];
}

export const DEFAULT_GRADIENT_OPTIONS: GradientOptions = {
  type: 'linear',
  angle: 90,
  shape: 'ellipse',
  position: 'center',
  stops: [
    { color: '#3cbcd4', position: 0 },
    { color: '#6b21a8', position: 100 },
  ],
};

export interface GradientPreset {
  name: string;
  stops: GradientStop[];
}

/** Starting colour combinations for the gallery — applied on top of whatever type/angle is already selected. */
export const GRADIENT_PRESETS: GradientPreset[] = [
  { name: 'Ocean', stops: [{ color: '#2193b0', position: 0 }, { color: '#6dd5ed', position: 100 }] },
  { name: 'Sunset', stops: [{ color: '#ff512f', position: 0 }, { color: '#f09819', position: 100 }] },
  { name: 'Candy', stops: [{ color: '#ff9a9e', position: 0 }, { color: '#fad0c4', position: 100 }] },
  { name: 'Purple haze', stops: [{ color: '#7f00ff', position: 0 }, { color: '#e100ff', position: 100 }] },
  { name: 'Mint', stops: [{ color: '#00b09b', position: 0 }, { color: '#96c93d', position: 100 }] },
  { name: 'Mono', stops: [{ color: '#232526', position: 0 }, { color: '#414345', position: 100 }] },
  {
    name: 'Aurora',
    stops: [
      { color: '#00c6ff', position: 0 },
      { color: '#7f00ff', position: 50 },
      { color: '#ff00c8', position: 100 },
    ],
  },
];

/** Renders each stop's colour through the shared parser so any accepted format normalises to hex. */
function renderStops(stops: GradientStop[]): ToolResult<string> {
  if (stops.length < 2) return err('A gradient needs at least two colour stops.');

  const rendered: string[] = [];
  for (const stop of stops) {
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 100) {
      return err(`Stop position ${stop.position} is out of range — positions must be between 0 and 100.`);
    }
    const parsed = parseColor(stop.color);
    if (!parsed.ok) return err(`Could not read colour "${stop.color}" — ${parsed.error}`);
    rendered.push(`${rgbToHex(parsed.value)} ${stop.position}%`);
  }
  return ok(rendered.join(', '));
}

/** Builds a CSS `background` value from the given gradient options. */
export function buildGradientCss(options: GradientOptions): ToolResult<string> {
  const stopsResult = renderStops(options.stops);
  if (!stopsResult.ok) return stopsResult;
  const stops = stopsResult.value;

  if (options.type === 'linear') {
    return ok(`linear-gradient(${options.angle}deg, ${stops})`);
  }
  if (options.type === 'radial') {
    return ok(`radial-gradient(${options.shape} at ${options.position}, ${stops})`);
  }
  return ok(`conic-gradient(from ${options.angle}deg at ${options.position}, ${stops})`);
}

/** Full copy-pasteable declaration, including the `background` property name. */
export function buildGradientDeclaration(options: GradientOptions): ToolResult<string> {
  const css = buildGradientCss(options);
  if (!css.ok) return css;
  return ok(`background: ${css.value};`);
}
