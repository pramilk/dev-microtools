import { useEffect, useState } from 'preact/hooks';
import {
  validateImageFile,
  inputFormatWarning,
  outputFileName,
  computeIcoDimensions,
  encodeBmp,
  encodeIco,
  TARGET_FORMATS,
  TARGET_FORMAT_LABELS,
  TARGET_FORMAT_EXTENSIONS,
  LOSSY_TARGET_FORMATS,
  DEFAULT_QUALITY,
  MAX_BATCH_FILES,
  MAX_ICO_DIMENSION,
  type TargetFormat,
} from '../lib/tools/imageFormatConvert';
import { canvasHasTransparency } from './shared/canvasTransparency';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { CompareSlider } from './shared/CompareSlider';
import { MultiFileDropzone } from './shared/MultiFileDropzone';
import { ErrorMessage } from './shared/ErrorMessage';
import { useImageJobBatch, type ImageJobBase } from './shared/useImageJobBatch';
import { ImageJobList, type ImageJobRowProps } from './shared/ImageJobList';
import { BatchSavingsBanner } from './shared/BatchSavingsBanner';
import { downloadUrl } from './shared/downloadUrl';
import { downloadZip, uniqueZipName } from './shared/downloadZip';

// Deliberately no ShareLinkButton — the input is a binary image from the visitor's disk,
// which can't (and shouldn't) be encoded into a URL. The target format alone is not worth
// sharing without the image it applies to. Same reasoning across all three image tools.

interface ConvertedResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  format: TargetFormat;
  transparencyLost: boolean;
}

type ImageJob = ImageJobBase<ConvertedResult>;

/**
 * Decodes and re-encodes an image through an off-screen canvas — inherently DOM-bound
 * (`createImageBitmap`, `<canvas>`), so like Image Compressor and QR Code Generator's own
 * canvas work, this stays in the island rather than the pure logic layer. Only PNG/JPEG/WebP
 * output goes through the canvas's own `toBlob`; BMP and ICO are encoded by the hand-rolled
 * functions in `lib/tools/imageFormatConvert.ts` from the canvas's raw pixel data.
 */
async function convertImage(file: File, format: TargetFormat, quality: number): Promise<{ blob: Blob; width: number; height: number; transparencyLost: boolean }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that as an image — the file may be corrupted or in a format this browser can't decode.");
  }

  let { width, height } = bitmap;
  if (format === 'image/x-icon') {
    ({ width, height } = computeIcoDimensions(width, height));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('This browser does not support canvas image export.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const transparencyLost = format === 'image/jpeg' && canvasHasTransparency(context, width, height);

  if (format === 'image/bmp') {
    const { data } = context.getImageData(0, 0, width, height);
    const buffer = encodeBmp(width, height, data);
    return { blob: new Blob([buffer], { type: 'image/bmp' }), width, height, transparencyLost: false };
  }

  if (format === 'image/x-icon') {
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Conversion failed — try a different format.');
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
    const buffer = encodeIco(pngBytes, width, height);
    return { blob: new Blob([buffer], { type: 'image/x-icon' }), width, height, transparencyLost: false };
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, LOSSY_TARGET_FORMATS.has(format) ? quality : undefined));
  if (!blob) throw new Error('Conversion failed — try a different format.');
  return { blob, width, height, transparencyLost };
}

/**
 * Generates a modest, deterministic sample image via canvas with real transparency baked
 * in, so "Load example" demonstrates both the format conversion itself and the
 * transparency-loss warning when JPEG is picked, without bundling an actual photo asset.
 */
async function generateSampleImageFile(): Promise<File> {
  const size = 480;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not support canvas image export.');

  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#3cbcd4');
  gradient.addColorStop(1, '#7c5cff');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 20, 0, Math.PI * 2);
  context.fill();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not generate a sample image.');
  return new File([blob], 'sample.png', { type: 'image/png' });
}

/** A filename base with its extension stripped, so a new extension can be appended for the converted output. */
const baseName = (filename: string): string => filename.replace(/\.[^./]+$/, '') || 'image';

