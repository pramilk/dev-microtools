import type { RgbaImageData } from './imageCompress';
import { resizeBilinear } from './backgroundRemove';

export { validateImageFile, MAX_INPUT_FILE_SIZE } from './imageCompress';
export type { RgbaImageData } from './imageCompress';

/** Ultra-Light-Fast-Generic-Face-Detector-1MB's fixed input resolution (width, height) —
 *  verified against the model's own reference `demo.py` in the onnx/models repo, which
 *  resizes to exactly this size regardless of the source image's aspect ratio. */
export const MODEL_INPUT_WIDTH = 320;
export const MODEL_INPUT_HEIGHT = 240;

/** Served from `public/models/`, same static-asset convention as Background Remover's
 *  u2netp.onnx — a binary with nothing for a bundler to tree-shake or transform. */
export const MODEL_URL = '/models/version-RFB-320.onnx';

/** Taken directly from the model's own reference `demo.py`/`box_utils.py`, not guessed:
 *  faces scoring below this are discarded, and overlapping boxes above this IoU are
 *  collapsed to their highest-scoring detection. */
export const DEFAULT_SCORE_THRESHOLD = 0.7;
export const DEFAULT_IOU_THRESHOLD = 0.5;

/** How far a detected face box is padded out on every side, as a fraction of its own
 *  width/height. The raw detection is a tight box around facial landmarks; without this a
 *  default blur would leave hairline, chin and ears clearly visible. */
export const FACE_BOX_MARGIN_RATIO = 0.3;

/** Floor on a redaction region's own width/height — small enough to still cover a license
 *  plate digit or two, large enough that a region can never be dragged/resized into
 *  something too thin to see or to blur meaningfully. */
export const MIN_REGION_SIZE = 8;

/** Default intensity for a freshly created or freshly-switched-to style — blur radius in
 *  pixels, or pixelate block size in pixels. Every region carries its own style and
 *  intensity (not one global setting for the whole photo), so these are just the starting
 *  point a new region or a style switch resets to. */
export const DEFAULT_BLUR_RADIUS = 32;
export const DEFAULT_PIXEL_BLOCK_SIZE = 24;

/**
 * Builds the face detector's input tensor from an RGBA buffer already resized to
 * `MODEL_INPUT_WIDTH`×`MODEL_INPUT_HEIGHT`: drops alpha, normalizes each channel by
 * `(value - 127) / 128` (the exact formula in the model's reference `demo.py` — a plain
 * fixed offset/scale, unlike u2netp's per-image-max + ImageNet mean/std), and lays the
 * result out as CHW planes matching the `[1, 3, height, width]` shape the model expects
 * once a batch dimension is added by the caller.
 */
export function buildFaceDetectorInput(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const pixelCount = width * height;
  const tensor = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    tensor[i] = (rgba[i * 4]! - 127) / 128;
    tensor[pixelCount + i] = (rgba[i * 4 + 1]! - 127) / 128;
    tensor[2 * pixelCount + i] = (rgba[i * 4 + 2]! - 127) / 128;
  }
  return tensor;
}

/** A face detection in source-image pixel coordinates, corner-form. */
export interface DetectedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
}

function boxArea(box: DetectedBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

function iou(a: DetectedBox, b: DetectedBox): number {
  const left = Math.max(a.x0, b.x0);
  const top = Math.max(a.y0, b.y0);
  const right = Math.min(a.x1, b.x1);
  const bottom = Math.min(a.y1, b.y1);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  return overlap / (boxArea(a) + boxArea(b) - overlap + 1e-5);
}

/**
 * Greedy non-max suppression: keeps the highest-scoring box, discards every remaining box
 * that overlaps it above `iouThreshold`, and repeats — the same "hard NMS" algorithm the
 * model's own reference `box_utils.py` uses, so behaviour matches the Python reference
 * this model ships with.
 */
export function nonMaxSuppression(boxes: DetectedBox[], iouThreshold: number): DetectedBox[] {
  const remaining = [...boxes].sort((a, b) => b.score - a.score);
  const picked: DetectedBox[] = [];
  while (remaining.length > 0) {
    const current = remaining.shift()!;
    picked.push(current);
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (iou(current, remaining[i]!) > iouThreshold) remaining.splice(i, 1);
    }
  }
  return picked;
}

