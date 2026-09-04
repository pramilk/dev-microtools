import { useEffect, useRef, useState } from 'preact/hooks';
import {
  validateImageFile,
  OUTPUT_FORMATS,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMAT_EXTENSIONS,
  LOSSY_FORMATS,
  DEFAULT_QUALITY,
  qualityToColorCount,
  type OutputFormat,
  type PngMode,
} from '../lib/tools/imageCompress';
import { rotatePoint, defaultPlacement, computeLinearGradientLine, type RgbaImageData, type Placement } from '../lib/tools/backgroundRemove';
import { FileDropzone } from './shared/FileDropzone';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import BackgroundRemoveWorker from '../workers/backgroundRemove.worker?worker';
import type { BackgroundRemoveWorkerRequest, BackgroundRemoveWorkerResult } from '../workers/backgroundRemove.worker';
import ImageCompressWorker from '../workers/imageCompress.worker?worker';
import type { ImageCompressWorkerRequest, ImageCompressWorkerResult } from '../workers/imageCompress.worker';

// Deliberately no ShareLinkButton — the input is a binary image file from the visitor's own
// disk, which can't (and shouldn't) be encoded into a URL. Same reasoning as every other
// image tool on this site.

type BackgroundMode = 'transparent' | 'color' | 'gradient' | 'image';
/** Direction presets for the gradient fill, in the same 0°=right/90°=down clockwise
 *  convention `computeLinearGradientLine` uses, ordered like a compass starting at "up".
 *  Deliberately a fixed set of eight rather than a full angle dial — the common cases, not a
 *  full gradient editor. */
const GRADIENT_DIRECTIONS: { label: string; angle: number; title: string }[] = [
  { label: '↑', angle: 270, title: 'Bottom to top' },
  { label: '↗', angle: 315, title: 'Bottom-left to top-right' },
  { label: '→', angle: 0, title: 'Left to right' },
  { label: '↘', angle: 45, title: 'Top-left to bottom-right' },
  { label: '↓', angle: 90, title: 'Top to bottom' },
  { label: '↙', angle: 135, title: 'Top-right to bottom-left' },
  { label: '←', angle: 180, title: 'Right to left' },
  { label: '↖', angle: 225, title: 'Bottom-right to top-left' },
];
type PlaceDragMode = 'move' | 'scale' | 'rotate';

interface ExportResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

interface PlaceDragState {
  mode: PlaceDragMode;
  /** The pointer's own canvas-space position when the drag began — `move` uses this to turn
   *  further pointer movement into a delta; `scale`/`rotate` instead measure from the
   *  placement's own center (below), not from this point. */
  startPointer: { x: number; y: number };
  startPlacement: Placement;
}

const baseName = (name: string): string => name.replace(/\.[^./]+$/, '') || 'image';

const DEFAULT_BACKGROUND_COLOR = '#ffffff';
const DEFAULT_GRADIENT_COLOR_A = '#3cbcd4';
const DEFAULT_GRADIENT_COLOR_B = '#0d1117';
const DEFAULT_GRADIENT_ANGLE = 90;
const MIN_PLACEMENT_SCALE = 0.05;
/** How far beyond the cutout's own top edge the rotate handle sits, as a fraction of its
 *  half-height in the cutout's local (unscaled, unrotated) frame — scales and rotates along
 *  with the cutout itself so it always reads as "attached" to it. */
const ROTATE_HANDLE_MARGIN = 1.2;
/** Height cap for the placement stage's "fit" size — kept as one constant so the inline width
 *  formula and the scroll wrapper's own max-height can never drift apart (same technique as
 *  the Image Cropper's own `MAX_STAGE_HEIGHT_REM`). */
const MAX_PLACE_STAGE_HEIGHT_REM = 22;

/** A real bundled photo rather than synthetic canvas art (the pattern every other tool's
 *  "Load example" uses) — u2netp is trained on real photographs, and a generated shape
 *  doesn't demonstrate a cutout nearly as well as an actual subject against an actual
 *  background does. Public domain (no attribution required): "Stray cat on wall.jpg" by
 *  Neal Ziring, via Wikimedia Commons — see this tool's own content page for the credit
 *  and license link. */
const SAMPLE_IMAGE_URL = '/samples/cat.jpg';

async function loadSampleImageFile(): Promise<File> {
  const response = await fetch(SAMPLE_IMAGE_URL);
  if (!response.ok) throw new Error('Could not load the sample image.');
  const blob = await response.blob();
  return new File([blob], 'cat.jpg', { type: 'image/jpeg' });
}

