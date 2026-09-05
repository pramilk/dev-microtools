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
  computeUpscaledDimensions,
  validateUpscaleTarget,
  UPSCALE_MULTIPLIERS,
  type UpscaleMultiplier,
  type RgbaImageData,
} from '../lib/tools/imageUpscale';
import { FileDropzone } from './shared/FileDropzone';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { formatBytes } from './shared/formatBytes';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import ImageUpscaleWorker from '../workers/imageUpscale.worker?worker';
import type { ImageUpscaleWorkerRequest, ImageUpscaleWorkerResult } from '../workers/imageUpscale.worker';
import ImageCompressWorker from '../workers/imageCompress.worker?worker';
import type { ImageCompressWorkerRequest, ImageCompressWorkerResult } from '../workers/imageCompress.worker';

// Deliberately no ShareLinkButton — the input is a binary image file from the visitor's own
// disk, which can't (and shouldn't) be encoded into a URL. Same reasoning across every
// image tool on this site.

const DEFAULT_MULTIPLIER: UpscaleMultiplier = 4;

const baseName = (name: string): string => name.replace(/\.[^./]+$/, '') || 'image';

/** A real bundled photo rather than synthetic canvas art — a resampling filter is judged on
 *  real photographic detail (fine, irregular fur/texture and gradients), which a generated
 *  shape can only approximate. A small (300×225) downscale of Background Remover's own
 *  "Load example" photo, so this is the same already-verified public-domain source (no new
 *  licensing question) at a size that actually matches this tool's own use case — enlarging
 *  a small photo, not a print-resolution one. Public domain (no attribution required):
 *  "Stray cat on wall.jpg" by Neal Ziring, via Wikimedia Commons — see this tool's own
 *  content page for the credit and license link. */
const SAMPLE_IMAGE_URL = '/samples/upscaler-sample.jpg';

async function loadSampleImageFile(): Promise<File> {
  const response = await fetch(SAMPLE_IMAGE_URL);
  if (!response.ok) throw new Error('Could not load the sample image.');
  const blob = await response.blob();
  return new File([blob], 'cat-sample.jpg', { type: 'image/jpeg' });
}

interface UpscaleResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

/**
 * Enlarges a photo with a Lanczos-3 resample (see `resizeLanczos` in
 * `lib/tools/imageUpscale.ts`) — sharper than a plain browser resize, running off the main
 * thread in a Worker since a full-size pass is a genuinely heavy, multi-second computation.
 * Decoding the source and encoding the result stay in this island (inherently DOM-bound —
 * `createImageBitmap`, `<canvas>` — like every other image tool here); only the resample
 * itself is pure logic, split out into `lib/tools` and testable in isolation.
 */