/**
 * Turns the model's raw output into final face boxes in source-image pixel coordinates.
 * `scores` is `[numPriors, 2]` (background, face) and `boxes` is `[numPriors, 4]`
 * (normalized `[0,1]` corner-form) flattened row-major — per the model's own README and
 * reference `box_utils.py`, the ONNX graph already decodes SSD priors into these final
 * normalized coordinates, so no anchor/prior generation is needed here: just threshold,
 * scale to pixels, and run NMS.
 */
export function decodeFaceDetections(
  scores: Float32Array,
  boxes: Float32Array,
  imageWidth: number,
  imageHeight: number,
  scoreThreshold: number = DEFAULT_SCORE_THRESHOLD,
  iouThreshold: number = DEFAULT_IOU_THRESHOLD
): DetectedBox[] {
  const numPriors = Math.floor(boxes.length / 4);
  const candidates: DetectedBox[] = [];
  for (let i = 0; i < numPriors; i++) {
    const faceScore = scores[i * 2 + 1];
    if (faceScore === undefined || faceScore <= scoreThreshold) continue;
    candidates.push({
      x0: boxes[i * 4]! * imageWidth,
      y0: boxes[i * 4 + 1]! * imageHeight,
      x1: boxes[i * 4 + 2]! * imageWidth,
      y1: boxes[i * 4 + 3]! * imageHeight,
      score: faceScore,
    });
  }
  return nonMaxSuppression(candidates, iouThreshold);
}

/** Pads a detected box outward by `marginRatio` of its own size on every side, clamped to
 *  the image bounds — see `FACE_BOX_MARGIN_RATIO`'s doc comment for why this matters. */
export function expandBox(box: DetectedBox, marginRatio: number, imageWidth: number, imageHeight: number): DetectedBox {
  const dx = (box.x1 - box.x0) * marginRatio;
  const dy = (box.y1 - box.y0) * marginRatio;
  return {
    ...box,
    x0: Math.max(0, box.x0 - dx),
    y0: Math.max(0, box.y0 - dy),
    x1: Math.min(imageWidth, box.x1 + dx),
    y1: Math.min(imageHeight, box.y1 + dy),
  };
}

export type RedactSource = 'auto' | 'manual';
export type RedactStyle = 'blur' | 'pixelate' | 'blackbox';
/** `'rect'` redacts the region's full bounding box; `'ellipse'` redacts only the oval
 *  inscribed within it, leaving the box's own corners untouched — a face is roughly oval,
 *  so redacting the tight rectangle around one always drags in a visible chunk of
 *  background/hair/shoulders at the corners that a face-shaped mask avoids. */
export type RedactShape = 'rect' | 'ellipse';

/** One redactable rectangle in source-image pixel coordinates, with its own independent
 *  redaction style, intensity and shape — one region can stay a soft oval blur while
 *  another is a solid rectangular black box, rather than one setting applying to every
 *  region in the photo. `source` distinguishes a face the model found from one the visitor
 *  drew, purely so the UI can style them differently — a plate or any other manually-boxed
 *  subject is always `'manual'`, since there's no small client-side detector for those. */
export interface RedactRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source: RedactSource;
  style: RedactStyle;
  /** Blur radius in pixels when `style === 'blur'`, block size in pixels when `style ===
   *  'pixelate'`, ignored (but still a real number, not undefined) when `style ===
   *  'blackbox'` — keeping it always-present means switching a region back to blur or
   *  pixelate never has to invent a value from nothing. */
  intensity: number;
  shape: RedactShape;
}

/** The intensity a region's `style` resets to right after it's created or switched to —
 *  the two styles use unrelated units (blur radius vs. block size), so there's no single
 *  "previous value" that carries over meaningfully between them. */
export function defaultIntensityForStyle(style: RedactStyle): number {
  return style === 'pixelate' ? DEFAULT_PIXEL_BLOCK_SIZE : DEFAULT_BLUR_RADIUS;
}

/**
 * Rounds a region to whole pixels and clamps it to the image bounds, keeping a minimum of
 * `MIN_REGION_SIZE`×`MIN_REGION_SIZE` — the shared safety net every region-editing
 * function below routes its result through, mirroring `imageCrop.ts`'s `clampCropRect`.
 */
