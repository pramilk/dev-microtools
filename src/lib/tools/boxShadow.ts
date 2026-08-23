import { type ToolResult, ok, err } from './result';
import { parseColor, type Rgb } from './color';

export interface ShadowLayer {
  offsetX: number;
  offsetY: number;
  /** Must be >= 0 — CSS treats a negative blur as invalid and drops the declaration. */
  blur: number;
  spread: number;
  /** Any format `parseColor` accepts. */
  color: string;
  inset: boolean;
}

export const DEFAULT_SHADOW_LAYER: ShadowLayer = {
  offsetX: 0,
  offsetY: 4,
  blur: 12,
  spread: 0,
  color: 'rgba(0, 0, 0, 0.35)',
  inset: false,
};

export interface ShadowPreset {
  name: string;
  layers: ShadowLayer[];
}

/** Starting points for common shadow styles — a gallery, not a replacement for the sliders. */
export const SHADOW_PRESETS: ShadowPreset[] = [
  { name: 'Soft', layers: [{ offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: 'rgba(0, 0, 0, 0.35)', inset: false }] },
  {
    name: 'Elevated',
    layers: [
      { offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: 'rgba(0, 0, 0, 0.24)', inset: false },
      { offsetX: 0, offsetY: 8, blur: 24, spread: -4, color: 'rgba(0, 0, 0, 0.28)', inset: false },
    ],
  },
  { name: 'Sharp', layers: [{ offsetX: 4, offsetY: 4, blur: 0, spread: 0, color: 'rgba(0, 0, 0, 0.9)', inset: false }] },
  { name: 'Long shadow', layers: [{ offsetX: 10, offsetY: 10, blur: 0, spread: 0, color: 'rgba(0, 0, 0, 0.15)', inset: false }] },
  {
    name: 'Neumorphic',
    layers: [
      { offsetX: -8, offsetY: -8, blur: 16, spread: 0, color: 'rgba(255, 255, 255, 0.6)', inset: false },
      { offsetX: 8, offsetY: 8, blur: 16, spread: 0, color: 'rgba(0, 0, 0, 0.25)', inset: false },
    ],
  },
  { name: 'Pressed', layers: [{ offsetX: 0, offsetY: 2, blur: 4, spread: 0, color: 'rgba(0, 0, 0, 0.35)', inset: true }] },
  { name: 'Glow', layers: [{ offsetX: 0, offsetY: 0, blur: 24, spread: 4, color: 'rgba(60, 188, 212, 0.55)', inset: false }] },
];

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Renders a colour (with its own alpha, or an override) as `rgb(r g b / a)`. */
function rgbaCss(rgb: Rgb): string {
  const alpha = rgb.a < 1 ? ` / ${round(rgb.a)}` : '';
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b}${alpha})`;
}

function renderLayer(layer: ShadowLayer): ToolResult<string> {
  if (!Number.isFinite(layer.blur) || layer.blur < 0) {
    return err('Blur radius cannot be negative — CSS silently ignores a box-shadow with one.');
  }
  const parsed = parseColor(layer.color);
  if (!parsed.ok) return err(`Could not read colour "${layer.color}" — ${parsed.error}`);

  const parts = [
    `${layer.offsetX}px`,
    `${layer.offsetY}px`,
    `${layer.blur}px`,
    `${layer.spread}px`,
    rgbaCss(parsed.value),
  ];
  if (layer.inset) parts.unshift('inset');
  return ok(parts.join(' '));
}

/** Builds a CSS `box-shadow` value from one or more layers, outermost layer first. */
export function buildBoxShadowCss(layers: ShadowLayer[]): ToolResult<string> {
  if (layers.length === 0) return err('Add at least one shadow layer.');

  const rendered: string[] = [];
  for (const layer of layers) {
    const result = renderLayer(layer);
    if (!result.ok) return result;
    rendered.push(result.value);
  }
  return ok(rendered.join(', '));
}

/** Full copy-pasteable declaration, including the `box-shadow` property name. */
export function buildBoxShadowDeclaration(layers: ShadowLayer[]): ToolResult<string> {
  const css = buildBoxShadowCss(layers);
  if (!css.ok) return css;
  return ok(`box-shadow: ${css.value};`);
}
