import { useEffect, useRef, useState } from 'preact/hooks';
import {
  validateImageFile,
  createManualRegion,
  moveRegion,
  resizeRegionBy,
  applyRedactions,
  defaultIntensityForStyle,
  type RedactRegion,
  type RedactStyle,
  type RedactShape,
  type RgbaImageData,
} from '../lib/tools/imageRedact';
import { FileDropzone } from './shared/FileDropzone';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { formatBytes } from './shared/formatBytes';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import ImageRedactDetectWorker from '../workers/imageRedactDetect.worker?worker';
import type { ImageRedactDetectWorkerRequest, ImageRedactDetectWorkerResult } from '../workers/imageRedactDetect.worker';

// Deliberately no ShareLinkButton — the input is a binary image file from the visitor's own
// disk, which can't (and shouldn't) be encoded into a URL. Same reasoning as every other
// image tool on this site (Image Cropper, Background Remover, ...).

const MIN_BLUR_RADIUS = 4;
const MAX_BLUR_RADIUS = 40;
const MIN_PIXEL_BLOCK_SIZE = 4;
const MAX_PIXEL_BLOCK_SIZE = 40;
/** Height cap for the stage's "fit" size — same technique as Image Cropper's own
 *  `MAX_STAGE_HEIGHT_REM`, kept as one constant so the inline width formula and the scroll
 *  wrapper's own max-height can never drift apart. */
const MAX_STAGE_HEIGHT_REM = 26;

const STYLE_OPTIONS: { value: RedactStyle; label: string; title: string }[] = [
  { value: 'blur', label: 'Blur', title: 'Soft Gaussian-style blur — the least visually jarring option.' },
  { value: 'pixelate', label: 'Pixelate', title: 'Classic mosaic blocks — the most recognizable "this is censored" look.' },
  { value: 'blackbox', label: 'Solid box', title: 'Fully opaque black fill — the only style that makes the original pixels completely unrecoverable.' },
];

const SHAPE_OPTIONS: { value: RedactShape; label: string; title: string }[] = [
  { value: 'ellipse', label: 'Oval', title: "Redacts only the oval inside the box — matches a face's own shape instead of dragging in its corners." },
  { value: 'rect', label: 'Rectangle', title: 'Redacts the whole box, corners included — usually the better fit for a plate, sign or other hard-edged subject.' },
];

type DragMode = 'move' | 'resize';
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  startRegion: RedactRegion;
}

interface RedactResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

const baseName = (name: string): string => name.replace(/\.[^./]+$/, '') || 'image';

/** A real bundled photo, not synthetic canvas art — the face detector needs actual faces
 *  to find, which a generated shape can't provide. Public domain (NASA work, no attribution
 *  required): the official NASA SpaceX Crew-11 portrait (four clear, frontal faces, so
 *  "Load example" actually demonstrates detecting more than one), via Wikimedia Commons —
 *  see this tool's own content page for the credit and license link. */
const SAMPLE_IMAGE_URL = '/samples/face-sample.jpg';

async function loadSampleImageFile(): Promise<File> {
  const response = await fetch(SAMPLE_IMAGE_URL);
  if (!response.ok) throw new Error('Could not load the sample image.');
  const blob = await response.blob();
  return new File([blob], 'face-sample.jpg', { type: 'image/jpeg' });
}

/**
 * Decodes the file, auto-detects faces via a Worker-hosted on-device model, lets the
 * visitor add/edit/delete redaction boxes for faces the model missed or for anything else
 * (plates, text, other people), then renders the chosen redaction style onto a canvas —
 * inherently DOM-bound (`createImageBitmap`, `<canvas>`), so like the other image tools
 * this stays in the island rather than the pure logic layer in `lib/tools`.
 */