export function clampRegionToImage(region: RedactRegion, imageWidth: number, imageHeight: number): RedactRegion {
  const x = Math.min(Math.max(0, Math.round(region.x)), Math.max(0, imageWidth - MIN_REGION_SIZE));
  const y = Math.min(Math.max(0, Math.round(region.y)), Math.max(0, imageHeight - MIN_REGION_SIZE));
  const width = Math.min(Math.max(MIN_REGION_SIZE, Math.round(region.width)), Math.max(MIN_REGION_SIZE, imageWidth - x));
  const height = Math.min(Math.max(MIN_REGION_SIZE, Math.round(region.height)), Math.max(MIN_REGION_SIZE, imageHeight - y));
  return { ...region, x, y, width, height };
}

/** Repositions a region without changing its size, matching `imageCrop.ts`'s
 *  `clampCropPosition` — used while dragging, where shrinking mid-move would feel like the
 *  box is deforming rather than simply being stopped at the edge. */
export function moveRegion(region: RedactRegion, dx: number, dy: number, imageWidth: number, imageHeight: number): RedactRegion {
  const width = Math.min(Math.round(region.width), imageWidth);
  const height = Math.min(Math.round(region.height), imageHeight);
  const x = Math.min(Math.max(0, Math.round(region.x + dx)), Math.max(0, imageWidth - width));
  const y = Math.min(Math.max(0, Math.round(region.y + dy)), Math.max(0, imageHeight - height));
  return { ...region, x, y, width, height };
}

/** Grows/shrinks a region's bottom-right corner by `(dx, dy)`, then clamps it back within
 *  bounds and above `MIN_REGION_SIZE` — used while dragging the resize handle. */
export function resizeRegionBy(region: RedactRegion, dx: number, dy: number, imageWidth: number, imageHeight: number): RedactRegion {
  return clampRegionToImage({ ...region, width: region.width + dx, height: region.height + dy }, imageWidth, imageHeight);
}

/** A new manually-drawn region, centered and sized relative to the image so it starts
 *  somewhere useful (roughly plate-sized) rather than a fixed pixel size that could dwarf
 *  or vanish into images of very different resolutions. */
export function createManualRegion(imageWidth: number, imageHeight: number): RedactRegion {
  const width = Math.max(MIN_REGION_SIZE, Math.round(imageWidth * 0.2));
  const height = Math.max(MIN_REGION_SIZE, Math.round(imageHeight * 0.12));
  return clampRegionToImage(
    {
      id: crypto.randomUUID(),
      x: Math.round((imageWidth - width) / 2),
      y: Math.round((imageHeight - height) / 2),
      width,
      height,
      source: 'manual',
      style: 'blur',
      intensity: DEFAULT_BLUR_RADIUS,
      // Rectangular by default — a manual region is more often a plate, sign or other
      // hard-edged subject than an oval one, unlike an auto-detected face.
      shape: 'rect',
    },
    imageWidth,
    imageHeight
  );
}

export interface RedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clamps an arbitrary rect to the image bounds by intersecting it, rather than
 *  `clampRegionToImage`'s "preserve a minimum size" behaviour — redaction rendering just
 *  needs the actual overlapping pixels, including a rect that's partly or fully off-image
 *  (which then simply renders as a no-op). */
function clampRect(rect: RedactRect, imageWidth: number, imageHeight: number): RedactRect {
  const x0 = Math.max(0, Math.min(Math.round(rect.x), imageWidth));
  const y0 = Math.max(0, Math.min(Math.round(rect.y), imageHeight));
  const x1 = Math.max(x0, Math.min(Math.round(rect.x + rect.width), imageWidth));
  const y1 = Math.max(y0, Math.min(Math.round(rect.y + rect.height), imageHeight));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Allocated by length (always backed by a fresh, plain ArrayBuffer) rather than passed
 *  `image.data` directly — see `backgroundRemove.ts`'s `applyAlphaMask` for why the
 *  copy-constructor overload's looser return type won't satisfy `RgbaImageData.data`. */
function cloneRgba(image: RgbaImageData): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(image.data.length);
  out.set(image.data);
  return out;
}

/** Point-in-ellipse test against the ellipse inscribed within `rect` (its unclamped,
 *  true bounds — not whatever visible slice survives image-edge clamping, so a region
 *  hanging partly off-image still masks against its real, intended oval). Samples the
 *  pixel's center (`+0.5`), matching how every other rect/pixel boundary in this file is
 *  treated. */
