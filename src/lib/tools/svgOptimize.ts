import type { Config, PluginConfig } from 'svgo/browser';
import { type ToolResult, ok, err, messageFrom } from './result';

/**
 * Bounds how much markup this tool will attempt to parse and optimize client-side. SVGO's
 * parse and plugin passes are synchronous and run on the main thread with no way to show
 * progress.
 */
export const MAX_SVG_INPUT_LENGTH = 2_000_000;

export const MIN_SVG_PRECISION = 1;
export const MAX_SVG_PRECISION = 8;
export const DEFAULT_SVG_PRECISION = 3;

export const MIN_TRANSFORM_PRECISION = 1;
export const MAX_TRANSFORM_PRECISION = 8;
export const DEFAULT_TRANSFORM_PRECISION = 5;

export interface SvgOptimizeOptions {
  /** Decimal places kept in coordinates and other numbers — SVGO's `floatPrecision`, passed down to every plugin that accepts it (`cleanupNumericValues`, `convertPathData`, ...). Lower shrinks the file further at the cost of exactness; higher preserves the shape more faithfully. */
  precision?: number;
  /**
   * Decimal places kept specifically when collapsing `transform="..."` matrices
   * (`convertTransform`/`convertPathData`'s own `transformPrecision`) — a separate knob from
   * `precision` above, because decomposing a transform matrix back into rotate/scale/skew
   * values is more sensitive to rounding error than plain coordinate rounding, so SVGO keeps
   * it independently configurable rather than tying it to the same value.
   */
  transformPrecision?: number;
  /** Runs the optimization passes repeatedly until a pass makes no further change, instead of stopping after one. Strictly finds at least as much savings as a single pass, at the cost of more CPU time — worth disabling only for a very large SVG where that time matters more than the last few bytes. */
  multipass?: boolean;
  /** Keeps any `<desc>` element instead of letting the default preset strip it — real content for screen readers, at the cost of a few more bytes. */
  keepDescription?: boolean;
  /** Prefixes every id (and class name) with a value derived from the file, so pasting several optimized SVGs into one page never collides ids across them. */
  prefixIds?: boolean;
}

// SVGO is only needed once someone actually uses this tool, and its default export
// (`svgo`) pulls in Node-only file-system config loading — the browser entry point is a
// separate subpath. Loaded lazily so it never lands in the shared bundle.
let svgoModule: typeof import('svgo/browser') | null = null;
async function loadSvgo(): Promise<typeof import('svgo/browser')> {
  svgoModule ??= await import('svgo/browser');
  return svgoModule;
}

/**
 * Runs SVGO's default optimization preset. Notably, `removeViewBox` isn't part of that
 * preset in the version of SVGO this tool ships — the viewBox survives untouched, which
 * matters because stripping it is a common cause of an SVG losing its ability to scale
 * responsively (CSS `width: 100%` relies on it) once something else in a pipeline later
 * removes the element's own `width`/`height` attributes too.
 */
export async function optimizeSvg(input: string, options: SvgOptimizeOptions = {}): Promise<ToolResult<string>> {
  const {
    precision = DEFAULT_SVG_PRECISION,
    transformPrecision = DEFAULT_TRANSFORM_PRECISION,
    multipass = true,
    keepDescription = false,
    prefixIds = false,
  } = options;

  if (input.trim() === '') return err('Paste or drop some SVG markup first.');
  if (input.length > MAX_SVG_INPUT_LENGTH) {
    return err(
      `Input is too large to optimize in the browser (${input.length.toLocaleString()} characters, limit ${MAX_SVG_INPUT_LENGTH.toLocaleString()}).`
    );
  }
  if (!/<svg[\s>]/i.test(input)) {
    return err('This doesn\'t look like SVG markup — expected an <svg> root element.');
  }

  try {
    const svgo = await loadSvgo();

    // `transformPrecision` isn't covered by preset-default's own `floatPrecision`
    // passthrough (that only reaches params literally named `floatPrecision`), so reaching
    // it needs an explicit per-plugin override on the two plugins that decompose
    // transform matrices back into rotate/scale/skew values.
    const plugins: PluginConfig[] = [
      {
        name: 'preset-default',
        params: {
          floatPrecision: precision,
          overrides: {
            convertTransform: { transformPrecision },
            convertPathData: { transformPrecision },
            ...(keepDescription ? { removeDesc: false } : {}),
          },
        },
      },
    ];
    // Not part of preset-default — only added when requested, since a caller not embedding
    // multiple SVGs on one page has no id-collision problem for this to solve.
    if (prefixIds) plugins.push({ name: 'prefixIds', params: { prefix: true } });

    const config: Config = { multipass, plugins };
    const result = svgo.optimize(input, config);
    return ok(result.data);
  } catch (error) {
    return err(messageFrom(error, "Couldn't parse that as SVG — check the markup is well-formed XML."));
  }
}