export default function FacePlateBlur() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [sourcePixels, setSourcePixels] = useState<RgbaImageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [rendering, setRendering] = useState(false);

  // Every region carries its own style and intensity (see RedactRegion) — one face can stay
  // blurred while a manually-added plate box is set to solid black, rather than one setting
  // for the whole photo.
  const [regions, setRegions] = useState<RedactRegion[]>([]);
  // The region actively being dragged, tracked separately from `regions` so a pointermove
  // only updates this cheap overlay-position state — not `regions` itself, which drives the
  // (much more expensive) blur/pixelate recompute below. Committed into `regions` on
  // pointerup.
  const [dragPreview, setDragPreview] = useState<RedactRegion | null>(null);
  // Same split for a region's intensity slider: dragging it updates this immediately (cheap,
  // just a displayed number) while the actual recompute-triggering `regions` state only
  // picks it up 150ms after the drag settles — the same debounce every other tool's
  // quality/radius slider uses, just keyed to which region is being adjusted.
  const [intensityDraft, setIntensityDraft] = useState<{ id: string; intensity: number } | null>(null);

  const [result, setResult] = useState<RedactResult | null>(null);

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const detectSeqRef = useRef(0);
  const renderSeqRef = useRef(0);
  const pendingExampleRef = useRef(false);

  const detectWorker = useWorkerTask<ImageRedactDetectWorkerRequest, ImageRedactDetectWorkerResult>(() => new ImageRedactDetectWorker());

  // Commits a region's draft intensity into `regions` 150ms after the slider settles.
  useEffect(() => {
    if (!intensityDraft) return;
    const timer = window.setTimeout(() => {
      setRegions((prev) => prev.map((region) => (region.id === intensityDraft.id ? { ...region, intensity: intensityDraft.intensity } : region)));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [intensityDraft]);

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
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  // Decodes the file and runs face detection. Detection failure doesn't block the tool —
  // plates and anything else are manual anyway, so a visitor can still box things by hand
  // even if the model failed to load.
  useEffect(() => {
    if (!file) {
      bitmapRef.current?.close();
      bitmapRef.current = null;
      setNaturalSize(null);
      setSourcePixels(null);
      setRegions([]);
      setResult(null);
      setLoadError(null);
      setDetectError(null);
      setProcessError(null);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setLoadError(validation.error);
      setNaturalSize(null);
      setSourcePixels(null);
      return;
    }
    setLoadError(null);
    setDetectError(null);
    setRegions([]);

    const seq = (detectSeqRef.current += 1);
    const isStale = () => detectSeqRef.current !== seq;

    let cancelled = false;
    void (async () => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        if (!cancelled && !isStale()) {
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
        setProcessError('This browser does not support canvas image export.');
        return;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      const imageData = context.getImageData(0, 0, width, height);
      const pixels: RgbaImageData = { data: imageData.data, width, height };
      setSourcePixels(pixels);

      setDetecting(true);
      try {
        // No `transfer` here — unlike Background Remover, this tool needs the original
        // pixels again afterward (to render the chosen redaction style onto), so the
        // buffer can't be handed off to the worker.
        const detected = await detectWorker.run({ image: pixels });
        if (cancelled || isStale()) return;
        setRegions(detected);
        setDetecting(false);
      } catch (thrown) {
        if (cancelled || isStale()) return;
        setDetecting(false);
        setDetectError(thrown instanceof Error ? thrown.message : String(thrown));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- detectWorker is a stable ref from useWorkerTask, not real reactive state.
  }, [file]);

  // Recomputes the redacted output whenever any region (its position, size, style, or
  // debounced intensity) changes. Cheap enough to run synchronously on the main thread —
  // unlike face detection, this only touches the handful of small region rectangles, not
  // the whole image.
  useEffect(() => {
    if (!sourcePixels) {
      setResult(null);
      return;
    }

    const seq = (renderSeqRef.current += 1);
    setRendering(true);
    setProcessError(null);

    const output = applyRedactions(sourcePixels, regions);

    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d');
    if (!context) {
      setRendering(false);
      setProcessError('This browser does not support canvas image export.');
      return;
    }
    context.putImageData(new ImageData(output.data, output.width, output.height), 0, 0);

    const outputType = file && (file.type === 'image/jpeg' || file.type === 'image/webp') ? file.type : 'image/png';
    canvas.toBlob(
      (blob) => {
        if (renderSeqRef.current !== seq) return;
        if (!blob) {
          setRendering(false);
          setProcessError('Could not render the redacted image — try a different file.');
          return;
        }
        setResult({ blob, url: URL.createObjectURL(blob), width: output.width, height: output.height });
        setRendering(false);
      },
      outputType,
      outputType === 'image/png' ? undefined : 0.92
    );
  }, [sourcePixels, regions, file]);

  const scaleFactor = (): number => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || !naturalSize) return 1;
    return naturalSize.width / rect.width;
  };

  const beginDrag = (region: RedactRegion, mode: DragMode) => (event: PointerEvent) => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { id: region.id, mode, startX: event.clientX, startY: event.clientY, startRegion: region };
    setDragPreview(region);
  };

  const onDragMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !naturalSize) return;
    const scale = scaleFactor();
    const dx = (event.clientX - drag.startX) * scale;
    const dy = (event.clientY - drag.startY) * scale;

    const next =
      drag.mode === 'move'
        ? moveRegion(drag.startRegion, dx, dy, naturalSize.width, naturalSize.height)
        : resizeRegionBy(drag.startRegion, dx, dy, naturalSize.width, naturalSize.height);
    setDragPreview(next);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag && dragPreview) {
      setRegions((prev) => prev.map((region) => (region.id === drag.id ? dragPreview : region)));
    }
    dragRef.current = null;
    setDragPreview(null);
  };

  const addManualRegion = () => {
    if (!naturalSize) return;
    setRegions((prev) => [...prev, createManualRegion(naturalSize.width, naturalSize.height)]);
  };

  const removeRegion = (id: string) => {
    setRegions((prev) => prev.filter((region) => region.id !== id));
  };

  // A style switch is a discrete click, not a continuous drag, so it commits straight into
  // `regions` — no debounce needed, unlike the intensity slider. Intensity resets to the new
  // style's own default since blur radius and pixelate block size are unrelated units; there
  // is no meaningful "previous value" to carry over between them.
  const updateRegionStyle = (id: string, style: RedactStyle) => {
    setRegions((prev) => prev.map((region) => (region.id === id ? { ...region, style, intensity: defaultIntensityForStyle(style) } : region)));
  };

  const updateRegionShape = (id: string, shape: RedactShape) => {
    setRegions((prev) => prev.map((region) => (region.id === id ? { ...region, shape } : region)));
  };

  const updateRegionIntensity = (id: string, intensity: number) => {
    setIntensityDraft({ id, intensity });
  };

  const redetectFaces = () => {
    if (!sourcePixels) return;
    setDetectError(null);
    setDetecting(true);
    detectWorker.run({ image: sourcePixels }).then(
      (detected) => {
        setDetecting(false);
        // Merges in newly-found faces rather than replacing the list outright, so manual
        // boxes (and any auto boxes already adjusted) aren't discarded by a re-run.
        setRegions((prev) => [...prev, ...detected.filter((found) => !prev.some((existing) => boxesOverlapEnough(existing, found)))]);
      },
      (thrown: unknown) => {
        setDetecting(false);
        setDetectError(thrown instanceof Error ? thrown.message : String(thrown));
      }
    );
  };

  const loadExample = () => {
    void loadSampleImageFile().then((sample) => {
      pendingExampleRef.current = true;
      setFile(sample);
    });
  };

  const removeFile = () => {
    setFile(null);
  };

  const download = () => {
    if (!result || !file) return;
    const extension = result.blob.type === 'image/jpeg' ? 'jpg' : result.blob.type === 'image/webp' ? 'webp' : 'png';
    downloadUrl(result.url, `${baseName(file.name)}-redacted.${extension}`);
  };

  const regionCountHint = detecting
    ? 'Detecting faces…'
    : regions.length === 0
      ? 'No regions marked yet — use "Add box" to mark a face, plate, or anything else by hand.'
      : `${regions.length} region${regions.length === 1 ? '' : 's'} marked — drag a box to move it, its corner to resize it, or × to remove it.`;

  return (
    <div class="tool">
      <div class="tool-bar">
        {file && naturalSize && (
          <>
            <button type="button" class="btn" onClick={addManualRegion} title="Add a box you can drag over a plate, sign, or anything else">
              + Add box
            </button>
            <button type="button" class="btn" onClick={redetectFaces} disabled={detecting} title="Run face detection again — e.g. after deleting a box, or if it missed a face the first time">
              Re-detect faces
            </button>
          </>
        )}
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Load a real public-domain photo with a face to try automatic detection">
          Load example
        </button>
        <button type="button" class="btn" onClick={removeFile} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to redact" accept="image/*" />}

      <ErrorMessage message={loadError} />

      {file && naturalSize && sourcePixels && (
        <>
          <div class="redact-layout">
            <div class="redact-stage-wrap">
              <p class="field__hint" aria-live="polite">
                {detecting && <span class="job__spinner" aria-hidden="true" />} {regionCountHint}
              </p>
              <div class="redact-stage-scroll">
                <div
                  class={`redact-stage${file.type === 'image/png' ? ' redact-stage--checkerboard' : ''}`}
                  ref={stageRef}
                  style={`aspect-ratio:${naturalSize.width}/${naturalSize.height}; width:min(100%, ${MAX_STAGE_HEIGHT_REM}rem * ${naturalSize.width} / ${naturalSize.height})`}
                >
                  <img src={fileUrl} alt="" class="redact-stage__img" draggable={false} />
                  {regions.map((region, index) => {
                    const shown = dragPreview && dragPreview.id === region.id ? dragPreview : region;
                    return (
                      <div
                        key={region.id}
                        class={`redact-box redact-box--${shown.source} redact-box--${shown.shape}`}
                        style={`left:${(shown.x / naturalSize.width) * 100}%; top:${(shown.y / naturalSize.height) * 100}%; width:${(shown.width / naturalSize.width) * 100}%; height:${(shown.height / naturalSize.height) * 100}%`}
                        onPointerDown={beginDrag(region, 'move')}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        title={shown.source === 'auto' ? 'Automatically detected face — drag to adjust' : 'Manually added region — drag to adjust'}
                      >
                        <span class="redact-box__index" aria-hidden="true">
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          class="redact-box__delete"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => removeRegion(region.id)}
                          title="Remove this region"
                          aria-label={`Remove region ${index + 1}`}
                        >
                          ×
                        </button>
                        <div
                          class="redact-box__handle"
                          onPointerDown={beginDrag(region, 'resize')}
                          onPointerMove={onDragMove}
                          onPointerUp={endDrag}
                          title="Drag to resize this region"
                          aria-hidden="true"
                        >
                          ⤡
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p class="field__hint">
                {file.name} · {naturalSize.width}×{naturalSize.height}px · {formatBytes(file.size)}
              </p>
              <ErrorMessage message={detectError} onRetry={redetectFaces} />
            </div>

            <div class="redact-controls">
              <div class="redact-section">
                <h3 class="redact-section__title">Regions</h3>
                {regions.length === 0 ? (
                  <p class="field__hint">No regions yet — detect faces or add a box to get started.</p>
                ) : (
                  <div class="redact-region-list">
                    {regions.map((region, index) => {
                      const displayIntensity = intensityDraft && intensityDraft.id === region.id ? intensityDraft.intensity : region.intensity;
                      return (
                        <div key={region.id} class="redact-region-row">
                          <div class="redact-region-row__head">
                            <span class="redact-region-row__badge" aria-hidden="true">
                              {index + 1}
                            </span>
                            <span class="field__hint">{region.source === 'auto' ? 'Detected face' : 'Manual region'}</span>
                            <button
                              type="button"
                              class="btn redact-region-row__remove"
                              onClick={() => removeRegion(region.id)}
                              title={`Remove region ${index + 1}`}
                            >
                              Remove
                            </button>
                          </div>
                          <div class="redact-region-row__controls">
                            <div class="seg" role="group" aria-label={`Redaction shape for region ${index + 1}`}>
                              {SHAPE_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  class="seg__btn"
                                  aria-pressed={region.shape === option.value}
                                  onClick={() => updateRegionShape(region.id, option.value)}
                                  title={option.title}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                            <div class="seg" role="group" aria-label={`Redaction style for region ${index + 1}`}>
                              {STYLE_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  class="seg__btn"
                                  aria-pressed={region.style === option.value}
                                  onClick={() => updateRegionStyle(region.id, option.value)}
                                  title={option.title}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                            {region.style !== 'blackbox' && (
                              <label
                                class="control"
                                title={region.style === 'pixelate' ? 'Larger blocks hide more detail but look blockier.' : 'A larger radius blurs more strongly.'}
                              >
                                <span class="field__hint">
                                  {region.style === 'pixelate' ? `Block size (${displayIntensity}px)` : `Blur strength (${displayIntensity}px)`}
                                </span>
                                <input
                                  type="range"
                                  min={region.style === 'pixelate' ? MIN_PIXEL_BLOCK_SIZE : MIN_BLUR_RADIUS}
                                  max={region.style === 'pixelate' ? MAX_PIXEL_BLOCK_SIZE : MAX_BLUR_RADIUS}
                                  value={displayIntensity}
                                  aria-label={`${region.style === 'pixelate' ? 'Pixelate block size' : 'Blur strength'} for region ${index + 1}`}
                                  onInput={(e) => updateRegionIntensity(region.id, Number((e.target as HTMLInputElement).value))}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <ErrorMessage message={processError} />

          {result && (
            <div class="redact-result">
              <p class="redact-result__stats">
                <span class="field__hint">
                  {result.width}×{result.height}px · {formatBytes(result.blob.size)}
                </span>
                {rendering && (
                  <span class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Updating…
                  </span>
                )}
                <span class="tool-bar__spacer" />
                <button type="button" class="btn btn--primary" onClick={download} title="Save the redacted image">
                  <span aria-hidden="true">⭳</span> Download
                </button>
              </p>
              <CompareSlider
                beforeUrl={fileUrl}
                afterUrl={result.url}
                width={result.width}
                height={result.height}
                beforeLabel="Original"
                afterLabel="Redacted"
                transparent={file.type === 'image/png' || result.blob.type === 'image/png'}
              />
            </div>
          )}
        </>
      )}

      <style>{`
        .redact-layout { display: flex; gap: var(--space-4); align-items: flex-start; margin-top: var(--space-4); flex-wrap: wrap; }
        /* flex-grow:0 (not 1) is deliberate — the stage's own width is already computed
           from the image's aspect ratio (the inline style on .redact-stage above), so
           letting this column grow to fill leftover row width would just stretch empty
           space to the right of a narrow/tall image instead of handing that space to
           .redact-controls, which actually has content that benefits from it.
           A fixed basis (20rem), not an auto one, for a second reason: with an auto basis,
           this column's hypothetical width for wrapping purposes is its widest child's own
           max-content size — the region-count sentence below, left unwrapped, is far wider
           than the image itself, which pushed .redact-controls onto its own line below
           instead of sitting beside it. A fixed basis sidesteps that entirely; the text
           still wraps normally within it. */
        .redact-stage-wrap { flex: 0 1 20rem; min-width: 16rem; display: flex; flex-direction: column; gap: var(--space-2); }
        .redact-stage-scroll { max-height: 60rem; min-height: 8rem; overflow: auto; resize: vertical; border-radius: var(--radius); }
        .redact-stage {
          position: relative; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2);
          touch-action: none; user-select: none;
        }
        /* A neutral, theme-independent checker — the same "see-through" convention every
           image editor uses, so a transparent PNG reads as such instead of just showing
           whatever the theme's own surface color happens to be underneath. */
        .redact-stage--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }
        .redact-stage__img { display: block; width: 100%; height: 100%; }
        .redact-box {
          position: absolute; border: 2px solid var(--accent);
          box-shadow: inset 0 0 0 1px var(--accent-contrast);
          cursor: move;
        }
        .redact-box--auto { border-style: dashed; }
        .redact-box--manual { border-style: solid; }
        /* Matches the actual redaction mask: an ellipse region only affects the oval
           inscribed in its box, so its outline is drawn the same way rather than implying
           the whole rectangle gets redacted. */
        .redact-box--ellipse { border-radius: 50%; }
        .redact-box__index {
          position: absolute; top: -0.6rem; left: -0.6rem; min-width: 1.25rem; height: 1.25rem; padding: 0 0.3rem;
          border-radius: 999px; border: 2px solid var(--accent-contrast); background: var(--accent);
          color: var(--accent-contrast); font-size: var(--text-xs); font-weight: 700; line-height: 1;
          display: flex; align-items: center; justify-content: center;
        }
        .redact-box__delete {
          position: absolute; top: -0.6rem; right: -0.6rem; width: 1.25rem; height: 1.25rem;
          border-radius: 999px; border: 2px solid var(--accent-contrast); background: var(--danger);
          color: #fff; font-size: var(--text-xs); line-height: 1; display: flex; align-items: center; justify-content: center;
          cursor: pointer; padding: 0;
        }
        .redact-box__handle {
          position: absolute; right: -0.65rem; bottom: -0.65rem; width: 1.25rem; height: 1.25rem;
          border-radius: 999px; background: var(--accent); border: 2px solid var(--accent-contrast);
          color: var(--accent-contrast); font-size: 0.7rem; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          cursor: nwse-resize; touch-action: none;
        }
        .redact-controls { flex: 1 1 16rem; min-width: 14rem; display: flex; flex-direction: column; gap: var(--space-4); }
        .redact-section { display: flex; flex-direction: column; gap: var(--space-2); }
        .redact-section__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .redact-region-list { display: flex; flex-direction: column; gap: var(--space-3); }
        .redact-region-row {
          display: flex; flex-direction: column; gap: var(--space-2);
          padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius);
        }
        .redact-region-row__head { display: flex; align-items: center; gap: var(--space-2); }
        .redact-region-row__badge {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.25rem; height: 1.25rem; border-radius: 999px;
          background: var(--accent); color: var(--accent-contrast); font-size: var(--text-xs); font-weight: 700;
        }
        .redact-region-row__remove { margin-left: auto; padding: 0.2rem 0.6rem; min-height: 0; font-size: var(--text-xs); }
        /* A wrapping row, not a column stack — shape and style pickers sit side by side
           (and the intensity slider joins them too) whenever the panel is wide enough,
           only dropping to their own line when it isn't. Far more compact than always
           stacking every control on its own row. */
        .redact-region-row__controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
        .redact-region-row__controls .control { flex: 0 1 9rem; min-width: 7rem; }
        .control { display: flex; flex-direction: column; gap: var(--space-1); }
        /* .seg is display:inline-flex (sized to its own buttons), but as a flex item in a
           wrapping row it can still be stretched along the row's cross axis by the default
           align-items:stretch, taking on the height of a taller sibling (the intensity
           slider's own two-line control) — align-self opts it back out so it keeps its own
           natural height. */
        .redact-region-row__controls .seg { align-self: center; }
        .redact-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-2); }
        .redact-result__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0; }
      `}</style>
    </div>
  );
}

/** Used only to decide whether a re-run's "found" face should be merged in or skipped as
 *  the same face an earlier box (auto or manual) already covers — a plain center-distance
 *  check is enough for this, not a full IoU calculation, since it only needs to avoid
 *  obviously duplicate boxes, not precisely dedupe near-misses. */
function boxesOverlapEnough(a: RedactRegion, b: RedactRegion): boolean {
  const aCenterX = a.x + a.width / 2;
  const aCenterY = a.y + a.height / 2;
  const bCenterX = b.x + b.width / 2;
  const bCenterY = b.y + b.height / 2;
  const distance = Math.hypot(aCenterX - bCenterX, aCenterY - bCenterY);
  return distance < Math.min(a.width, a.height, b.width, b.height) / 2;
}