function isInsideEllipse(px: number, py: number, rect: RedactRect): boolean {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (px + 0.5 - (rect.x + rx)) / rx;
  const ny = (py + 0.5 - (rect.y + ry)) / ry;
  return nx * nx + ny * ny <= 1;
}

function blackBoxInPlace(image: RgbaImageData, rect: RedactRect, shape: RedactShape): void {
  const clamped = clampRect(rect, image.width, image.height);
  for (let row = 0; row < clamped.height; row++) {
    const y = clamped.y + row;
    const rowStart = (y * image.width + clamped.x) * 4;
    for (let col = 0; col < clamped.width; col++) {
      const x = clamped.x + col;
      if (shape === 'ellipse' && !isInsideEllipse(x, y, rect)) continue;
      const idx = rowStart + col * 4;
      image.data[idx] = 0;
      image.data[idx + 1] = 0;
      image.data[idx + 2] = 0;
      // Alpha is left untouched — a redacted area should stay as opaque as the source
      // pixel already was, not punch a transparent hole in it.
    }
  }
}

function pixelateInPlace(image: RgbaImageData, rect: RedactRect, blockSize: number, shape: RedactShape): void {
  const { x, y, width, height } = clampRect(rect, image.width, image.height);
  const block = Math.max(2, Math.round(blockSize));
  for (let by = y; by < y + height; by += block) {
    const blockHeight = Math.min(block, y + height - by);
    for (let bx = x; bx < x + width; bx += block) {
      const blockWidth = Math.min(block, x + width - bx);
      let r = 0;
      let g = 0;
      let b = 0;
      const count = blockWidth * blockHeight;
      for (let row = 0; row < blockHeight; row++) {
        const rowStart = ((by + row) * image.width + bx) * 4;
        for (let col = 0; col < blockWidth; col++) {
          const idx = rowStart + col * 4;
          r += image.data[idx]!;
          g += image.data[idx + 1]!;
          b += image.data[idx + 2]!;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      // The block's average is computed from every pixel in it regardless of shape (a
      // block straddling the ellipse boundary still mosaics as one flat color), but only
      // written back to pixels actually inside the mask — an oval region ends up as a
      // "cookie-cutter" mosaic instead of a full rectangular one.
      for (let row = 0; row < blockHeight; row++) {
        const py = by + row;
        const rowStart = (py * image.width + bx) * 4;
        for (let col = 0; col < blockWidth; col++) {
          const px = bx + col;
          if (shape === 'ellipse' && !isInsideEllipse(px, py, rect)) continue;
          const idx = rowStart + col * 4;
          image.data[idx] = r;
          image.data[idx + 1] = g;
          image.data[idx + 2] = b;
        }
      }
    }
  }
}

/** A single-pass sliding-window box blur along one axis — the running-sum trick keeps
 *  each pass O(pixels) regardless of `radius`, instead of the naive O(pixels × radius)
 *  a fresh sum-per-pixel would cost. Edge pixels sample the window clamped to the buffer
 *  (`Math.min`/`Math.max`) rather than treating anything past it as black, which is what
 *  makes running this on a padded window (see `boxBlurInPlace`) produce a real blur
 *  instead of a darkened rim at the redaction box's own edges. */
function boxBlurAxis(
  src: Float64Array<ArrayBuffer>,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean
): Float64Array<ArrayBuffer> {
  const out = new Float64Array(src.length);
  const windowSize = radius * 2 + 1;
  const outerCount = horizontal ? height : width;
  const innerCount = horizontal ? width : height;

  const indexOf = (outer: number, inner: number): number => {
    const [row, col] = horizontal ? [outer, inner] : [inner, outer];
    return (row * width + col) * 3;
  };

  for (let outer = 0; outer < outerCount; outer++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const inner = Math.min(innerCount - 1, Math.max(0, i));
        sum += src[indexOf(outer, inner) + c]!;
      }
      out[indexOf(outer, 0) + c] = sum / windowSize;
      for (let inner = 1; inner < innerCount; inner++) {
        const addInner = Math.min(innerCount - 1, inner + radius);
        const subInner = Math.max(0, inner - radius - 1);
        sum += src[indexOf(outer, addInner) + c]! - src[indexOf(outer, subInner) + c]!;
        out[indexOf(outer, inner) + c] = sum / windowSize;
      }
    }
  }
  return out;
}

