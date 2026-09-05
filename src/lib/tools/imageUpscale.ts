import { type ToolResult, ok, err } from './result';

export { validateImageFile, MAX_INPUT_FILE_SIZE } from './imageCompress';
export type { RgbaImageData } from './imageCompress';

/** A fixed choice of multipliers keeps the UI a simple toggle, matching every other
 *  "instant calculator" control on this site, rather than a free-form multiplier field. 2x
 *  and 4x match the reference this tool is modeled on (iloveimg's Upscale Image); 6x and 8x
 *  extend it further for a small source image (an icon, an avatar) where a bigger jump is
 *  still comfortably under `MAX_OUTPUT_PIXELS` — the cap below, not this list, is what
 *  actually stops an unreasonably large result. */
export type UpscaleMultiplier = 2 | 4 | 6 | 8;
export const UPSCALE_MULTIPLIERS: readonly UpscaleMultiplier[] = [2, 4, 6, 8];

/** A canvas-backed pixel buffer can only grow so far before a browser tab risks running out
 *  of memory or hanging for tens of seconds on the resample itself — 40 megapixels of RGBA
 *  output is ~160MB for the pixel buffer alone (before the encoder's own working memory),
 *  comfortably under every major browser's own canvas pixel-count ceiling (Chrome's is
 *  ~268 million). Generous at the smaller multipliers (a 4x upscale stays under this cap
 *  for any source up to roughly 3160×3160, 2x up to roughly 4470×4470) and, by design, far
 *  more restrictive at 6x/8x (roughly 1050×1050 and 790×790 respectively) — those two are
 *  meant for small source images, not a way to blow a modest photo up to poster size. */
export const MAX_OUTPUT_PIXELS = 40_000_000;

/**
 * The exact output size a given multiplier produces — pure arithmetic, but centralized so
 * the island, its worker request, and the cap check below can never compute it three
 * different ways.
 */
export function computeUpscaledDimensions(width: number, height: number, multiplier: UpscaleMultiplier): { width: number; height: number } {
  return { width: width * multiplier, height: height * multiplier };
}

/**
 * Rejects an upscale request before any decode/resample work is attempted, if the requested
 * multiplier would produce an image over `MAX_OUTPUT_PIXELS`. Checked against the *output*
 * size deliberately, not the input file size — a small, heavily-compressed file can still
 * decode to a huge pixel grid (a mostly-solid-color PNG, for instance), which
 * `validateImageFile`'s file-size cap alone would never catch.
 */
export function validateUpscaleTarget(sourceWidth: number, sourceHeight: number, multiplier: UpscaleMultiplier): ToolResult<{ width: number; height: number }> {
  const target = computeUpscaledDimensions(sourceWidth, sourceHeight, multiplier);
  const pixels = target.width * target.height;
  if (pixels > MAX_OUTPUT_PIXELS) {
    return err(
      `That image is too large to upscale ${multiplier}x — the result would be ${target.width.toLocaleString()}×${target.height.toLocaleString()} (${(pixels / 1_000_000).toFixed(0)} megapixels), over this tool's ${(MAX_OUTPUT_PIXELS / 1_000_000).toFixed(0)}MP limit. Try a smaller multiplier, or crop/resize the source image down first.`
    );
  }
  return ok(target);
}

/** The Lanczos kernel's support radius, in source-pixel units — how far a destination
 *  sample reaches for source samples on either side. 3 (a 6-tap window) is the standard
 *  "Lanczos-3" choice most image editors' own high-quality resampler uses, balancing
 *  sharpness against ringing artifacts. */
const LANCZOS_A = 3;
const LANCZOS_TAPS = LANCZOS_A * 2;

/** The normalized sinc function, `sinc(x) = sin(πx)/(πx)`, with the removable singularity
 *  at `x = 0` handled explicitly (the true limit is 1, but `0/0` would otherwise compute
 *  `NaN`). */
function sinc(x: number): number {
  if (x === 0) return 1;
  const piX = Math.PI * x;
  return Math.sin(piX) / piX;
}

/** The Lanczos-3 windowed-sinc kernel: a sinc lobe truncated by a second, wider sinc window
 *  (rather than a hard cutoff), zero outside `[-LANCZOS_A, LANCZOS_A]`. */
function lanczosWeight(x: number): number {
  if (x <= -LANCZOS_A || x >= LANCZOS_A) return 0;
  return sinc(x) * sinc(x / LANCZOS_A);
}