export default function ImageUpscaler() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [multiplier, setMultiplier] = useState<UpscaleMultiplier>(DEFAULT_MULTIPLIER);
  const [format, setFormat] = useState<OutputFormat>('image/jpeg');
  /** PNG's compression mode — only relevant when `format === 'image/png'`. Defaults to
   *  lossless, matching this site's other image tools; switching to lossy is opt-in. */
  const [pngMode, setPngMode] = useState<PngMode>('lossless');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [upscaledPixels, setUpscaledPixels] = useState<RgbaImageData | null>(null);
  const [result, setResult] = useState<UpscaleResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  // Tracked separately: `busy` covers the (worker-backed) Lanczos resample itself, `encoding`
  // the canvas encode + optional PNG optimize/quantize pass that follows it. Both are real,
  // separately-timed async work — collapsing them into one flag left a gap where the
  // resample had finished (busy → false) but the encode was still running, during which the
  // UI showed no "updating" indicator at all even though the visible result was still stale.
  const [busy, setBusy] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const isProcessing = busy || encoding;

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const upscaleSeqRef = useRef(0);
  const encodeSeqRef = useRef(0);

  const upscaleWorker = useWorkerTask<ImageUpscaleWorkerRequest, ImageUpscaleWorkerResult>(() => new ImageUpscaleWorker());
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
  const quantizePng = (image: ImageData, q: number): Promise<ImageData> =>
    pngWorkerTask.run({ kind: 'quantizePng', image, quality: q }).then(
      (result) => (result.kind === 'quantizePng' ? new ImageData(result.image.data, result.image.width, result.image.height) : image),
      (error: unknown) => {
        console.warn('PNG lossy quantization failed, keeping the un-quantized pixels.', error);
        return image;
      }
    );

  // Debounces the quality slider the same way Image Cropper/Compressor do — re-encoding on
  // every tick made dragging feel laggy.
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

  // Decodes a newly-chosen file and resets everything downstream of it.
  useEffect(() => {
    if (!file) {
      bitmapRef.current?.close();
      bitmapRef.current = null;
      setNaturalSize(null);
      setUpscaledPixels(null);
      setResult(null);
      setLoadError(null);
      setProcessError(null);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setLoadError(validation.error);
      setNaturalSize(null);
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
        setNaturalSize({ width: bitmap.width, height: bitmap.height });
        setFormat((OUTPUT_FORMATS as readonly string[]).includes(file.type) ? (file.type as OutputFormat) : 'image/jpeg');
        setPngMode('lossless');
        setMultiplier(DEFAULT_MULTIPLIER);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Runs the (heavy, worker-backed) Lanczos resample whenever the source image or the
  // chosen multiplier changes — deliberately *not* re-run for output format/quality changes,
  // which only need the cheap re-encode effect below.
  useEffect(() => {
    const bitmap = bitmapRef.current;
    if (!bitmap || !naturalSize) return;

    const validation = validateUpscaleTarget(naturalSize.width, naturalSize.height, multiplier);
    if (!validation.ok) {
      setUpscaledPixels(null);
      setProcessError(validation.error);
      return;
    }
    setProcessError(null);

    const seq = (upscaleSeqRef.current += 1);
    setBusy(true);

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) {
      setBusy(false);
      setProcessError('This browser does not support canvas image export.');
      return;
    }
    context.drawImage(bitmap, 0, 0);
    const source = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const { width: targetWidth, height: targetHeight } = validation.value;

    upscaleWorker
      .run(
        { image: { data: source.data, width: bitmap.width, height: bitmap.height }, targetWidth, targetHeight },
        { transfer: [source.data.buffer] }
      )
      .then((upscaled) => {
        if (upscaleSeqRef.current !== seq) return;
        setUpscaledPixels(upscaled);
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (upscaleSeqRef.current !== seq) return;
        setBusy(false);
        setProcessError(error instanceof Error ? error.message : 'Upscaling failed on this image — try a different file.');
      });
  }, [naturalSize, multiplier]);

  // Re-encodes the already-upscaled pixels whenever they change, or the output
  // format/quality/PNG mode does — not the resample itself, but not necessarily cheap
  // either: PNG's lossless pass runs Oxipng (real WASM work) and the lossy pass runs a full
  // palette quantization, both genuinely slow enough on a large upscaled image to need their
  // own `encoding` flag (see its declaration above) rather than assuming this is instant.
  useEffect(() => {
    if (!upscaledPixels) return;

    const seq = (encodeSeqRef.current += 1);
    setEncoding(true);

    const canvas = document.createElement('canvas');
    canvas.width = upscaledPixels.width;
    canvas.height = upscaledPixels.height;
    const context = canvas.getContext('2d');
    if (!context) {
      setEncoding(false);
      setProcessError('This browser does not support canvas image export.');
      return;
    }
    context.putImageData(new ImageData(upscaledPixels.data, upscaledPixels.width, upscaledPixels.height), 0, 0);

    const encode = async () => {
      if (format === 'image/png' && pngMode === 'lossy') {
        // Quantization changes pixel values before the encoder ever sees them — it must
        // happen here, on the canvas, since the browser's canvas PNG encoder itself has no
        // lossy mode.
        const imageData = context.getImageData(0, 0, upscaledPixels.width, upscaledPixels.height);
        context.putImageData(await quantizePng(imageData, debouncedQuality), 0, 0);
      }

      canvas.toBlob(
        (blob) => {
          if (encodeSeqRef.current !== seq) return;
          if (!blob) {
            setEncoding(false);
            setProcessError('Could not encode this image — try a different format.');
            return;
          }

          const finish = (finalBlob: Blob) => {
            if (encodeSeqRef.current !== seq) return;
            setResult({ blob: finalBlob, url: URL.createObjectURL(finalBlob), width: upscaledPixels.width, height: upscaledPixels.height });
            setEncoding(false);
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
  }, [upscaledPixels, format, debouncedQuality, pngMode]);

  const loadExample = () => {
    void loadSampleImageFile().then((sample) => setFile(sample));
  };

  const removeFile = () => {
    setFile(null);
  };

  const download = () => {
    if (!result || !file) return;
    downloadUrl(result.url, `${baseName(file.name)}-${multiplier}x.${OUTPUT_FORMAT_EXTENSIONS[format]}`);
  };

  const previewTarget = naturalSize ? computeUpscaledDimensions(naturalSize.width, naturalSize.height, multiplier) : null;

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Enlarge by">
          {UPSCALE_MULTIPLIERS.map((m) => (
            <button
              key={m}
              type="button"
              class="seg__btn"
              aria-pressed={multiplier === m}
              onClick={() => setMultiplier(m)}
              title={`Enlarge to ${m}× the original width and height`}
            >
              {m}×
            </button>
          ))}
        </div>

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
        <button type="button" class="btn" onClick={loadExample} title="Load a real public-domain photo to try upscaling">
          Load example
        </button>
        <button type="button" class="btn" onClick={removeFile} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to enlarge" accept="image/*" />}

      <ErrorMessage message={loadError} />

      {file && naturalSize && (
        <>
          {previewTarget && (
            <p class="field__hint upscale-hint">
              {file.name} · {naturalSize.width.toLocaleString()}×{naturalSize.height.toLocaleString()}px · {formatBytes(file.size)} →{' '}
              {previewTarget.width.toLocaleString()}×{previewTarget.height.toLocaleString()}px
            </p>
          )}

          {(LOSSY_FORMATS.has(format) || (format === 'image/png' && pngMode === 'lossy')) && (
            <label
              class="control upscale-quality"
              title={
                format === 'image/png' && pngMode === 'lossy'
                  ? 'Fewer colors means a smaller file but more visible banding, especially in gradients and photos.'
                  : '70-85% is usually visually indistinguishable from the original while cutting file size dramatically.'
              }
            >
              <span class="field__hint">
                {format === 'image/png' && pngMode === 'lossy' ? `Colors (~${qualityToColorCount(quality)})` : `Quality (${Math.round(quality * 100)}%)`}
                {!(format === 'image/png' && pngMode === 'lossy') && <span class="control__hint"> · Recommended: 70–85%</span>}
              </span>
              <input type="range" min="1" max="100" value={Math.round(quality * 100)} aria-label="Quality" onInput={(e) => setQuality(Number((e.target as HTMLInputElement).value) / 100)} />
            </label>
          )}

          <ErrorMessage message={processError} />

          {isProcessing && !result && (
            <p class="upscale-status">
              <span class="job__spinner" aria-hidden="true" /> {busy ? 'Upscaling…' : 'Encoding…'}
            </p>
          )}

          {result && (
            <div class="upscale-result">
              <p class="upscale-result__stats">
                <span class="field__hint">
                  {formatBytes(file.size)} → {formatBytes(result.blob.size)}
                </span>
                {isProcessing && (
                  <span class="upscale-status">
                    <span class="job__spinner" aria-hidden="true" /> Updating…
                  </span>
                )}
                <span class="tool-bar__spacer" />
                <button type="button" class="btn btn--primary" onClick={download} title="Save the enlarged image">
                  <span aria-hidden="true">⭳</span> Download
                </button>
              </p>
              <CompareSlider
                beforeUrl={fileUrl}
                afterUrl={result.url}
                width={result.width}
                height={result.height}
                beforeLabel={`${naturalSize.width.toLocaleString()} × ${naturalSize.height.toLocaleString()} px`}
                afterLabel={`${result.width.toLocaleString()} × ${result.height.toLocaleString()} px`}
                transparent={file.type === 'image/png' || format === 'image/png'}
                beforeImageRendering="pixelated"
                initialZoom={multiplier / 2}
              />
              <p class="field__hint">
                The left side shows the original stretched to this size with no resampling at all, so the improvement is honest — not the browser's own smoothing. Higher multipliers start the comparison already zoomed in, so the blockiness of that naive stretch is easier to see — use the +/− buttons or Ctrl/⌘+scroll to zoom further.
              </p>
            </div>
          )}
        </>
      )}

      <style>{`
        .upscale-hint { margin-top: var(--space-3); }
        .upscale-quality { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); max-width: 20rem; }
        .upscale-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-2); }
        .upscale-result__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0; }
        /* A colored pill rather than plain .field__hint text — the resample/re-encode can
           take real, noticeable time (see the encoding state's own comment above), and a
           muted gray "Updating…" easy to miss made it look like nothing was happening. */
        .upscale-status {
          display: inline-flex; align-items: center; gap: var(--space-1); margin: 0;
          padding: 0.25rem 0.6rem; border-radius: var(--radius-sm);
          background: var(--accent-subtle); color: var(--accent); font-weight: 600;
        }
        .control__hint { font-size: var(--text-xs); color: var(--text-subtle); }
        /* .job__spinner (shared with every other worker-backed tool) lives in
           src/styles/tool.css. */
      `}</style>
    </div>
  );
}