function boxBlurInPlace(image: RgbaImageData, rect: RedactRect, radius: number, shape: RedactShape): void {
  const region = clampRect(rect, image.width, image.height);
  if (region.width <= 0 || region.height <= 0) return;
  const r = Math.max(1, Math.round(radius));

  // Blurs a window padded by the radius around the region, not the region alone, so pixels
  // near the box's own edge blend with their real neighbours instead of being starved of
  // samples right where the effect would otherwise look thin.
  const winX0 = Math.max(0, region.x - r);
  const winY0 = Math.max(0, region.y - r);
  const winX1 = Math.min(image.width, region.x + region.width + r);
  const winY1 = Math.min(image.height, region.y + region.height + r);
  const winWidth = winX1 - winX0;
  const winHeight = winY1 - winY0;

  let buffer = new Float64Array(winWidth * winHeight * 3);
  for (let row = 0; row < winHeight; row++) {
    const srcRowStart = ((winY0 + row) * image.width + winX0) * 4;
    const dstRowStart = row * winWidth * 3;
    for (let col = 0; col < winWidth; col++) {
      const srcIdx = srcRowStart + col * 4;
      const dstIdx = dstRowStart + col * 3;
      buffer[dstIdx] = image.data[srcIdx]!;
      buffer[dstIdx + 1] = image.data[srcIdx + 1]!;
      buffer[dstIdx + 2] = image.data[srcIdx + 2]!;
    }
  }

  // Three horizontal+vertical box-blur passes approximate a Gaussian blur closely enough
  // for redaction purposes, far more cheaply than a true Gaussian kernel convolution.
  for (let pass = 0; pass < 3; pass++) {
    buffer = boxBlurAxis(buffer, winWidth, winHeight, r, true);
    buffer = boxBlurAxis(buffer, winWidth, winHeight, r, false);
  }

  for (let row = 0; row < region.height; row++) {
    const y = region.y + row;
    const bufRow = region.y - winY0 + row;
    const dstRowStart = (y * image.width + region.x) * 4;
    const bufRowStart = bufRow * winWidth * 3;
    for (let col = 0; col < region.width; col++) {
      const x = region.x + col;
      // Outside the ellipse, the pixel keeps its original (unblurred) value — masks the
      // square blur window down to the oval the caller actually asked for.
      if (shape === 'ellipse' && !isInsideEllipse(x, y, rect)) continue;
      const bufCol = region.x - winX0 + col;
      const bufIdx = bufRowStart + bufCol * 3;
      const dstIdx = dstRowStart + col * 4;
      image.data[dstIdx] = buffer[bufIdx]!;
      image.data[dstIdx + 1] = buffer[bufIdx + 1]!;
      image.data[dstIdx + 2] = buffer[bufIdx + 2]!;
    }
  }
}

/** Gaussian-style blur confined to `rect` (or the oval inscribed within it, for
 *  `shape: 'ellipse'`). Returns a new `RgbaImageData` — the source is never mutated,
 *  matching `applyAlphaMask`'s copy semantics. `intensity` is the blur radius in pixels. */
export function applyBoxBlur(image: RgbaImageData, rect: RedactRect, intensity: number, shape: RedactShape = 'rect'): RgbaImageData {
  const data = cloneRgba(image);
  const working = { data, width: image.width, height: image.height };
  boxBlurInPlace(working, rect, intensity, shape);
  return working;
}

/** Mosaic/pixelate effect confined to `rect` (or its inscribed oval). `intensity` is the
 *  block size in pixels. */
export function applyPixelate(image: RgbaImageData, rect: RedactRect, intensity: number, shape: RedactShape = 'rect'): RgbaImageData {
  const data = cloneRgba(image);
  const working = { data, width: image.width, height: image.height };
  pixelateInPlace(working, rect, intensity, shape);
  return working;
}

/** Solid black fill confined to `rect` (or its inscribed oval) — the only style that makes
 *  the original pixels fully unrecoverable, since blur and pixelation are both reversible
 *  with enough effort. */
export function applyBlackBox(image: RgbaImageData, rect: RedactRect, shape: RedactShape = 'rect'): RgbaImageData {
  const data = cloneRgba(image);
  const working = { data, width: image.width, height: image.height };
  blackBoxInPlace(working, rect, shape);
  return working;
}

