import { useEffect, useRef, useState } from 'preact/hooks';
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
import { MultiFileDropzone } from './shared/MultiFileDropzone';
import { ErrorMessage } from './shared/ErrorMessage';

interface ConvertedResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  format: TargetFormat;
  transparencyLost: boolean;
}

interface ImageJob {
  id: string;
  file: File;
  originalUrl: string;
  status: 'converting' | 'done' | 'error';
  result: ConvertedResult | null;
  error: string | null;
}

let jobSeq = 0;
const nextJobId = (): string => `fmt-job-${(jobSeq += 1)}`;

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
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [format, setFormat] = useState<TargetFormat>('image/png');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  // The slider tracks the pointer instantly; the actual (decode + canvas re-encode) work only
  // runs against this settled value, 200ms after dragging stops — matching Image Compressor.
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const jobSeqRef = useRef<Map<string, number>>(new Map());
  const jobsRef = useRef<ImageJob[]>([]);
  jobsRef.current = jobs;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuality(quality), 200);
    return () => window.clearTimeout(timer);
  }, [quality]);

  useEffect(
    () => () => {
      jobsRef.current.forEach((job) => {
        URL.revokeObjectURL(job.originalUrl);
        if (job.result) URL.revokeObjectURL(job.result.url);
      });
    },
    []
  );

  const jobIds = jobs.map((job) => job.id).join(',');

  useEffect(() => {
    // Keeps a valid selection without yanking focus away from what's already selected: fixes
    // up only when the current selection is gone (job removed) or nothing is selected yet
    // (first image just added) — adding more images never steals selection.
    setSelectedJobId((prev) => (prev && jobs.some((job) => job.id === prev) ? prev : (jobs[0]?.id ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds]);

  const runJob = (job: ImageJob, fmt: TargetFormat, q: number) => {
    const seq = (jobSeqRef.current.get(job.id) ?? 0) + 1;
    jobSeqRef.current.set(job.id, seq);

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'converting', error: null } : j)));

    const validation = validateImageFile(job.file);
    if (!validation.ok) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'error', result: null, error: validation.error } : j)));
      return;
    }

    void convertImage(job.file, fmt, q)
      .then(({ blob, width, height, transparencyLost }) => {
        if (jobSeqRef.current.get(job.id) !== seq) return;
        const url = URL.createObjectURL(blob);
        setJobs((prev) =>
          prev.map((j) => {
            if (j.id !== job.id) return j;
            if (j.result) URL.revokeObjectURL(j.result.url);
            return { ...j, status: 'done', result: { blob, url, width, height, format: fmt, transparencyLost }, error: null };
          })
        );
      })
      .catch((thrown: unknown) => {
        if (jobSeqRef.current.get(job.id) !== seq) return;
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id ? { ...j, status: 'error', result: null, error: thrown instanceof Error ? thrown.message : 'Could not convert this image.' } : j
          )
        );
      });
  };

  useEffect(() => {
    // Re-runs every image whenever the batch's membership changes (files added/removed) or
    // the batch-wide format/quality changes.
    jobs.forEach((job) => runJob(job, format, debouncedQuality));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds, format, debouncedQuality]);

  const addFiles = (files: File[]) => {
    const room = Math.max(0, MAX_BATCH_FILES - jobs.length);
    setBatchError(
      files.length > room ? `Only ${MAX_BATCH_FILES} images can be processed in one batch — ${files.length - room} extra file(s) were skipped.` : null
    );
    const accepted = files.slice(0, room).map(
      (file): ImageJob => ({
        id: nextJobId(),
        file,
        originalUrl: URL.createObjectURL(file),
        status: 'converting',
        result: null,
        error: null,
      })
    );
    if (accepted.length > 0) setJobs((prev) => [...prev, ...accepted]);
  };

  const removeJob = (jobId: string) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === jobId);
      if (job) {
        URL.revokeObjectURL(job.originalUrl);
        if (job.result) URL.revokeObjectURL(job.result.url);
      }
      return prev.filter((j) => j.id !== jobId);
    });
  };

  const clearAll = () => {
    jobs.forEach((job) => {
      URL.revokeObjectURL(job.originalUrl);
      if (job.result) URL.revokeObjectURL(job.result.url);
    });
    setJobs([]);
    setBatchError(null);
    setSelectedJobId(null);
    setFormat('image/png');
    setQuality(DEFAULT_QUALITY);
    setDebouncedQuality(DEFAULT_QUALITY);
  };

  const loadExample = () => {
    void generateSampleImageFile().then((file) => addFiles([file]));
  };

  const downloadJob = (job: ImageJob) => {
    if (!job.result) return;
    const link = document.createElement('a');
    link.href = job.result.url;
    link.download = outputFileName(job.file.name, job.result.format);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Keyed on having a result at all, not on status === 'done' — a job re-converting in the
  // background (e.g. while dragging the quality slider) still has its *previous* result to
  // show, so it shouldn't drop out of the totals and make the savings banner (and the rest of
  // the page below it) jump in and out as the slider moves.
  const completedJobs = jobs.filter((job): job is ImageJob & { result: ConvertedResult } => job.result !== null);
  const totalOriginalBytes = completedJobs.reduce((sum, job) => sum + job.file.size, 0);
  const totalConvertedBytes = completedJobs.reduce((sum, job) => sum + job.result.blob.size, 0);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

  const downloadAll = async () => {
    if (completedJobs.length === 0) return;
    setZipping(true);
    try {
      const { zipSync } = await import('fflate');
      const entries: Record<string, Uint8Array> = {};
      const usedNames = new Set<string>();

      for (const job of completedJobs) {
        const base = baseName(job.file.name);
        const ext = TARGET_FORMAT_EXTENSIONS[job.result.format];
        let name = `${base}.${ext}`;
        let suffix = 1;
        while (usedNames.has(name)) {
          name = `${base}-${suffix}.${ext}`;
          suffix += 1;
        }
        usedNames.add(name);
        entries[name] = new Uint8Array(await job.result.blob.arrayBuffer());
      }

      const zipped = zipSync(entries);
      const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'converted-images.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

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
        <button type="button" class="btn" onClick={clearAll} disabled={jobs.length === 0} title="Remove every image and start over">
          Clear
        </button>
      </div>

      {format === 'image/x-icon' && jobs.length > 0 && (
        <p class="field__hint">ICO is capped at {MAX_ICO_DIMENSION}×{MAX_ICO_DIMENSION}px — a larger image is downscaled to fit, preserving proportions.</p>
      )}

      {LOSSY_TARGET_FORMATS.has(format) && jobs.length > 0 && (
        <label class="control" title="70-85% is usually visually indistinguishable from the original while cutting file size dramatically.">
          <span class="field__hint">Quality ({Math.round(quality * 100)}%)</span>
          <input
            type="range"
            min="1"
            max="100"
            value={Math.round(quality * 100)}
            aria-label="Quality"
            onInput={(event) => setQuality(Number((event.target as HTMLInputElement).value) / 100)}
          />
        </label>
      )}

      <MultiFileDropzone
        onFilesSelected={addFiles}
        roomRemaining={Math.max(0, MAX_BATCH_FILES - jobs.length)}
        maxFiles={MAX_BATCH_FILES}
        chooseLabel="Choose images to convert"
        accept="image/*"
      />

      <ErrorMessage message={batchError} />

      {completedJobs.length > 0 && (
        <div class="savings-banner" data-testid="total-savings">
          <SavingsBadge beforeBytes={totalOriginalBytes} afterBytes={totalConvertedBytes} large />
          <span class="field__hint">
            {formatBytes(totalOriginalBytes)} → {formatBytes(totalConvertedBytes)} across {completedJobs.length}{' '}
            image{completedJobs.length === 1 ? '' : 's'}
          </span>
          <span class="tool-bar__spacer" />
          <button
            type="button"
            class="btn btn--primary"
            onClick={() => void downloadAll()}
            disabled={zipping}
            title={`Download all ${completedJobs.length} converted images as a .zip`}
          >
            <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : `Download all (${completedJobs.length})`}
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <ul class="job-list">
          {jobs.map((job) => (
            <li class={`job${job.id === selectedJobId ? ' job--selected' : ''}`} key={job.id}>
              <img src={job.originalUrl} alt="" class={`job__thumb${job.file.type === 'image/png' ? ' job__thumb--checkerboard' : ''}`} />
              <button type="button" class="job__select" aria-pressed={job.id === selectedJobId} onClick={() => setSelectedJobId(job.id)} title={`View ${job.file.name}`}>
                <span class="job__info">
                  <span class="job__name">{outputFileName(job.file.name, job.result?.format ?? format)}</span>
                  {job.result && (
                    <span class="job__size field__hint">
                      {formatBytes(job.file.size)} → {formatBytes(job.result.blob.size)}
                    </span>
                  )}
                </span>
                {/* Keeps showing the last result while a re-conversion runs in the background
                    (status flips back to 'converting' every time format/quality changes) —
                    hiding the badge every tick made the row, the totals banner above, and the
                    rest of the page jump as items shifted in and out. */}
                {job.status === 'converting' && <span class="job__spinner" aria-hidden="true" />}
                {job.status === 'converting' && !job.result && <span class="field__hint">Converting…</span>}
                {job.status === 'error' && <span class="job__error-flag">Error</span>}
                {job.result?.transparencyLost && (
                  <span class="job__warning-flag" aria-hidden="true" title="Transparency was lost — JPEG has no alpha channel, so transparent areas were filled in.">
                    ⚠
                  </span>
                )}
                {job.result && <SavingsBadge beforeBytes={job.file.size} afterBytes={job.result.blob.size} />}
              </button>
              <span class="job__actions">
                {job.result && (
                  <button type="button" class="btn" onClick={() => downloadJob(job)} title={`Save ${job.file.name} as a converted file`}>
                    <span aria-hidden="true">⭳</span> Download
                  </button>
                )}
                <button type="button" class="btn" onClick={() => removeJob(job.id)} title={`Remove ${job.file.name}`} aria-label={`Remove ${job.file.name}`}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

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

          {selectedJob.result?.transparencyLost && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>Transparency was lost converting to JPEG — it has no alpha channel, so transparent areas were filled with a solid background.</span>
            </p>
          )}

          {selectedJob.status === 'error' && <ErrorMessage message={selectedJob.error} />}
          {selectedJob.status === 'converting' && !selectedJob.result && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Converting…
            </p>
          )}

          {selectedJob.result && (
            <>
              <p class="job__stats" data-testid="selected-job-stats">
                <SavingsBadge beforeBytes={selectedJob.file.size} afterBytes={selectedJob.result.blob.size} large />
                <span class="field__hint">
                  {formatBytes(selectedJob.file.size)} → {formatBytes(selectedJob.result.blob.size)} · {selectedJob.result.width}×{selectedJob.result.height}px
                </span>
                {selectedJob.status === 'converting' && (
                  <span class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Updating…
                  </span>
                )}
              </p>
              <div class="panes panes--split">
                <div class="field">
                  <span class="field__label">Original</span>
                  <div class="image-preview">
                    <img src={selectedJob.originalUrl} alt={selectedJob.file.name} />
                  </div>
                  <p class="field__hint">
                    {formatBytes(selectedJob.file.size)} · {formatShortLabel(selectedJob.file.type)}
                  </p>
                </div>
                <div class="field">
                  <div class="field__label">
                    <span>Converted</span>
                    <button type="button" class="btn" onClick={() => downloadJob(selectedJob)} title={`Save as ${outputFileName(selectedJob.file.name, selectedJob.result.format)}`}>
                      <span aria-hidden="true">⭳</span> Download
                    </button>
                  </div>
                  <div class={`image-preview${selectedJob.result.format !== 'image/jpeg' ? ' image-preview--checkerboard' : ''}`}>
                    <img src={selectedJob.result.url} alt={`${selectedJob.file.name}, converted to ${TARGET_FORMAT_LABELS[selectedJob.result.format]}`} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        /* Compact, clickable gallery — select a row to view its full comparison below,
           rather than stacking a full preview under every single image. */
        .job-list { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .job {
          display: flex; align-items: center; gap: var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
          padding: var(--space-2);
        }
        .job--selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .job__select {
          display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0;
          background: none; border: none; padding: 0; margin: 0; text-align: left; cursor: pointer; color: inherit; font: inherit;
        }
        .job__thumb { flex-shrink: 0; width: 2.5rem; height: 2.5rem; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); }
        .job__thumb--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
        }
        .job__info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .job__name { font-family: var(--font-mono); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .job__size { font-size: var(--text-xs); }
        .job__actions { display: flex; gap: var(--space-2); flex-shrink: 0; }

        .job-detail { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
        .job-detail__name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); margin: 0 0 var(--space-2); overflow-wrap: anywhere; }
        .job__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0 0 var(--space-3); }
        .job__error-flag { font-size: var(--text-sm); font-weight: 600; color: var(--danger); }
        .job__warning-flag { color: var(--warning); font-size: var(--text-base); line-height: 1; cursor: help; }
        .job__spinner {
          display: inline-block; width: 0.9rem; height: 0.9rem; flex-shrink: 0;
          border: 2px solid var(--border-strong); border-top-color: var(--accent);
          border-radius: 50%; animation: fmt-job-spin 0.6s linear infinite; vertical-align: -0.15em;
        }
        @media (prefers-reduced-motion: reduce) {
          .job__spinner { animation-duration: 1.5s; }
        }
        @keyframes fmt-job-spin { to { transform: rotate(360deg); } }

        .savings-banner {
          display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
          margin: var(--space-4) 0 0; padding: var(--space-3); border-radius: var(--radius-lg);
          background: var(--surface); border: 1px solid var(--border);
        }

        .control { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-3); max-width: 20rem; }
        .control__hint { font-size: var(--text-xs); color: var(--text-subtle); }

        .image-preview {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); min-height: 10rem;
          display: flex; align-items: center; justify-content: center; padding: var(--space-3);
        }
        .image-preview img { max-width: 100%; max-height: 16rem; }
        .image-preview--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }
      `}</style>
    </div>
  );
}
