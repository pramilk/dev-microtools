import { useEffect, useRef, useState } from 'preact/hooks';
import {
  validateImageFile,
  qualityToColorCount,
  OUTPUT_FORMATS,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMAT_EXTENSIONS,
  LOSSY_FORMATS,
  DEFAULT_QUALITY,
  type OutputFormat,
  type PngMode,
} from '../lib/tools/imageCompress';
import {
  aspectRatioForPreset,
  clampCropPosition,
  clampCropRect,
  constrainRectToAspectRatio,
  resolveResizeDimensions,
  ASPECT_PRESETS,
  ASPECT_PRESET_LABELS,
  type AspectPreset,
  type CropRect,
} from '../lib/tools/imageCrop';
import { FileDropzone } from './shared/FileDropzone';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { ResizeFields } from './shared/ResizeFields';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import ImageCompressWorker from '../workers/imageCompress.worker?worker';
import type { ImageCompressWorkerRequest, ImageCompressWorkerResult } from '../workers/imageCompress.worker';

// Deliberately no ShareLinkButton — the input is a binary image from the visitor's disk,
// which can't (and shouldn't) be encoded into a URL. Crop rectangle and resize dimensions
// are meaningless without the image they apply to. Same reasoning across all three image
// tools.

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
/** Height cap for the crop stage's "fit" size (zoom 100%) — kept as one constant so the
 *  inline width formula and the scroll wrapper's own max-height can never drift apart. */
const MAX_STAGE_HEIGHT_REM = 26;

type DragMode = 'move' | 'resize';
interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startRect: CropRect;
}

interface CropResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

const baseName = (name: string): string => name.replace(/\.[^./]+$/, '') || 'image';

/**
 * Generates a synthetic sample image via canvas for "Load example" — four distinct
 * colored quadrants plus a centered circle, so a crop/resize actually looks like it did
 * something rather than needing a bundled photo asset. Painted as an inset badge on an
 * otherwise untouched (fully transparent) canvas, rather than edge-to-edge, so the sample
 * also has real alpha transparency around it to demonstrate the checkerboard background
 * shown behind a PNG's transparent areas — a fully opaque canvas would never reveal it.
 */
async function generateSampleImageFile(): Promise<File> {
  const width = 800;
  const height = 600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not support canvas image export.');

  const squareSize = Math.round(Math.min(width, height) * 0.7);
  const squareLeft = Math.round((width - squareSize) / 2);
  const squareTop = Math.round((height - squareSize) / 2);
  const halfSize = squareSize / 2;

  const colors = ['#3cbcd4', '#7c5cff', '#ffd166', '#06d6a0'];
  context.fillStyle = colors[0]!;
  context.fillRect(squareLeft, squareTop, halfSize, halfSize);
  context.fillStyle = colors[1]!;
  context.fillRect(squareLeft + halfSize, squareTop, halfSize, halfSize);
  context.fillStyle = colors[2]!;
  context.fillRect(squareLeft, squareTop + halfSize, halfSize, halfSize);
  context.fillStyle = colors[3]!;
  context.fillRect(squareLeft + halfSize, squareTop + halfSize, halfSize, halfSize);

  context.fillStyle = '#0d1117';
  context.beginPath();
  context.arc(squareLeft + halfSize, squareTop + halfSize, squareSize * 0.18, 0, Math.PI * 2);
  context.fill();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not generate a sample image.');
  return new File([blob], 'sample.png', { type: 'image/png' });
}

/**
 * Decodes and re-encodes an image through an off-screen canvas — inherently DOM-bound
 * (`ImageBitmap`, `<canvas>`), so like the Image Compressor, this stays in the island
 * rather than the pure logic layer in `lib/tools`.
 */