/** Applies each region's *own* redaction style/intensity/shape to one working copy of
 *  `image` in a single pass — the orchestrator the island actually calls, rather than
 *  chaining the single-region `apply*` functions above (each of which clones the whole
 *  image, fine for a unit test on one region but wasteful when applying several regions to
 *  one photo). */
export function applyRedactions(image: RgbaImageData, regions: RedactRegion[]): RgbaImageData {
  const data = cloneRgba(image);
  const working = { data, width: image.width, height: image.height };
  for (const region of regions) {
    const rect: RedactRect = { x: region.x, y: region.y, width: region.width, height: region.height };
    if (region.style === 'blackbox') blackBoxInPlace(working, rect, region.shape);
    else if (region.style === 'pixelate') pixelateInPlace(working, rect, region.intensity, region.shape);
    else boxBlurInPlace(working, rect, region.intensity, region.shape);
  }
  return working;
}

type OrtModule = typeof import('onnxruntime-web/wasm');

// Loaded lazily, same as Background Remover's onnxruntime-web import — the ~14 MB WASM
// runtime is fetched only when someone actually uses a model-backed tool, and the browser
// cache is shared across tools since it's the same package/version.
let ortModulePromise: Promise<OrtModule> | null = null;
function loadOrt(): Promise<OrtModule> {
  ortModulePromise ??= import('onnxruntime-web/wasm').then((ort) => {
    ort.env.wasm.numThreads = 1;
    return ort;
  });
  return ortModulePromise;
}

type Session = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

let sessionPromise: Promise<Session> | null = null;
function loadSession(ort: OrtModule): Promise<Session> {
  sessionPromise ??= ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
  return sessionPromise;
}

/**
 * Runs face detection on one decoded image entirely in-process: resize to the model's
 * fixed input size, run the UltraFace model via onnxruntime-web, decode+NMS the raw
 * output, and pad each box into a ready-to-use redaction region. Deliberately does not
 * degrade on failure (no silent "just return no faces") — the caller needs to know
 * detection didn't run at all, versus genuinely finding zero faces, since those call for
 * different UI messages.
 */
export async function detectFaceRegions(image: RgbaImageData): Promise<RedactRegion[]> {
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
      `Could not load the face-detection AI model — check your connection and try again. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const inputName = session.inputNames[0];
  if (!inputName) {
    throw new Error('The face-detection model file looks corrupted or incompatible.');
  }

  const resizedRgba = resizeBilinear(image.data, image.width, image.height, MODEL_INPUT_WIDTH, MODEL_INPUT_HEIGHT, 4);
  const tensorData = buildFaceDetectorInput(resizedRgba, MODEL_INPUT_WIDTH, MODEL_INPUT_HEIGHT);
  const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH]);

  let scoresData: Float32Array;
  let boxesData: Float32Array;
  try {
    const results = await session.run({ [inputName]: inputTensor });
    // Picked by each tensor's own last dimension (2 = per-class scores, 4 = box
    // coordinates) rather than trusted output names — ONNX exports of this model are not
    // consistent about naming the two outputs, but their shapes always are.
    const outputs = Object.values(results);
    const scoresTensor = outputs.find((t) => t.dims[t.dims.length - 1] === 2);
    const boxesTensor = outputs.find((t) => t.dims[t.dims.length - 1] === 4);
    if (!scoresTensor || !boxesTensor) throw new Error('unexpected output shape');
    scoresData = scoresTensor.data as Float32Array;
    boxesData = boxesTensor.data as Float32Array;
  } catch (error) {
    throw new Error(
      `Face detection failed on this image — try a different file. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const detections = decodeFaceDetections(scoresData, boxesData, image.width, image.height);
  return detections.map((box) => {
    const expanded = expandBox(box, FACE_BOX_MARGIN_RATIO, image.width, image.height);
    return clampRegionToImage(
      {
        id: crypto.randomUUID(),
        x: expanded.x0,
        y: expanded.y0,
        width: expanded.x1 - expanded.x0,
        height: expanded.y1 - expanded.y0,
        source: 'auto',
        style: 'blur',
        intensity: DEFAULT_BLUR_RADIUS,
        // A detected face is redacted as an oval by default — the raw box is rectangular,
        // but a rectangle drags in a visible chunk of background/hair at every corner that
        // an oval mask, matched to a face's actual rough shape, avoids.
        shape: 'ellipse',
      },
      image.width,
      image.height
    );
  });
}