/**
 * Decodes the file, runs it through the background-removal Worker, then composites the
 * result against whichever background the visitor picked (transparent, a solid color, or a
 * replacement image — freely positioned, scaled and rotated on top of it) and encodes the
 * final export — inherently DOM-bound (`createImageBitmap`, `<canvas>`), so like the other
 * image tools this stays in the island rather than the pure logic layer in `lib/tools`.
 */
export default function BackgroundRemover() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [cutoutPixels, setCutoutPixels] = useState<RgbaImageData | null>(null);
  const [cutoutPreviewUrl, setCutoutPreviewUrl] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [removingBackground, setRemovingBackground] = useState(false);
  const [compositing, setCompositing] = useState(false);

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('transparent');
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR);
  const [gradientColorA, setGradientColorA] = useState(DEFAULT_GRADIENT_COLOR_A);
  const [gradientColorB, setGradientColorB] = useState(DEFAULT_GRADIENT_COLOR_B);
  const [gradientAngle, setGradientAngle] = useState(DEFAULT_GRADIENT_ANGLE);
  const [backgroundImageFile, setBackgroundImageFile] = useState<File | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [backgroundImageSize, setBackgroundImageSize] = useState<{ width: number; height: number } | null>(null);
  const [backgroundImageError, setBackgroundImageError] = useState<string | null>(null);

  // How the cutout sits on top of the replacement background image: center position, scale,
  // rotation. Only meaningful (and only ever set) once both a cutout and a background image
  // exist — Transparent/Color modes have no separate "canvas" to place the cutout within, so
  // it always just fills the frame there, the same as before this feature existed.
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The placement actually baked into the export — updated 200ms after dragging settles, the
  // same debounce the quality slider already uses, so dragging itself stays smooth (a plain
  // CSS transform) instead of re-running the full canvas-encode-optimize pipeline on every
  // pointer-move tick.
  const [debouncedPlacement, setDebouncedPlacement] = useState<Placement | null>(null);
  const placeDragRef = useRef<PlaceDragState | null>(null);
  const placeStageRef = useRef<HTMLDivElement>(null);

  // Only PNG can carry the transparent areas "Transparent" mode relies on — JPEG/WebP only
  // make sense once a solid or image background has made the result fully opaque.
  const [format, setFormat] = useState<OutputFormat>('image/png');
  const [pngMode, setPngMode] = useState<PngMode>('lossless');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const removeSeqRef = useRef(0);
  const exportSeqRef = useRef(0);
  const removeWorker = useWorkerTask<BackgroundRemoveWorkerRequest, BackgroundRemoveWorkerResult>(() => new BackgroundRemoveWorker());
  const pngWorker = useWorkerTask<ImageCompressWorkerRequest, ImageCompressWorkerResult>(() => new ImageCompressWorker());

  // Same worker as the Image Compressor / Image Cropper's PNG passes — see ImageCompressor's
  // `PngWorkerClient` comment for why the graceful-degradation fallback is preserved across
  // the worker boundary here too.
  const optimizePng = (buffer: ArrayBuffer): Promise<ArrayBuffer> =>
    pngWorker.run({ kind: 'optimizePng', buffer }).then(
      (result) => (result.kind === 'optimizePng' ? result.buffer : buffer),
      (error: unknown) => {
        console.warn('PNG lossless optimization pass failed, keeping the canvas-encoded PNG as-is.', error);
        return buffer;
      }
    );
  const quantizePng = (image: ImageData, q: number): Promise<ImageData> =>
    pngWorker.run({ kind: 'quantizePng', image, quality: q }).then(
      (result) => (result.kind === 'quantizePng' ? new ImageData(result.image.data, result.image.width, result.image.height) : image),
      (error: unknown) => {
        console.warn('PNG lossy quantization failed, keeping the un-quantized pixels.', error);
        return image;
      }
    );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuality(quality), 200);
    return () => window.clearTimeout(timer);
  }, [quality]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPlacement(placement), 200);
    return () => window.clearTimeout(timer);
  }, [placement]);

  // Transparency only survives in PNG — switching to a solid/image background makes the
  // result fully opaque either way, but the format control still only offers JPEG/WebP once
  // there's an actual background to fill with, so this only fires on the transparent<->other
  // transition, never mid-way through an unrelated format change.
  useEffect(() => {
    if (backgroundMode === 'transparent' && format !== 'image/png') setFormat('image/png');
  }, [backgroundMode, format]);

  useEffect(() => {
    if (!file) {
      setFileUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!backgroundImageFile) {
      setBackgroundImageUrl('');
      setBackgroundImageSize(null);
      return;
    }
    const url = URL.createObjectURL(backgroundImageFile);
    setBackgroundImageUrl(url);

    // Decoded only to read its natural dimensions (the placement canvas's own size) and then
    // immediately discarded — the actual pixels are decoded again, separately, by the
    // compositing effect below when it's time to draw. A `<img onLoad>` would work too, but
    // would only fire once the placement stage itself is already rendered, which is gated on
    // this very size being known — decoding here sidesteps that ordering problem entirely.
    let cancelled = false;
    void createImageBitmap(backgroundImageFile).then(
      (bitmap) => {
        const { width, height } = bitmap;
        bitmap.close();
        if (!cancelled) setBackgroundImageSize({ width, height });
      },
      () => {
        if (!cancelled) {
          setBackgroundImageError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
          setBackgroundImageSize(null);
        }
      }
    );

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [backgroundImageFile]);

  // A brand-new (subject, background) pair starts centered, scaled to comfortably fit. Also
  // clears placement outright once either half is missing, so a stale position never lingers
  // (e.g. after switching background modes and back, or clearing the background image).
  useEffect(() => {
    if (!cutoutPixels || !backgroundImageSize) {
      setPlacement(null);
      setDebouncedPlacement(null);
      return;
    }
    const fresh = defaultPlacement(cutoutPixels.width, cutoutPixels.height, backgroundImageSize.width, backgroundImageSize.height);
    setPlacement(fresh);
    setDebouncedPlacement(fresh);
  }, [cutoutPixels, backgroundImageSize]);

  useEffect(() => {
    return () => {
      if (exportResult) URL.revokeObjectURL(exportResult.url);
    };
  }, [exportResult]);

  // A displayable PNG of the raw cutout, independent of the final export — used only for the
  // placement stage's live `<img>` overlay, which needs a URL to display, not raw pixels.
  // Built once per AI result, not on every placement change.
  useEffect(() => {
    if (!cutoutPixels) {
      setCutoutPreviewUrl('');
      return;
    }
    let cancelled = false;
    let createdUrl = '';
    void (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = cutoutPixels.width;
      canvas.height = cutoutPixels.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.putImageData(new ImageData(cutoutPixels.data, cutoutPixels.width, cutoutPixels.height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (cancelled || !blob) return;
      createdUrl = URL.createObjectURL(blob);
      setCutoutPreviewUrl(createdUrl);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [cutoutPixels]);

  // Step 1: decode the file and run it through the AI model — produces `cutoutPixels`, the
  // raw alpha-masked RGBA buffer. Runs once per file; background/format/quality/placement
  // changes below never re-run the (multi-second) AI step, only the (near-instant)
  // compositing step.
  useEffect(() => {
    if (!file) {
      setNaturalSize(null);
      setCutoutPixels(null);
      setLoadError(null);
      setProcessError(null);
      setRemovingBackground(false);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setLoadError(validation.error);
      setNaturalSize(null);
      setCutoutPixels(null);
      return;
    }
    setLoadError(null);
    setProcessError(null);
    setCutoutPixels(null);

    const seq = (removeSeqRef.current += 1);
    const isStale = () => removeSeqRef.current !== seq;
    setRemovingBackground(true);

    let cancelled = false;
    void (async () => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        if (!cancelled && !isStale()) {
          setRemovingBackground(false);
          setLoadError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
        }
        return;
      }
      if (cancelled || isStale()) {
        bitmap.close();
        return;
      }

      const { width, height } = bitmap;
      setNaturalSize({ width, height });

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close();
        setRemovingBackground(false);
        setProcessError('This browser does not support canvas image export.');
        return;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const imageData = context.getImageData(0, 0, width, height);

      try {
        const cutout = await removeWorker.run({ image: { data: imageData.data, width, height } }, { transfer: [imageData.data.buffer] });
        if (cancelled || isStale()) return;
        setCutoutPixels(cutout);
        setRemovingBackground(false);
      } catch (thrown) {
        if (cancelled || isStale()) return;
        setRemovingBackground(false);
        setProcessError(thrown instanceof Error ? thrown.message : 'Background removal failed on this image — try a different file.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Step 2: composite the cutout against the chosen background — freely placed, scaled and
  // rotated when there's a replacement background image — and encode the final export.
  // Re-runs on every background/placement/format/quality change, but never touches the AI
  // model again.
  useEffect(() => {
    if (!cutoutPixels) {
      setExportResult(null);
      return;
    }

    // Bundles the two pieces free placement needs together, rather than checking each
    // separately at every use below — also gives TypeScript a real narrowed, non-null type
    // for both instead of requiring a `!` assertion at each read.
    const placementTarget =
      backgroundMode === 'image' && backgroundImageFile && backgroundImageSize && debouncedPlacement
        ? { size: backgroundImageSize, placement: debouncedPlacement }
        : null;

    const seq = (exportSeqRef.current += 1);
    const isStale = () => exportSeqRef.current !== seq;
    setCompositing(true);
    setProcessError(null);

    let cancelled = false;
    void (async () => {
      // The cutout's own pixels, alpha channel intact, drawn onto its own small canvas —
      // `drawImage`-ing *this* onto the export canvas alpha-blends over whatever background
      // was drawn first. `putImageData` alone can't do that: it overwrites pixels outright
      // rather than blending them, which would erase the background instead of showing
      // through the cutout's transparent areas.
      const cutoutCanvas = document.createElement('canvas');
      cutoutCanvas.width = cutoutPixels.width;
      cutoutCanvas.height = cutoutPixels.height;
      const cutoutContext = cutoutCanvas.getContext('2d');
      if (!cutoutContext) {
        setCompositing(false);
        setProcessError('This browser does not support canvas image export.');
        return;
      }
      cutoutContext.putImageData(new ImageData(cutoutPixels.data, cutoutPixels.width, cutoutPixels.height), 0, 0);

      const canvasWidth = placementTarget ? placementTarget.size.width : cutoutPixels.width;
      const canvasHeight = placementTarget ? placementTarget.size.height : cutoutPixels.height;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        setCompositing(false);
        setProcessError('This browser does not support canvas image export.');
        return;
      }

      try {
        if (backgroundMode === 'color') {
          context.fillStyle = backgroundColor;
          context.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (backgroundMode === 'gradient') {
          const line = computeLinearGradientLine(canvasWidth, canvasHeight, gradientAngle);
          const gradient = context.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
          gradient.addColorStop(0, gradientColorA);
          gradient.addColorStop(1, gradientColorB);
          context.fillStyle = gradient;
          context.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (backgroundMode === 'image' && backgroundImageFile) {
          const bgBitmap = await createImageBitmap(backgroundImageFile);
          if (cancelled || isStale()) {
            bgBitmap.close();
            return;
          }
          // The canvas is already sized to this image's own natural dimensions when a
          // placement is active, so this draws it 1:1 with no cropping — free placement only
          // makes sense against the whole background image, not a "cover"-cropped slice of it.
          context.drawImage(bgBitmap, 0, 0, canvasWidth, canvasHeight);
          bgBitmap.close();
        }

        if (placementTarget) {
          const { x, y, scale, rotation } = placementTarget.placement;
          context.save();
          context.translate(x, y);
          context.rotate((rotation * Math.PI) / 180);
          context.scale(scale, scale);
          context.drawImage(cutoutCanvas, -cutoutPixels.width / 2, -cutoutPixels.height / 2);
          context.restore();
        } else {
          context.drawImage(cutoutCanvas, 0, 0);
        }

        if (format === 'image/png' && pngMode === 'lossy') {
          // Quantization changes pixel values before the encoder ever sees them — it must
          // happen here, on the canvas, since the browser's canvas PNG encoder itself has no
          // lossy mode.
          const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
          context.putImageData(await quantizePng(imageData, debouncedQuality), 0, 0);
        }

        let blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, format, LOSSY_FORMATS.has(format) ? debouncedQuality : undefined)
        );
        if (!blob) throw new Error('Could not export the result as an image.');

        if (format === 'image/png') {
          // A generic deflate pass only — Oxipng (WASM) finds real extra savings on top with
          // no pixel changes, so it's always worth trying, and only kept if it actually helped.
          const optimized = await optimizePng(await blob.arrayBuffer());
          const optimizedBlob = new Blob([optimized], { type: 'image/png' });
          if (optimizedBlob.size < blob.size) blob = optimizedBlob;
        }

        if (cancelled || isStale()) return;
        setExportResult({ blob, url: URL.createObjectURL(blob), width: canvasWidth, height: canvasHeight });
        setCompositing(false);
      } catch (thrown) {
        if (cancelled || isStale()) return;
        setCompositing(false);
        setProcessError(thrown instanceof Error ? thrown.message : 'Could not export the result as an image.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cutoutPixels,
    backgroundMode,
    backgroundColor,
    gradientColorA,
    gradientColorB,
    gradientAngle,
    backgroundImageFile,
    backgroundImageSize,
    debouncedPlacement,
    format,
    debouncedQuality,
    pngMode,
  ]);

  const loadExample = () => {
    void loadSampleImageFile()
      .then((sample) => setFile(sample))
      .catch(() => setLoadError('Could not load the sample image — check your connection and try again.'));
  };

  const removeFile = () => {
    setFile(null);
    setBackgroundMode('transparent');
    setBackgroundColor(DEFAULT_BACKGROUND_COLOR);
    setGradientColorA(DEFAULT_GRADIENT_COLOR_A);
    setGradientColorB(DEFAULT_GRADIENT_COLOR_B);
    setGradientAngle(DEFAULT_GRADIENT_ANGLE);
    setBackgroundImageFile(null);
    setBackgroundImageError(null);
    setFormat('image/png');
    setPngMode('lossless');
    setQuality(DEFAULT_QUALITY);
    setDebouncedQuality(DEFAULT_QUALITY);
  };

  const chooseBackgroundImage = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    const validation = validateImageFile(chosen);
    if (!validation.ok) {
      setBackgroundImageError(validation.error);
      return;
    }
    setBackgroundImageError(null);
    setBackgroundImageFile(chosen);
  };

  const resetPlacement = () => {
    if (!cutoutPixels || !backgroundImageSize) return;
    const fresh = defaultPlacement(cutoutPixels.width, cutoutPixels.height, backgroundImageSize.width, backgroundImageSize.height);
    setPlacement(fresh);
    setDebouncedPlacement(fresh);
  };

  /** Converts a pointer event's client coordinates into the background canvas's own pixel
   *  space, using the stage's rendered (CSS-scaled) size to recover the ratio — the same
   *  `scaleFactor()` technique the Image Cropper uses for its crop box. */
  const pointerToCanvasPoint = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = placeStageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || !backgroundImageSize) return null;
    const scale = backgroundImageSize.width / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };

  const beginPlaceDrag = (mode: PlaceDragMode) => (event: PointerEvent) => {
    if (!placement) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = pointerToCanvasPoint(event);
    if (!point) return;
    placeDragRef.current = { mode, startPointer: point, startPlacement: placement };
  };

  const onPlaceDragMove = (event: PointerEvent) => {
    const drag = placeDragRef.current;
    if (!drag || !cutoutPixels) return;
    const point = pointerToCanvasPoint(event);
    if (!point) return;

    if (drag.mode === 'move') {
      const dx = point.x - drag.startPointer.x;
      const dy = point.y - drag.startPointer.y;
      setPlacement({ ...drag.startPlacement, x: drag.startPlacement.x + dx, y: drag.startPlacement.y + dy });
      return;
    }

    // `scale` and `rotate` both measure from the placement's own center as it was when the
    // drag began, not from the pointer's own start position — the handle being dragged is
    // near the cutout's corner/top, not its center, so this is the vector that actually
    // matters for "how big" / "which way" the cutout should now be.
    const { x: cx, y: cy } = drag.startPlacement;

    if (drag.mode === 'scale') {
      // Distance from center to the cutout's own corner at scale 1 — rotation doesn't change
      // a point's distance from the center it's rotating around, so this needs no
      // rotation-aware math despite the handle itself being drawn at a rotated position.
      const baseDistance = Math.sqrt((cutoutPixels.width / 2) ** 2 + (cutoutPixels.height / 2) ** 2);
      const distance = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
      const nextScale = baseDistance > 0 ? Math.max(MIN_PLACEMENT_SCALE, distance / baseDistance) : drag.startPlacement.scale;
      setPlacement({ ...drag.startPlacement, scale: nextScale });
      return;
    }

    // rotate: the angle from center to the pointer, offset by 90° since the handle starts
    // directly *above* center (angle -90° in standard atan2) and should read as "0 rotation"
    // from there.
    const angle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI + 90;
    setPlacement({ ...drag.startPlacement, rotation: angle });
  };

  const endPlaceDrag = () => {
    placeDragRef.current = null;
  };

  const download = () => {
    if (!exportResult || !file) return;
    const suffix = backgroundMode === 'transparent' ? 'no-bg' : 'new-bg';
    downloadUrl(exportResult.url, `${baseName(file.name)}-${suffix}.${OUTPUT_FORMAT_EXTENSIONS[format]}`);
  };

  const busy = removingBackground || compositing;

  // The placement stage only renders once every piece it needs actually exists — computed
  // once per render rather than re-checked at each JSX use site below.
  const placementReady =
    backgroundMode === 'image' && backgroundImageFile && backgroundImageUrl && backgroundImageSize && placement && cutoutPixels && cutoutPreviewUrl
      ? { url: backgroundImageUrl, size: backgroundImageSize, placement, cutout: cutoutPixels, cutoutUrl: cutoutPreviewUrl }
      : null;

  let cutoutStyle = '';
  let rotateHandleStyle = '';
  let scaleHandleStyle = '';
  if (placementReady) {
    const { size, placement: p, cutout } = placementReady;
    const widthPct = (cutout.width / size.width) * 100;
    cutoutStyle = `left:${(p.x / size.width) * 100}%; top:${(p.y / size.height) * 100}%; width:${widthPct}%; transform: translate(-50%, -50%) rotate(${p.rotation}deg) scale(${p.scale})`;

    const rotateLocal = rotatePoint(p.x, p.y - (cutout.height / 2) * ROTATE_HANDLE_MARGIN * p.scale, p.x, p.y, p.rotation);
    rotateHandleStyle = `left:${(rotateLocal.x / size.width) * 100}%; top:${(rotateLocal.y / size.height) * 100}%`;

    const scaleLocal = rotatePoint(p.x + (cutout.width / 2) * p.scale, p.y + (cutout.height / 2) * p.scale, p.x, p.y, p.rotation);
    scaleHandleStyle = `left:${(scaleLocal.x / size.width) * 100}%; top:${(scaleLocal.y / size.height) * 100}%`;
  }

  return (
    <div class="tool">
      {/* No share link: the input is an uploaded image file, not text — there's no
          practical way to carry arbitrary photo bytes in a shareable URL. */}
      <div class="tool-bar">
        <p class="field__hint">
          Runs a small AI model entirely in your browser — nothing is uploaded. The first image on this device downloads the model
          (~18&nbsp;MB total); every image after that is fast.
        </p>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Generate a sample image to try the tool with">
          Load example
        </button>
        <button type="button" class="btn" onClick={removeFile} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to remove the background from" accept="image/*" />}

      <ErrorMessage message={loadError} />

      {file && naturalSize && (
        <div class="bg-remove-result">
          <p class="field__hint">
            {file.name} · {naturalSize.width}×{naturalSize.height}px · {formatBytes(file.size)} original
          </p>

          <ErrorMessage message={processError} />

          {removingBackground && !cutoutPixels && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Removing background… this can take several seconds, longer the first time
              while the AI model downloads.
            </p>
          )}

          {cutoutPixels && (
            <>
              <div class="bg-options">
                <div class="seg" role="group" aria-label="Replacement background">
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'transparent'}
                    onClick={() => setBackgroundMode('transparent')}
                    title="Keep the cut-out area transparent — a PNG with an alpha channel."
                  >
                    Transparent
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'color'}
                    onClick={() => setBackgroundMode('color')}
                    title="Fill the cut-out area with a solid color."
                  >
                    Color
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'gradient'}
                    onClick={() => setBackgroundMode('gradient')}
                    title="Fill the cut-out area with a two-color gradient."
                  >
                    Gradient
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'image'}
                    onClick={() => setBackgroundMode('image')}
                    title="Place the cutout on another image — drag, resize and rotate it freely."
                  >
                    Image
                  </button>
                </div>

                {backgroundMode === 'color' && (
                  <label class="control control--inline" title="Pick the solid color to fill the removed background with.">
                    <span class="field__hint">Background color</span>
                    <input
                      type="color"
                      class="color-input"
                      value={backgroundColor}
                      onInput={(event) => setBackgroundColor((event.target as HTMLInputElement).value)}
                      aria-label="Background color"
                    />
                  </label>
                )}

                {backgroundMode === 'gradient' && (
                  <>
                    <label class="control control--inline" title="The gradient's first color.">
                      <span class="field__hint">From</span>
                      <input
                        type="color"
                        class="color-input"
                        value={gradientColorA}
                        onInput={(event) => setGradientColorA((event.target as HTMLInputElement).value)}
                        aria-label="Gradient start color"
                      />
                    </label>
                    <label class="control control--inline" title="The gradient's second color.">
                      <span class="field__hint">To</span>
                      <input
                        type="color"
                        class="color-input"
                        value={gradientColorB}
                        onInput={(event) => setGradientColorB((event.target as HTMLInputElement).value)}
                        aria-label="Gradient end color"
                      />
                    </label>
                    <div class="seg" role="group" aria-label="Gradient direction">
                      {GRADIENT_DIRECTIONS.map((direction) => (
                        <button
                          key={direction.angle}
                          type="button"
                          class="seg__btn"
                          aria-pressed={gradientAngle === direction.angle}
                          onClick={() => setGradientAngle(direction.angle)}
                          title={direction.title}
                          aria-label={direction.title}
                        >
                          {direction.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {backgroundMode === 'image' && (
                  <div class="control control--inline">
                    <label class="btn" title="Choose an image to place the cutout on top of.">
                      {backgroundImageFile ? 'Change background image' : 'Choose background image'}
                      <input type="file" class="sr-only" accept="image/*" aria-label="Choose a replacement background image" onChange={chooseBackgroundImage} />
                    </label>
                    {backgroundImageFile && <span class="field__hint">{backgroundImageFile.name}</span>}
                    {!backgroundImageFile && <span class="field__hint">No background image chosen yet — the area stays transparent until you pick one.</span>}
                  </div>
                )}
                <ErrorMessage message={backgroundImageError} />
              </div>

              {placementReady && (
                <div class="place-section">
                  {/* The overlay below is a pointer-only convenience — every value it changes
                      is also a plain, fully keyboard-operable number field beneath it, the same
                      split the Image Cropper's crop box uses between its draggable stage and
                      the underlying number inputs. */}
                  <p class="field__hint">Drag the cutout to move it, the corner handle to resize, or the top handle to rotate.</p>
                  <div class="place-stage-wrap">
                    <div
                      class="place-stage"
                      ref={placeStageRef}
                      style={`aspect-ratio:${placementReady.size.width}/${placementReady.size.height}; width:min(100%, ${MAX_PLACE_STAGE_HEIGHT_REM}rem * ${placementReady.size.width} / ${placementReady.size.height})`}
                    >
                      {/* Clipped to the canvas bounds (what the export actually looks like) —
                          the handles below deliberately live outside this layer, since a
                          handle for a cutout scaled to fill the frame can easily land above
                          or beside the canvas itself and must stay visible/reachable there. */}
                      <div class="place-stage__frame">
                        <img src={placementReady.url} alt="" class="place-stage__bg" draggable={false} />
                        <img
                          src={placementReady.cutoutUrl}
                          alt=""
                          class="place-stage__cutout"
                          draggable={false}
                          style={cutoutStyle}
                          onPointerDown={beginPlaceDrag('move')}
                          onPointerMove={onPlaceDragMove}
                          onPointerUp={endPlaceDrag}
                        />
                      </div>
                      <div
                        class="place-handle place-handle--rotate"
                        style={rotateHandleStyle}
                        onPointerDown={beginPlaceDrag('rotate')}
                        onPointerMove={onPlaceDragMove}
                        onPointerUp={endPlaceDrag}
                        title="Drag to rotate"
                        aria-hidden="true"
                      >
                        ↻
                      </div>
                      <div
                        class="place-handle place-handle--scale"
                        style={scaleHandleStyle}
                        onPointerDown={beginPlaceDrag('scale')}
                        onPointerMove={onPlaceDragMove}
                        onPointerUp={endPlaceDrag}
                        title="Drag to resize"
                        aria-hidden="true"
                      >
                        ⤡
                      </div>
                    </div>
                  </div>
                  <div class="place-fields">
                    <label class="control">
                      <span class="field__hint">X</span>
                      <input
                        type="number"
                        class="input"
                        value={Math.round(placementReady.placement.x)}
                        aria-label="Cutout horizontal position in pixels"
                        onInput={(event) => setPlacement({ ...placementReady.placement, x: Number((event.target as HTMLInputElement).value) })}
                      />
                    </label>
                    <label class="control">
                      <span class="field__hint">Y</span>
                      <input
                        type="number"
                        class="input"
                        value={Math.round(placementReady.placement.y)}
                        aria-label="Cutout vertical position in pixels"
                        onInput={(event) => setPlacement({ ...placementReady.placement, y: Number((event.target as HTMLInputElement).value) })}
                      />
                    </label>
                    <label class="control">
                      <span class="field__hint">Scale (%)</span>
                      <input
                        type="number"
                        class="input"
                        min={Math.round(MIN_PLACEMENT_SCALE * 100)}
                        value={Math.round(placementReady.placement.scale * 100)}
                        aria-label="Cutout scale as a percentage"
                        onInput={(event) => {
                          const percent = Number((event.target as HTMLInputElement).value);
                          setPlacement({ ...placementReady.placement, scale: Math.max(MIN_PLACEMENT_SCALE, percent / 100) });
                        }}
                      />
                    </label>
                    <label class="control">
                      <span class="field__hint">Rotation (°)</span>
                      <input
                        type="number"
                        class="input"
                        value={Math.round(placementReady.placement.rotation)}
                        aria-label="Cutout rotation in degrees"
                        onInput={(event) => setPlacement({ ...placementReady.placement, rotation: Number((event.target as HTMLInputElement).value) })}
                      />
                    </label>
                    <button type="button" class="btn" onClick={resetPlacement} title="Recenter the cutout and reset its scale and rotation">
                      Reset placement
                    </button>
                  </div>
                </div>
              )}

              <div class="bg-options">
                <div class="seg" role="group" aria-label="Output format">
                  {OUTPUT_FORMATS.filter((f) => backgroundMode !== 'transparent' || f === 'image/png').map((f) => (
                    <button
                      key={f}
                      type="button"
                      class="seg__btn"
                      aria-pressed={format === f}
                      onClick={() => setFormat(f)}
                      title={
                        f === 'image/png'
                          ? 'PNG — lossless by default; switch to Lossy mode below for palette-based compression'
                          : `${OUTPUT_FORMAT_LABELS[f]} — lossy, adjustable quality`
                      }
                    >
                      {OUTPUT_FORMAT_LABELS[f]}
                    </button>
                  ))}
                </div>

                {format === 'image/png' && (
                  <div class="seg" role="group" aria-label="PNG compression mode">
                    <button type="button" class="seg__btn" aria-pressed={pngMode === 'lossless'} onClick={() => setPngMode('lossless')} title="No pixel is ever changed — the safe default.">
                      Lossless
                    </button>
                    <button
                      type="button"
                      class="seg__btn"
                      aria-pressed={pngMode === 'lossy'}
                      onClick={() => setPngMode('lossy')}
                      title="Reduces the image to a smaller color palette for a much smaller file — a real, visible quality trade-off."
                    >
                      Lossy (smaller)
                    </button>
                  </div>
                )}

                {(() => {
                  const isPngLossy = format === 'image/png' && pngMode === 'lossy';
                  if (!LOSSY_FORMATS.has(format) && !isPngLossy) return null;
                  return (
                    <label
                      class="control"
                      title={
                        isPngLossy
                          ? 'Fewer colors means a smaller file but more visible banding, especially in gradients and photos.'
                          : '70-85% is usually visually indistinguishable from the original while cutting file size dramatically.'
                      }
                    >
                      <span class="field__hint">{isPngLossy ? `Colors (~${qualityToColorCount(quality)})` : `Quality (${Math.round(quality * 100)}%)`}</span>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={Math.round(quality * 100)}
                        aria-label="Quality"
                        onInput={(event) => setQuality(Number((event.target as HTMLInputElement).value) / 100)}
                      />
                    </label>
                  );
                })()}
              </div>

              {exportResult ? (
                <>
                  <p class="bg-remove-result__stats">
                    <SavingsBadge beforeBytes={file.size} afterBytes={exportResult.blob.size} />
                    <span class="field__hint">
                      {formatBytes(file.size)} → {formatBytes(exportResult.blob.size)}
                    </span>
                    {busy && (
                      <span class="field__hint">
                        <span class="job__spinner" aria-hidden="true" /> Updating…
                      </span>
                    )}
                    <span class="tool-bar__spacer" />
                    <button type="button" class="btn btn--primary" onClick={download} title="Save the result">
                      <span aria-hidden="true">⭳</span> Download {OUTPUT_FORMAT_LABELS[format]}
                    </button>
                  </p>
                  <CompareSlider
                    beforeUrl={fileUrl}
                    afterUrl={exportResult.url}
                    width={exportResult.width}
                    height={exportResult.height}
                    beforeLabel="Original"
                    afterLabel="Result"
                    transparent
                  />
                </>
              ) : (
                compositing && (
                  <p class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Applying background…
                  </p>
                )
              )}
            </>
          )}
        </div>
      )}

      <style>{`
        .bg-remove-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .bg-remove-result__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0; }
        .bg-options { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        .control { display: flex; flex-direction: column; gap: var(--space-1); }
        .control--inline { flex-direction: row; align-items: center; gap: var(--space-2); }
        .color-input { width: 2.5rem; height: 2rem; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; }

        .place-section { display: flex; flex-direction: column; gap: var(--space-2); }
        /* Top/side padding gives the rotate/scale handles room to sit outside the canvas
           frame (a cutout scaled to fill it pushes its handles past the frame's own edges)
           without overlapping the hint text above or getting clipped by a narrower viewport. */
        .place-stage-wrap { display: flex; padding: 1.5rem 1.5rem 0; }
        .place-stage { position: relative; margin: 0; touch-action: none; user-select: none; }
        /* Everything that's actually part of the exported image lives in this clipped inner
           layer; the handles below are meta-UI drawn on top of it and must stay reachable
           even when they land outside the canvas bounds, so they're siblings of this layer,
           not children of it. */
        .place-stage__frame {
          position: absolute; inset: 0; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2);
        }
        .place-stage__bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
        .place-stage__cutout {
          position: absolute; top: 0; left: 0; height: auto; max-width: none;
          cursor: move; touch-action: none;
        }
        .place-handle {
          position: absolute; width: 1.75rem; height: 1.75rem; margin: -0.875rem;
          display: flex; align-items: center; justify-content: center;
          font-size: 1rem; line-height: 1; color: var(--accent-contrast);
          border-radius: 999px; background: var(--accent); border: 2px solid var(--accent-contrast);
          box-shadow: 0 1px 4px rgb(0 0 0 / 0.35); touch-action: none; user-select: none;
        }
        .place-handle--scale { cursor: nwse-resize; }
        .place-handle--rotate { cursor: alias; }
        .place-fields { display: grid; grid-template-columns: repeat(4, 1fr) auto; gap: var(--space-2); align-items: end; }
        @media (max-width: 40rem) {
          .place-fields { grid-template-columns: 1fr 1fr; }
        }
        /* .job__spinner (shared with every other worker-backed tool) lives in src/styles/tool.css. */
      `}</style>
    </div>
  );
}