/** A short, human-readable format name from a MIME type — for the target formats this tool
 *  encodes and for any other browser-decodable type a user might drop in as input. */
const formatShortLabel = (mime: string): string => {
  if ((TARGET_FORMATS as readonly string[]).includes(mime)) return TARGET_FORMAT_LABELS[mime as TargetFormat];
  const subtype = mime.split('/')[1];
  return subtype ? subtype.toUpperCase() : mime || 'unknown';
};

export default function ImageFormatConverter() {
  const batch = useImageJobBatch<ConvertedResult>({
    maxFiles: MAX_BATCH_FILES,
    idPrefix: 'fmt-job',
    createJob: (base) => ({ ...base, status: 'processing', result: null, error: null }),
  });
  const [format, setFormat] = useState<TargetFormat>('image/png');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  // The slider tracks the pointer instantly; the actual (decode + canvas re-encode) work only
  // runs against this settled value, 200ms after dragging stops — matching Image Compressor.
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [zipping, setZipping] = useState(false);
  /** Job whose transparency-loss warning has been dismissed — keyed by job id, since the
   *  warning is job-specific and a fresh conversion could re-introduce it for a different
   *  job while this one stays dismissed. */
  const [dismissedTransparencyJobId, setDismissedTransparencyJobId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuality(quality), 200);
    return () => window.clearTimeout(timer);
  }, [quality]);

  const runJob = (job: ImageJob, fmt: TargetFormat, q: number) => {
    const seq = batch.startJob(job.id);

    const validation = validateImageFile(job.file);
    if (!validation.ok) {
      batch.failJob(job.id, validation.error);
      return;
    }

    void convertImage(job.file, fmt, q)
      .then(({ blob, width, height, transparencyLost }) => {
        if (!batch.isCurrentSeq(job.id, seq)) return;
        const url = URL.createObjectURL(blob);
        batch.finishJob(job.id, { blob, url, width, height, format: fmt, transparencyLost });
      })
      .catch((thrown: unknown) => {
        if (!batch.isCurrentSeq(job.id, seq)) return;
        batch.failJob(job.id, thrown instanceof Error ? thrown.message : 'Could not convert this image.');
      });
  };

  const jobIds = batch.jobs.map((job) => job.id).join(',');

  useEffect(() => {
    // Re-runs every image whenever the batch's membership changes (files added/removed) or
    // the batch-wide format/quality changes.
    batch.jobs.forEach((job) => runJob(job, format, debouncedQuality));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds, format, debouncedQuality]);

  const clearAll = () => {
    batch.clearAll();
    setDismissedTransparencyJobId(null);
    setFormat('image/png');
    setQuality(DEFAULT_QUALITY);
    setDebouncedQuality(DEFAULT_QUALITY);
  };

  const loadExample = () => {
    void generateSampleImageFile().then((file) => batch.addFiles([file]));
  };

  const downloadJob = (job: ImageJob) => {
    if (!job.result) return;
    downloadUrl(job.result.url, outputFileName(job.file.name, job.result.format));
  };

  // Keyed on having a result at all, not on status === 'done' — a job re-converting in the
  // background (e.g. while dragging the quality slider) still has its *previous* result to
  // show, so it shouldn't drop out of the totals and make the savings banner (and the rest of
  // the page below it) jump in and out as the slider moves.
  const completedJobs = batch.jobs.filter((job): job is ImageJob & { result: ConvertedResult } => job.result !== null);
  const totalOriginalBytes = completedJobs.reduce((sum, job) => sum + job.file.size, 0);
  const totalConvertedBytes = completedJobs.reduce((sum, job) => sum + job.result.blob.size, 0);
  const selectedJob = batch.selectedJob;

  const downloadAll = async () => {
    if (completedJobs.length === 0) return;
    setZipping(true);
    try {
      const usedNames = new Set<string>();
      const entries = completedJobs.map((job) => ({
        name: uniqueZipName(baseName(job.file.name), TARGET_FORMAT_EXTENSIONS[job.result.format], usedNames),
        blob: job.result.blob,
      }));
      await downloadZip(entries, 'converted-images.zip');
    } finally {
      setZipping(false);
    }
  };

  const jobRows: ImageJobRowProps[] = batch.jobs.map((job) => ({
    key: job.id,
    selected: job.id === batch.selectedJobId,
    onSelect: () => batch.setSelectedJobId(job.id),
    thumbUrl: job.originalUrl,
    checkerboard: job.file.type === 'image/png',
    fileName: job.file.name,
    displayName: outputFileName(job.file.name, job.result?.format ?? format),
    hasResult: job.result !== null,
    sizeBeforeBytes: job.file.size,
    sizeAfterBytes: job.result?.blob.size,
    busy: job.status === 'processing',
    busyLabel: 'Converting…',
    errorFlag: job.status === 'error',
    warningTitle: job.result?.transparencyLost
      ? 'Transparency was lost — JPEG has no alpha channel, so transparent areas were filled in.'
      : undefined,
    onDownload: job.result ? () => downloadJob(job) : undefined,
    downloadTitle: `Save ${job.file.name} as a converted file`,
    onRemove: () => batch.removeJob(job.id),
  }));

  return (
    <div class="tool">
      {/* No share link here: the input is uploaded image files, not text — there's no
          practical way to carry arbitrary image bytes in a shareable URL. */}
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Target format">
          {TARGET_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              class="seg__btn"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
              title={
                f === 'image/png'
                  ? 'PNG — lossless, supports transparency'
                  : f === 'image/jpeg'
                    ? 'JPEG — lossy, adjustable quality, no transparency'
                    : f === 'image/webp'
                      ? 'WebP — lossy, adjustable quality, supports transparency'
                      : f === 'image/bmp'
                        ? 'BMP — uncompressed, lossless, supports transparency'
                        : `ICO — favicon/icon format, capped at ${MAX_ICO_DIMENSION}×${MAX_ICO_DIMENSION}px`
              }
            >
              {TARGET_FORMAT_LABELS[f]}
            </button>
          ))}
        </div>

        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Generate a sample image to try the tool with">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={batch.jobs.length === 0} title="Remove every image and start over">
          Clear
        </button>
      </div>

      {format === 'image/x-icon' && batch.jobs.length > 0 && (
        <p class="field__hint">ICO is capped at {MAX_ICO_DIMENSION}×{MAX_ICO_DIMENSION}px — a larger image is downscaled to fit, preserving proportions.</p>
      )}

      <MultiFileDropzone
        onFilesSelected={batch.addFiles}
        roomRemaining={Math.max(0, MAX_BATCH_FILES - batch.jobs.length)}
        maxFiles={MAX_BATCH_FILES}
        chooseLabel="Choose images to convert"
        accept="image/*"
      />

      <ErrorMessage message={batch.batchError} />

      {completedJobs.length > 0 && (
        <BatchSavingsBanner
          totalBeforeBytes={totalOriginalBytes}
          totalAfterBytes={totalConvertedBytes}
          count={completedJobs.length}
          zipping={zipping}
          onDownloadAll={() => void downloadAll()}
          downloadAllTitle={`Download all ${completedJobs.length} converted images as a .zip`}
        />
      )}

      {batch.jobs.length > 0 && <ImageJobList items={jobRows} />}

      {selectedJob && (
        <div class="job-detail">
          <p class="job-detail__name">
            <span class="job-detail__filename">{outputFileName(selectedJob.file.name, selectedJob.result?.format ?? format)}</span>
            {selectedJob.result && selectedJob.file.type !== selectedJob.result.format && (
              <span class="control__hint"> (converted from {formatShortLabel(selectedJob.file.type)})</span>
            )}
          </p>

          {inputFormatWarning(selectedJob.file) && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>{inputFormatWarning(selectedJob.file)}</span>
            </p>
          )}

          {selectedJob.result?.transparencyLost && dismissedTransparencyJobId !== selectedJob.id && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>Transparency was lost converting to JPEG — it has no alpha channel, so transparent areas were filled with a solid background.</span>
              <button
                type="button"
                class="msg__dismiss"
                onClick={() => setDismissedTransparencyJobId(selectedJob.id)}
                aria-label="Dismiss this warning"
                title="Dismiss"
              >
                ✕
              </button>
            </p>
          )}

          {selectedJob.status === 'error' && <ErrorMessage message={selectedJob.error} />}
          {selectedJob.status === 'processing' && !selectedJob.result && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Converting…
            </p>
          )}

          {selectedJob.result && (
            <>
              <div class="job-detail__meta">
                <p class="job__stats" data-testid="selected-job-stats">
                  <SavingsBadge beforeBytes={selectedJob.file.size} afterBytes={selectedJob.result.blob.size} large />
                  <span class="field__hint">
                    {formatBytes(selectedJob.file.size)} → {formatBytes(selectedJob.result.blob.size)} · {selectedJob.result.width}×{selectedJob.result.height}px
                  </span>
                  {selectedJob.status === 'processing' && (
                    <span class="field__hint">
                      <span class="job__spinner" aria-hidden="true" /> Updating…
                    </span>
                  )}
                </p>
                {LOSSY_TARGET_FORMATS.has(format) && (
                  <label class="control control--inline" title="70-85% is usually visually indistinguishable from the original while cutting file size dramatically.">
                    <span class="field__hint">Quality ({Math.round(quality * 100)}%)</span>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={Math.round(quality * 100)}
                      aria-label="Quality"
                      onInput={(event) => setQuality(Number((event.target as HTMLInputElement).value) / 100)}
                    />
                    <span class="control__hint">Recommended: 70–85%</span>
                  </label>
                )}
              </div>
              <p class="field__hint">
                Original: {formatBytes(selectedJob.file.size)} · {formatShortLabel(selectedJob.file.type)}
              </p>
              <CompareSlider
                beforeUrl={selectedJob.originalUrl}
                afterUrl={selectedJob.result.url}
                afterLabel="Converted"
                width={selectedJob.result.width}
                height={selectedJob.result.height}
                // Checkerboard whenever *either* side could carry an alpha channel — basing
                // it on the target format alone (e.g. JPEG) wrongly dropped the checkerboard
                // behind a still-transparent PNG original, making its transparency look like
                // it had been removed rather than just the converted copy losing it.
                transparent={selectedJob.file.type !== 'image/jpeg' || selectedJob.result.format !== 'image/jpeg'}
              />
            </>
          )}
        </div>
      )}

      <style>{`
        .job-detail { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
        .job-detail__name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); margin: 0 0 var(--space-2); overflow-wrap: anywhere; }
        /* .msg itself carries no margin (it's used inline elsewhere too) — add the gap here
           so a warning never sits flush against whatever follows it in this panel. */
        .job-detail .msg { margin: 0 0 var(--space-3); }
        .msg__dismiss {
          margin-left: auto; flex-shrink: 0; background: none; border: none; padding: 0 0 0 var(--space-2);
          color: inherit; opacity: 0.7; cursor: pointer; font-size: var(--text-sm); line-height: 1.5;
        }
        .msg__dismiss:hover { opacity: 1; }
        .job__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0; }
        /* Puts the Quality control on the same line as the savings stats when there's room —
           roughly above the "Converted" pane below, right next to the result it affects —
           and lets it wrap to its own line on a narrow viewport instead of overflowing. */
        .job-detail__meta {
          display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3);
          flex-wrap: wrap; margin: 0 0 var(--space-3);
        }
        .job__spinner {
          display: inline-block; width: 0.9rem; height: 0.9rem; flex-shrink: 0;
          border: 2px solid var(--border-strong); border-top-color: var(--accent);
          border-radius: 50%; animation: job-detail-fmt-spin 0.6s linear infinite; vertical-align: -0.15em;
        }
        @media (prefers-reduced-motion: reduce) {
          .job__spinner { animation-duration: 1.5s; }
        }
        @keyframes job-detail-fmt-spin { to { transform: rotate(360deg); } }

        .control { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-3); max-width: 20rem; }
        .control--inline { margin-top: 0; min-width: 12rem; flex: 1 1 12rem; max-width: 20rem; }
        .control__hint { font-size: var(--text-xs); color: var(--text-subtle); }
      `}</style>
    </div>
  );
}