export default function ImageCropper() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [resizeWidth, setResizeWidth] = useState('');
  const [resizeHeight, setResizeHeight] = useState('');
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [format, setFormat] = useState<OutputFormat>('image/jpeg');
  /** PNG's compression mode — only relevant when `format === 'image/png'`. Defaults to
   *  lossless, matching this tool's original PNG behavior; switching to lossy is opt-in. */
  const [pngMode, setPngMode] = useState<PngMode>('lossless');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [result, setResult] = useState<CropResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const seqRef = useRef(0);
  const pendingExampleRef = useRef(false);

  const pngWorkerTask = useWorkerTask<ImageCompressWorkerRequest, ImageCompressWorkerResult>(() => new ImageCompressWorker());
  /** Same worker as the Image Compressor's PNG passes — see that file's `PngWorkerClient`
   *  comment for why the graceful-degradation fallback is preserved across the worker
   *  boundary here too. */
  const optimizePng = (buffer: ArrayBuffer): Promise<ArrayBuffer> =>
    pngWorkerTask.run({ kind: 'optimizePng', buffer }).then(
      (result) => (result.kind === 'optimizePng' ? result.buffer : buffer),
      (error: unknown) => {
        console.warn('PNG lossless optimization pass failed, keeping the canvas-encoded PNG as-is.', error);
        return buffer;
      }
    );
  const quantizePng = (image: ImageData, quality: number): Promise<ImageData> =>
    pngWorkerTask.run({ kind: 'quantizePng', image, quality }).then(
      (result) => (result.kind === 'quantizePng' ? new ImageData(result.image.data, result.image.width, result.image.height) : image),
      (error: unknown) => {
        console.warn('PNG lossy quantization failed, keeping the un-quantized pixels.', error);
        return image;
      }
    );

  // Debounces the quality slider the same way the Image Compressor does — recompression
  // on every tick made dragging feel laggy.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuality(quality), 200);
    return () => window.clearTimeout(timer);
  }, [quality]);

  useEffect(() => {
    if (!file) {
      setFileUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Revokes the *previous* result's object URL once a newer one replaces it (or on
  // unmount) — the standard "clean up the old value" effect-cleanup pattern.
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  useEffect(() => {
    if (!file) {
      bitmapRef.current?.close();
      bitmapRef.current = null;
      setNaturalSize(null);
      setCropRect(null);
      setResult(null);
      setLoadError(null);
      setProcessError(null);
      setZoom(1);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setLoadError(validation.error);
      setNaturalSize(null);
      setCropRect(null);
      return;
    }
    setLoadError(null);

    let cancelled = false;
    createImageBitmap(file)
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current?.close();
        bitmapRef.current = bitmap;
        const size = { width: bitmap.width, height: bitmap.height };
        setNaturalSize(size);
        setZoom(1);
        setFormat((OUTPUT_FORMATS as readonly string[]).includes(file.type) ? (file.type as OutputFormat) : 'image/jpeg');
        setPngMode('lossless');

        if (pendingExampleRef.current) {
          pendingExampleRef.current = false;
          const side = Math.round(Math.min(size.width, size.height) * 0.6);
          setCropRect(
            clampCropRect(
              { x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side },
              size.width,
              size.height
            )
          );
          setAspectPreset('1:1');
          setResizeEnabled(true);
          setResizeWidth('300');
          setResizeHeight('300');
        } else {
          setCropRect({ x: 0, y: 0, width: size.width, height: size.height });
          setAspectPreset('free');
          setResizeEnabled(false);
          setResizeWidth('');
          setResizeHeight('');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Recomputes the cropped/resized output whenever the crop, resize target, or output
  // settings change. Runs directly against the cached bitmap (decoded once per file, not
  // once per redraw), which matters here since cropping/resizing happens interactively.
  useEffect(() => {
    const bitmap = bitmapRef.current;
    if (!bitmap || !cropRect) return;

    const seq = (seqRef.current += 1);
    setBusy(true);
    setProcessError(null);

    const targetWidth = resizeEnabled && resizeWidth.trim() !== '' ? Number(resizeWidth) : null;
    const targetHeight = resizeEnabled && resizeHeight.trim() !== '' ? Number(resizeHeight) : null;
    const { width: outWidth, height: outHeight } = resolveResizeDimensions(
      cropRect.width,
      cropRect.height,
      targetWidth !== null && Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth : null,
      targetHeight !== null && Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : null,
      lockAspectRatio
    );

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setBusy(false);
      setProcessError('This browser does not support canvas image export.');
      return;
    }
    context.drawImage(bitmap, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, outWidth, outHeight);

    const encode = async () => {
      if (format === 'image/png' && pngMode === 'lossy') {
        // Quantization changes pixel values before the encoder ever sees them — it must
        // happen here, on the canvas, since the browser's canvas PNG encoder itself has no
        // lossy mode.
        const imageData = context.getImageData(0, 0, outWidth, outHeight);
        context.putImageData(await quantizePng(imageData, debouncedQuality), 0, 0);
      }

      canvas.toBlob(
        (blob) => {
          if (seqRef.current !== seq) return;
          if (!blob) {
            setBusy(false);
            setProcessError('Could not process this image — try a different format.');
            return;
          }

          const finish = (finalBlob: Blob) => {
            if (seqRef.current !== seq) return;
            setResult({ blob: finalBlob, url: URL.createObjectURL(finalBlob), width: outWidth, height: outHeight });
            setBusy(false);
          };

          if (format === 'image/png') {
            void blob
              .arrayBuffer()
              .then(optimizePng)
              .then((optimized) => {
                const optimizedBlob = new Blob([optimized], { type: 'image/png' });
                finish(optimizedBlob.size < blob.size ? optimizedBlob : blob);
              });
          } else {
            finish(blob);
          }
        },
        format,
        LOSSY_FORMATS.has(format) ? debouncedQuality : undefined
      );
    };
    void encode();
  }, [cropRect, resizeEnabled, resizeWidth, resizeHeight, lockAspectRatio, format, debouncedQuality, pngMode]);

  const scaleFactor = (): number => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || !naturalSize) return 1;
    return naturalSize.width / rect.width;
  };

  const beginDrag = (mode: DragMode) => (event: PointerEvent) => {
    if (!cropRect) return;
    if (mode === 'resize') event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, startRect: cropRect };
  };

  const onDragMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !naturalSize) return;
    const scale = scaleFactor();
    const dx = (event.clientX - drag.startX) * scale;
    const dy = (event.clientY - drag.startY) * scale;

    if (drag.mode === 'move') {
      const moved = { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy };
      setCropRect(clampCropPosition(moved, naturalSize.width, naturalSize.height));
    } else {
      const resized = { ...drag.startRect, width: drag.startRect.width + dx, height: drag.startRect.height + dy };
      const ratio = aspectRatioForPreset(aspectPreset);
      setCropRect(
        ratio !== null
          ? constrainRectToAspectRatio(resized, ratio, naturalSize.width, naturalSize.height)
          : clampCropRect(resized, naturalSize.width, naturalSize.height)
      );
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const updateCropField = (field: keyof CropRect, raw: string) => {
    if (!cropRect || !naturalSize) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;

    const next: CropRect = { ...cropRect, [field]: value };
    const ratio = aspectRatioForPreset(aspectPreset);
    if (ratio !== null) {
      if (field === 'width') next.height = next.width / ratio;
      else if (field === 'height') next.width = next.height * ratio;
    }

    setCropRect(
      field === 'x' || field === 'y'
        ? clampCropPosition(next, naturalSize.width, naturalSize.height)
        : clampCropRect(next, naturalSize.width, naturalSize.height)
    );
  };

  const selectAspectPreset = (preset: AspectPreset) => {
    setAspectPreset(preset);
    if (!cropRect || !naturalSize) return;
    const ratio = aspectRatioForPreset(preset);
    if (ratio === null) return;
    setCropRect(constrainRectToAspectRatio(cropRect, ratio, naturalSize.width, naturalSize.height));
  };

  const resetCrop = () => {
    if (!naturalSize) return;
    setAspectPreset('free');
    setCropRect({ x: 0, y: 0, width: naturalSize.width, height: naturalSize.height });
  };

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => setZoom(1);

  // Ctrl/Cmd+scroll to zoom, matching the map/design-tool convention — gated on the
  // modifier so plain scrolling still pans a zoomed-in image instead of fighting it.
  // Browsers also report a trackpad pinch gesture as a wheel event with ctrlKey set,
  // so this covers both without extra handling. A smaller step than the +/- buttons use
  // keeps continuous scroll input from jumping in large, jarring increments.
  const onWheelZoom = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const step = 0.1;
    setZoom((z) => {
      const next = z + (event.deltaY < 0 ? step : -step);
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +next.toFixed(2)));
    });
  };

  const loadExample = () => {
    void generateSampleImageFile().then((sample) => {
      pendingExampleRef.current = true;
      setFile(sample);
    });
  };

  const removeFile = () => {
    setFile(null);
  };

  const download = () => {
    if (!result || !file) return;
    downloadUrl(result.url, `${baseName(file.name)}-cropped.${OUTPUT_FORMAT_EXTENSIONS[format]}`);
  };

  return (
    <div class="tool">
      {/* No share link: the input is an uploaded image file, not text — there's no
          practical way to carry arbitrary photo bytes in a shareable URL. */}
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Output format">
          {OUTPUT_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              class="seg__btn"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
              title={f === 'image/png' ? 'PNG — lossless by default; switch to Lossy mode below for palette-based compression' : `${OUTPUT_FORMAT_LABELS[f]} — lossy, adjustable quality`}
            >
              {OUTPUT_FORMAT_LABELS[f]}
            </button>
          ))}
        </div>

        {format === 'image/png' && (
          <div class="seg" role="group" aria-label="PNG compression mode">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={pngMode === 'lossless'}
              onClick={() => setPngMode('lossless')}
              title="No pixel is ever changed — the safe default."
            >
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

        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Generate a sample image to try cropping and resizing">
          Load example
        </button>
        <button type="button" class="btn" onClick={removeFile} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && (
        <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to crop" accept="image/*" />
      )}

      <ErrorMessage message={loadError} />

      {file && naturalSize && cropRect && (
        <>
          <div class="crop-layout">
            <div class="crop-stage-wrap">
              <div class="crop-stage-scroll" onWheel={onWheelZoom}>
                <div
                  class={`crop-stage${file.type === 'image/png' ? ' crop-stage--checkerboard' : ''}`}
                  ref={stageRef}
                  style={`aspect-ratio:${naturalSize.width}/${naturalSize.height}; width:calc(min(100%, ${MAX_STAGE_HEIGHT_REM}rem * ${naturalSize.width} / ${naturalSize.height}) * ${zoom})`}
                >
                  <img src={fileUrl} alt="" class="crop-stage__img" draggable={false} />
                  <div
                    class="crop-box"
                    style={`left:${(cropRect.x / naturalSize.width) * 100}%; top:${(cropRect.y / naturalSize.height) * 100}%; width:${(cropRect.width / naturalSize.width) * 100}%; height:${(cropRect.height / naturalSize.height) * 100}%`}
                    onPointerDown={beginDrag('move')}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                  >
                    <div
                      class="crop-box__handle"
                      onPointerDown={beginDrag('resize')}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      title="Drag to resize the crop area"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </div>
              <p class="field__hint">
                {file.name} · {naturalSize.width}×{naturalSize.height}px · {formatBytes(file.size)} original
              </p>
              <div class="crop-stage-toolbar">
                <button type="button" class="btn" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} title="Zoom out" aria-label="Zoom out">
                  −
                </button>
                <span class="crop-zoom-level" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <button type="button" class="btn" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} title="Zoom in to see detail" aria-label="Zoom in">
                  +
                </button>
                {zoom !== 1 && (
                  <button type="button" class="btn" onClick={resetZoom} title="Reset zoom to fit the image in view">
                    Reset zoom
                  </button>
                )}
                <span class="field__hint">Ctrl/⌘ + scroll to zoom, or drag the corner to resize the preview.</span>
              </div>
            </div>

            <div class="crop-controls">
              {/* The overlay above is a pointer-only convenience — every value it changes is
                  also a plain, fully keyboard-operable number field below, the same split
                  CompareSlider uses between its draggable stage and its underlying range input. */}
              <div class="crop-section">
                <h3 class="crop-section__title">Crop area</h3>
                <div class="crop-fields">
                  <label class="control">
                    <span class="field__hint">X</span>
                    <input type="number" class="input" value={Math.round(cropRect.x)} onInput={(e) => updateCropField('x', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="control">
                    <span class="field__hint">Y</span>
                    <input type="number" class="input" value={Math.round(cropRect.y)} onInput={(e) => updateCropField('y', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="control">
                    <span class="field__hint">Width</span>
                    <input type="number" class="input" min="1" value={Math.round(cropRect.width)} onInput={(e) => updateCropField('width', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="control">
                    <span class="field__hint">Height</span>
                    <input type="number" class="input" min="1" value={Math.round(cropRect.height)} onInput={(e) => updateCropField('height', (e.target as HTMLInputElement).value)} />
                  </label>
                </div>
                <div class="crop-preset-row">
                  <div class="seg" role="group" aria-label="Aspect ratio">
                    {ASPECT_PRESETS.map((preset) => (
                      <button key={preset} type="button" class="seg__btn" aria-pressed={aspectPreset === preset} onClick={() => selectAspectPreset(preset)}>
                        {ASPECT_PRESET_LABELS[preset]}
                      </button>
                    ))}
                  </div>
                  <button type="button" class="btn" onClick={resetCrop} title="Reset the crop to the full image">
                    Reset
                  </button>
                </div>
              </div>

              <ResizeFields
                enabled={resizeEnabled}
                onToggleEnabled={setResizeEnabled}
                width={resizeWidth}
                height={resizeHeight}
                lockAspectRatio={lockAspectRatio}
                sourceWidth={cropRect.width}
                sourceHeight={cropRect.height}
                onChange={(next) => {
                  setResizeWidth(next.width);
                  setResizeHeight(next.height);
                  setLockAspectRatio(next.lockAspectRatio);
                }}
              />

              {(() => {
                const isPngLossy = format === 'image/png' && pngMode === 'lossy';
                if (!LOSSY_FORMATS.has(format) && !isPngLossy) return null;
                return (
                  <div class="crop-section">
                    <label
                      class="control"
                      title={
                        isPngLossy
                          ? 'Fewer colors means a smaller file but more visible banding, especially in gradients and photos. Sharp-edged graphics (icons, screenshots with flat UI) tolerate a low color count far better than photos do.'
                          : '70-85% is usually visually indistinguishable from the original while cutting file size dramatically.'
                      }
                    >
                      <span class="field__hint">{isPngLossy ? `Colors (~${qualityToColorCount(quality)})` : `Quality (${Math.round(quality * 100)}%)`}</span>
                      <input type="range" min="1" max="100" value={Math.round(quality * 100)} aria-label="Quality" onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value) / 100)} />
                      {!isPngLossy && <span class="control__hint">Recommended: 70–85%</span>}
                    </label>
                  </div>
                );
              })()}
            </div>
          </div>

          <ErrorMessage message={processError} />

          {result && (
            <div class="crop-result">
              <p class="crop-result__stats">
                <SavingsBadge beforeBytes={file.size} afterBytes={result.blob.size} />
                <span class="field__hint">
                  {formatBytes(file.size)} → {formatBytes(result.blob.size)} · {result.width}×{result.height}px
                </span>
                {busy && (
                  <span class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Updating…
                  </span>
                )}
                <span class="tool-bar__spacer" />
                <button type="button" class="btn btn--primary" onClick={download} title="Save the cropped, resized image">
                  <span aria-hidden="true">⭳</span> Download
                </button>
              </p>
              <CompareSlider
                beforeUrl={fileUrl}
                afterUrl={result.url}
                width={result.width}
                height={result.height}
                beforeLabel="Original"
                afterLabel="Cropped"
                transparent={file.type === 'image/png' || format === 'image/png'}
              />
            </div>
          )}
        </>
      )}

      <style>{`
        .crop-layout { display: flex; gap: var(--space-4); align-items: flex-start; margin-top: var(--space-4); flex-wrap: wrap; }
        .crop-stage-wrap { flex: 1 1 20rem; min-width: 16rem; display: flex; flex-direction: column; gap: var(--space-2); }
        .crop-stage-toolbar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .crop-zoom-level { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); min-width: 3.5rem; text-align: center; }
        /* The height cap lives here, not on .crop-stage itself — capping max-height directly
           on the aspect-ratio'd box let the browser squash/stretch it out of ratio once the
           natural height exceeded the cap, since aspect-ratio has no say once a hard max-height
           overrides one axis. A scrollable wrapper keeps .crop-stage free to size itself purely
           from aspect-ratio (always correct) and only adds scrollbars, never distortion — the
           same property the zoom feature below needs anyway. */
        /* max-height stays generous (well above the ${MAX_STAGE_HEIGHT_REM}rem "fit" size
           baked into the width formula above) so the default view is exactly the fitted
           size with no wasted space, while resize:vertical lets a user who wants more room
           — a tall image, or a closer look while zoomed — drag the corner handle for it. */
        .crop-stage-scroll { max-height: 60rem; min-height: 8rem; overflow: auto; resize: vertical; border-radius: var(--radius); }
        .crop-stage {
          position: relative; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2);
          touch-action: none; user-select: none;
        }
        /* A neutral, theme-independent checker — the same "see-through" convention every
           image editor uses, so it stays recognizable regardless of the site's own theme. */
        .crop-stage--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }
        .crop-stage__img { display: block; width: 100%; height: 100%; }
        .crop-box {
          position: absolute; border: 2px dashed var(--accent-contrast);
          box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55), inset 0 0 0 1px var(--accent);
          cursor: move;
        }
        .crop-box__handle {
          position: absolute; right: -0.5rem; bottom: -0.5rem; width: 1rem; height: 1rem;
          border-radius: 999px; background: var(--accent); border: 2px solid var(--accent-contrast);
          cursor: nwse-resize; touch-action: none;
        }
        .crop-controls { flex: 1 1 16rem; min-width: 14rem; display: flex; flex-direction: column; gap: var(--space-4); }
        .crop-section { display: flex; flex-direction: column; gap: var(--space-2); }
        .crop-section__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .crop-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); }
        .control { display: flex; flex-direction: column; gap: var(--space-1); }
        .control__hint { font-size: var(--text-xs); color: var(--text-subtle); }
        .crop-preset-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
        .crop-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-2); }
        .crop-result__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0; }
        /* .job__spinner (shared with every other worker-backed tool) lives in
           src/styles/tool.css. */
        @media (max-width: 40rem) {
          .crop-fields { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </div>
  );
}
