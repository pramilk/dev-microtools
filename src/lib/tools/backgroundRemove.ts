import type { RgbaImageData } from './imageCompress';

export { validateImageFile, MAX_INPUT_FILE_SIZE } from './imageCompress';
export type { RgbaImageData } from './imageCompress';

/** u2netp's fixed training/export resolution — every input is squashed to this size
 *  regardless of aspect ratio (matching the reference Python implementation, which does a
 *  direct resize, not a letterboxed one) and the model's output mask comes back at the same
 *  size before being scaled back up to the source image's own dimensions. */
export const MODEL_INPUT_SIZE = 320;

/** Served from `public/models/` — a static asset, not an npm-bundled one, since it's a
 *  4.6 MB binary with nothing for a bundler to tree-shake or transform. */
export const MODEL_URL = '/models/u2netp.onnx';

/** ImageNet channel statistics the u2netp checkpoint was trained against — required so the
 *  pixel values it sees at inference time match what it saw during training. Values and the
 *  whole normalization shape (divide by the image's own max pixel value, not a flat 255,
 *  then per-channel mean/std) are taken directly from the reference implementation
 *  (github.com/danielgatis/rembg, `BaseSession.normalize`), not guessed. */
const NORMALIZE_MEAN = [0.485, 0.456, 0.406] as const;
const NORMALIZE_STD = [0.229, 0.224, 0.225] as const;

/**
 * Bilinear-resamples an interleaved image buffer (RGBA with `channels === 4`, or a
 * single-channel mask with `channels === 1`) from one pixel size to another. Pure pixel math
 * with no DOM/canvas dependency, so it works identically on the main thread and inside a
 * Worker (unlike `createImageBitmap`/`<canvas>`, which only exist on the main thread) — used
 * both to shrink a photo down to the model's fixed input size and to scale its output mask
 * back up to the photo's own size.
 */