/**
 * Resamples a row-major interleaved buffer of `outerCount` rows × `axisSrcSize` samples ×
 * `channels` values along its *row* axis only, producing `outerCount` rows × `axisDstSize`
 * samples. Used for both passes of `resizeLanczos`'s separable filter — a horizontal pass
 * calls it directly (each image row already is one contiguous run of samples along width);
 * a vertical pass calls it on a *transposed* buffer (see `transposeImageBuffer`) so that,
 * from this function's point of view, it's still just resampling along each row of a
 * row-major buffer. Only ever used to upscale in this tool (2x/4x), so — unlike a
 * general-purpose resizer — the kernel support never needs widening to guard against
 * downsampling aliasing.
 */
function resampleRows(src: Float32Array, axisSrcSize: number, axisDstSize: number, outerCount: number, channels: number): Float32Array {
  const dst = new Float32Array(outerCount * axisDstSize * channels);
  const scale = axisSrcSize / axisDstSize;

  for (let d = 0; d < axisDstSize; d++) {
    const srcF = (d + 0.5) * scale - 0.5;
    const first = Math.floor(srcF) - LANCZOS_A + 1;

    const weights = new Float64Array(LANCZOS_TAPS);
    let weightSum = 0;
    for (let i = 0; i < LANCZOS_TAPS; i++) {
      const w = lanczosWeight(srcF - (first + i));
      weights[i] = w;
      weightSum += w;
    }
    // A source axis narrower than the kernel's own support (a 1 or 2px-wide image) can sum
    // to zero for an off-center sample; falling back to 1 avoids dividing by zero and just
    // skips normalization for that single sample rather than producing NaN.
    const normalizer = weightSum !== 0 ? 1 / weightSum : 1;

    for (let outer = 0; outer < outerCount; outer++) {
      const srcRowOffset = outer * axisSrcSize * channels;
      const dstRowOffset = outer * axisDstSize * channels;
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let i = 0; i < LANCZOS_TAPS; i++) {
          const clamped = Math.min(axisSrcSize - 1, Math.max(0, first + i));
          acc += weights[i]! * src[srcRowOffset + clamped * channels + c]!;
        }
        dst[dstRowOffset + d * channels + c] = acc * normalizer;
      }
    }
  }

  return dst;
}

/** Swaps a row-major interleaved buffer's width and height — `width` rows of `height`
 *  samples become `height` rows of `width` samples. Lets `resampleRows` (which only knows
 *  how to resample along a row) handle a vertical resize too: transpose, resample rows
 *  (now the image's original columns), transpose back. */
function transposeImageBuffer(src: Float32Array, width: number, height: number, channels: number): Float32Array {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcOffset = (y * width + x) * channels;
      const dstOffset = (x * height + y) * channels;
      for (let c = 0; c < channels; c++) {
        dst[dstOffset + c] = src[srcOffset + c]!;
      }
    }
  }
  return dst;
}

/**
 * Resamples an interleaved image buffer (RGBA with `channels === 4`) from one pixel size to
 * another using a separable Lanczos-3 filter — sharper than the bilinear resampling
 * `resizeBilinear` (in `backgroundRemove.ts`) does, at the cost of more taps per sample.
 * Pure pixel math with no DOM/canvas dependency, so — like `resizeBilinear` — it works
 * identically on the main thread and inside a Worker, and is used here as this tool's
 * "Standard" (instant, no AI model) upscale mode.
 *
 * Runs as two 1D passes through a `Float32Array` intermediate rather than one 2D pass, both
 * for speed (a separable filter is O(taps) per axis instead of O(taps²) per output pixel)
 * and to avoid rounding to 8-bit between passes, which would compound quantization error —
 * only the final result is clamped/rounded, by `Uint8ClampedArray`'s own assignment
 * semantics, matching how every other pure-pixel-math function in this codebase
 * (`resizeBilinear`, `maskFromModelOutput`) hands back its result.
 */
export function resizeLanczos(
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  channels: number
): Uint8ClampedArray<ArrayBuffer> {
  const srcFloat = new Float32Array(src.length);
  srcFloat.set(src);

  const horizontallyResized = resampleRows(srcFloat, srcWidth, dstWidth, srcHeight, channels);
  const transposed = transposeImageBuffer(horizontallyResized, dstWidth, srcHeight, channels);
  const verticallyResized = resampleRows(transposed, srcHeight, dstHeight, dstWidth, channels);
  const result = transposeImageBuffer(verticallyResized, dstHeight, dstWidth, channels);

  const dst = new Uint8ClampedArray(dstWidth * dstHeight * channels);
  dst.set(result);
  return dst;
}