export function resizeBilinear(
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  channels: number
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstWidth * dstHeight * channels);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let dy = 0; dy < dstHeight; dy++) {
    const srcYf = Math.min(srcHeight - 1, Math.max(0, (dy + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(srcYf);
    const y1 = Math.min(srcHeight - 1, y0 + 1);
    const wy = srcYf - y0;

    for (let dx = 0; dx < dstWidth; dx++) {
      const srcXf = Math.min(srcWidth - 1, Math.max(0, (dx + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(srcXf);
      const x1 = Math.min(srcWidth - 1, x0 + 1);
      const wx = srcXf - x0;

      const i00 = (y0 * srcWidth + x0) * channels;
      const i10 = (y0 * srcWidth + x1) * channels;
      const i01 = (y1 * srcWidth + x0) * channels;
      const i11 = (y1 * srcWidth + x1) * channels;
      const di = (dy * dstWidth + dx) * channels;

      for (let c = 0; c < channels; c++) {
        const top = src[i00 + c]! + (src[i10 + c]! - src[i00 + c]!) * wx;
        const bottom = src[i01 + c]! + (src[i11 + c]! - src[i01 + c]!) * wx;
        dst[di + c] = top + (bottom - top) * wy;
      }
    }
  }

  return dst;
}

/**
 * Builds the model's input tensor from an RGBA buffer already resized to
 * `size` × `size`: drops the alpha channel, normalizes by the image's own max pixel value
 * (not a flat 255 — see `NORMALIZE_MEAN`'s comment) then by ImageNet mean/std, and lays the
 * result out as CHW planes (channel-major, matching the `[1, 3, size, size]` shape the model
 * expects once a batch dimension is added by the caller).
 */
export function buildInputTensor(rgba: Uint8ClampedArray, size: number): Float32Array {
  const pixelCount = size * size;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    if (r > max) max = r;
    if (g > max) max = g;
    if (b > max) max = b;
  }
  const divisor = Math.max(max, 1e-6);

  const tensor = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4]! / divisor;
    const g = rgba[i * 4 + 1]! / divisor;
    const b = rgba[i * 4 + 2]! / divisor;
    tensor[i] = (r - NORMALIZE_MEAN[0]) / NORMALIZE_STD[0];
    tensor[pixelCount + i] = (g - NORMALIZE_MEAN[1]) / NORMALIZE_STD[1];
    tensor[2 * pixelCount + i] = (b - NORMALIZE_MEAN[2]) / NORMALIZE_STD[2];
  }
  return tensor;
}

/**
 * Converts the model's raw first-channel output (a `size` × `size` saliency map, arbitrary
 * float range) into an 8-bit alpha mask via min-max normalization — the same formula the
 * reference implementation uses: stretch the observed [min, max] range to [0, 1], clip, then
 * scale to [0, 255]. `output` may be longer than `size * size` (some ONNX exports report more
 * than one output channel); only the first `size * size` values are read, which is channel 0
 * in the model's row-major NCHW layout regardless of how many channels follow it.
 */
export function maskFromModelOutput(output: Float32Array, size: number): Uint8ClampedArray {
  const pixelCount = size * size;
  if (output.length < pixelCount) {
    throw new Error('The background-removal model returned an unexpected output shape.');
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixelCount; i++) {
    const v = output[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(max - min, 1e-6);

  const mask = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const normalized = (output[i]! - min) / range;
    mask[i] = Math.round(Math.min(1, Math.max(0, normalized)) * 255);
  }
  return mask;
}

/** Replaces an RGBA buffer's alpha channel with a single-channel mask of the same pixel
 *  count, leaving every RGB value untouched — the actual "cut out the background" step, once
 *  the mask has already been resized to the image's own dimensions. */
export function applyAlphaMask(rgba: Uint8ClampedArray, mask: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  // Allocated by length (always backed by a fresh, plain ArrayBuffer) rather than passed
  // `rgba` directly — the copy-constructor overload types its result as
  // `Uint8ClampedArray<ArrayBufferLike>`. A bare `Uint8ClampedArray` return-type annotation
  // (with no generic argument) also defaults to `ArrayBufferLike`, not `ArrayBuffer` — both
  // need to be spelled out explicitly to satisfy `RgbaImageData.data`'s more specific type.
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  for (let i = 0; i < mask.length; i++) {
    out[i * 4 + 3] = mask[i]!;
  }
  return out;
}

/**
 * Rotates a point around a pivot by `angleDegrees` (clockwise, matching CSS's `rotate()` and
 * canvas's `ctx.rotate()` in the standard screen coordinate system where Y grows downward).
 * Used to work out where the placement stage's scale/rotate handles land on screen as the
 * cutout they're attached to spins — the handles live at a fixed offset from the cutout's own
 * center *before* rotation, then get rotated along with it.
 */
export function rotatePoint(x: number, y: number, cx: number, cy: number, angleDegrees: number): { x: number; y: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** A cutout's placement on top of a replacement background image: `x`/`y` are its center, in
 *  the background canvas's own pixel coordinates; `scale` is a multiplier on the cutout's own
 *  natural size (1 = original size); `rotation` is clockwise degrees. Deliberately allows the
 *  cutout to sit partially or fully outside the canvas bounds — the canvas clips whatever
 *  hangs off the edge automatically, and "half off-frame" is a legitimate composition choice
 *  a placement editor shouldn't block. */
export interface Placement {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/**
 * The initial placement for a freshly chosen (subject, background) pair: centered on the
 * canvas, scaled to comfortably fit within it (contain-fit with a 10% margin, so the cutout
 * starts fully visible and not touching the edges), with no rotation.
 */
export function defaultPlacement(cutoutWidth: number, cutoutHeight: number, canvasWidth: number, canvasHeight: number): Placement {
  const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
  if (cutoutWidth <= 0 || cutoutHeight <= 0) return { ...center, scale: 1, rotation: 0 };
  const fit = Math.min(canvasWidth / cutoutWidth, canvasHeight / cutoutHeight) * 0.9;
  return { ...center, scale: fit > 0 ? fit : 1, rotation: 0 };
}

export interface GradientLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The line endpoints `CanvasRenderingContext2D.createLinearGradient` needs to paint a linear
 * gradient across an entire canvas at a given angle (0° = left-to-right, 90° = top-to-bottom,
 * clockwise — the same screen-coordinate convention `rotatePoint` uses). Centered on the
 * canvas and reaching half the *diagonal* in each direction, not half the width or height —
 * a gradient angled across a non-square canvas needs that longer reach to actually cover
 * every corner rather than leaving the far corners a flat, un-blended color.
 */
export function computeLinearGradientLine(width: number, height: number, angleDegrees: number): GradientLine {
  const cx = width / 2;
  const cy = height / 2;
  const rad = (angleDegrees * Math.PI) / 180;
  const halfLength = Math.sqrt(width ** 2 + height ** 2) / 2;
  const dx = Math.cos(rad) * halfLength;
  const dy = Math.sin(rad) * halfLength;
  return { x0: cx - dx, y0: cy - dy, x1: cx + dx, y1: cy + dy };
}

type OrtModule = typeof import('onnxruntime-web/wasm');

// Loaded lazily so onnxruntime-web's WASM runtime (~14 MB) is fetched only when someone
// actually uses this tool — never on page load, and never for any other tool on the site.
// Cached at module scope (like `loadOxipng` in imageCompress.ts) so a second image in the
// same session reuses the already-instantiated runtime instead of re-fetching it.
let ortModulePromise: Promise<OrtModule> | null = null;
function loadOrt(): Promise<OrtModule> {
  ortModulePromise ??= import('onnxruntime-web/wasm').then((ort) => {
    // Forces the single-threaded code path of the same "threaded" WASM build onnxruntime-web
    // ships by default — no separate non-threaded artifact exists in this version. Real
    // multi-threading needs SharedArrayBuffer, which needs cross-origin-isolation headers
    // (COOP/COEP) this site doesn't set; numThreads = 1 runs the identical binary without
    // ever touching SharedArrayBuffer, at the cost of not parallelizing across cores.
    ort.env.wasm.numThreads = 1;
    return ort;
  });
  return ortModulePromise;
}

/** `InferenceSession` is a factory interface (a static `.create()`, not a plain constructor),
 *  so its instance type has to be pulled from `create`'s own return type rather than
 *  `InstanceType<...>`, which only works for actual `new`-able classes. */
type Session = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

// The session (model weights loaded into the WASM runtime) is likewise cached at module
// scope — creating it is the expensive part (fetching + parsing the 4.6 MB model), so a
// second image reuses the same session rather than reloading the model from scratch.
let sessionPromise: Promise<Session> | null = null;
function loadSession(ort: OrtModule): Promise<Session> {
  sessionPromise ??= ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
  return sessionPromise;
}

/**
 * Runs background removal on one decoded image entirely in-process: resize down to the
 * model's fixed input size, run the u2netp saliency model via onnxruntime-web (WebAssembly,
 * no network calls once the model/runtime are cached), resize its mask back up, and bake
 * that mask into the source image's alpha channel. Deliberately does not catch and degrade
 * on failure the way `optimizePngLosslessly` does — there is no sensible fallback for "the
 * AI model didn't run" short of returning the original, un-cut-out image, which would be a
 * silent failure the caller has no way to detect. Errors propagate so the UI can show one.
 */
export async function removeBackgroundFromImage(image: RgbaImageData): Promise<RgbaImageData> {
  let ort: OrtModule;
  let session: Session;
  try {
    ort = await loadOrt();
    session = await loadSession(ort);
  } catch (error) {
    // Lets a retry actually retry instead of permanently caching a failed load.
    ortModulePromise = null;
    sessionPromise = null;
    throw new Error(
      `Could not load the background-removal AI model — check your connection and try again. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error('The background-removal model file looks corrupted or incompatible.');
  }

  const resizedRgba = resizeBilinear(image.data, image.width, image.height, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 4);
  const tensorData = buildInputTensor(resizedRgba, MODEL_INPUT_SIZE);
  const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

  let outputData: Float32Array;
  try {
    const results = await session.run({ [inputName]: inputTensor });
    const outputTensor = results[outputName];
    if (!outputTensor) throw new Error('no output tensor');
    outputData = outputTensor.data as Float32Array;
  } catch (error) {
    throw new Error(
      `Background removal failed on this image — try a different file. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const smallMask = maskFromModelOutput(outputData, MODEL_INPUT_SIZE);
  const fullMask = resizeBilinear(smallMask, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, image.width, image.height, 1);
  const data = applyAlphaMask(image.data, fullMask);

  return { data, width: image.width, height: image.height };
}
