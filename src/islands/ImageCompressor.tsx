import { useEffect, useRef, useState } from 'preact/hooks';
import {
  validateImageFile,
  computeTargetDimensions,
  OUTPUT_FORMATS,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMAT_EXTENSIONS,
  LOSSY_FORMATS,
  DEFAULT_QUALITY,
  MAX_BATCH_FILES,
  optimizePngLosslessly,
  type OutputFormat,
} from '../lib/tools/imageCompress';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';

/** Floor for the Max dimension slider — a UI bound only (the underlying field accepts any positive number by typing it), just low enough that dragging never produces a degenerate near-zero image. */
const MIN_DIMENSION_SLIDER = 16;

interface CompressedResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  /** The format actually baked into `blob` — not necessarily the batch-wide `format` state, since "Keep original format" can make this job's own format differ from it. Everything that names or downloads this result (filename, extension, zip entry) must read this, not the global format. */
  format: OutputFormat;
  /** True when this image had real (non-opaque) alpha and converted to JPEG, which has no alpha channel — transparent areas were flattened onto an opaque background. */
  transparencyLost: boolean;
}

interface ImageJob {
  id: string;
  file: File;
  originalUrl: string;
  /** Raw text of this image's own Max dimension field — per-image, since a batch can mix a 4K photo with a small icon that needs no downscaling at all. */
  maxDimension: string;
  originalWidth: number | null;
  originalHeight: number | null;
  /** Per-image override of "Keep original format" — lets one image opt out of the batch-wide output format without turning the global toggle on for every other image too. Only meaningful (and only shown) when this image's own format differs from what it would otherwise convert to. */
  keepOriginal: boolean;
  status: 'compressing' | 'done' | 'error';
  result: CompressedResult | null;
  error: string | null;
}

let jobSeq = 0;
const nextJobId = (): string => `job-${(jobSeq += 1)}`;

/**
 * Decodes and re-encodes an image through an off-screen canvas — inherently DOM-bound
 * (`createImageBitmap`, `<canvas>`), so unlike the rest of `src/lib/tools`, this stays in
 * the island rather than the pure logic layer, matching how the QR Code Generator keeps
 * its own canvas rasterization here instead of in `lib/tools/qrcode.ts`.
 */
/** Source formats that can actually carry an alpha channel — checking for real transparency is only worth the pixel scan below when converting one of these to JPEG, the one output format with no alpha support at all. */
const ALPHA_CAPABLE_SOURCE_TYPES = new Set(['image/png', 'image/webp', 'image/avif']);

/** Scans the alpha channel of whatever's currently drawn on `context` for any non-opaque pixel. Only called for a JPEG-bound image whose source format can carry alpha — cheap in the common case (most such images have no real transparency to find, but this still has to touch every pixel to be sure), and never run at all for the two formats (WebP, PNG) that don't need this warning. */
function canvasHasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

async function compressImage(
  file: File,
  format: OutputFormat,
  quality: number,
  maxDimension: number | null
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  format: OutputFormat;
  transparencyLost: boolean;
}> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
  }

  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxDimension);

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

  const transparencyLost = format === 'image/jpeg' && ALPHA_CAPABLE_SOURCE_TYPES.has(file.type) && canvasHasTransparency(context, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format, LOSSY_FORMATS.has(format) ? quality : undefined)
  );
  if (!blob) throw new Error('Compression failed — try a different format or a smaller image.');

  if (format === 'image/png') {
    // The canvas encoder above only does a generic deflate pass — Oxipng (WASM) finds real
    // extra savings on top with no pixel changes, so it's always worth trying, and only
    // kept if it actually helped.
    const optimized = await optimizePngLosslessly(await blob.arrayBuffer());
    const optimizedBlob = new Blob([optimized], { type: 'image/png' });
    if (optimizedBlob.size < blob.size) return { blob: optimizedBlob, width, height, originalWidth, originalHeight, format, transparencyLost };
  }

  return { blob, width, height, originalWidth, originalHeight, format, transparencyLost };
}

/**
 * Generates a modest, deterministic sample image via canvas, so "Load example" has something
 * with a real size to shrink without bundling an actual photo asset. Encoded in whichever
 * output format is currently selected, so the loaded sample's own filename/type matches what
 * the tool-bar shows instead of always looking like a PNG regardless of format chosen.
 */
async function generateSampleImageFile(format: OutputFormat): Promise<File> {
  const size = 640;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not support canvas image export.');

  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#3cbcd4');
  gradient.addColorStop(0.5, '#7c5cff');
  gradient.addColorStop(1, '#0d1117');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format));
  if (!blob) throw new Error('Could not generate a sample image.');
  return new File([blob], `sample.${OUTPUT_FORMAT_EXTENSIONS[format]}`, { type: format });
}

/** A filename base with its extension stripped, so a new extension can be appended for the compressed output. */
const baseName = (filename: string): string => filename.replace(/\.[^./]+$/, '') || 'image';

/** A short, human-readable format name from a MIME type — "JPEG", "PNG", "BMP" — for the three formats this tool encodes and for any other browser-decodable type a user might drop in. */
const formatShortLabel = (mime: string): string => {
  if ((OUTPUT_FORMATS as readonly string[]).includes(mime)) return OUTPUT_FORMAT_LABELS[mime as OutputFormat].replace(' (lossless)', '');
  const subtype = mime.split('/')[1];
  return subtype ? subtype.toUpperCase() : mime;
};

/** The filename a job will actually download as — the resolved format's extension appended to the original name's base, which can differ from the uploaded file's own extension (e.g. a dropped "photo.png" downloads as "photo.jpg" once JPEG output is picked). Shown everywhere a job's name appears so that format conversion is visible before download, not a surprise after it. */
const outputFileName = (file: File, format: OutputFormat): string => `${baseName(file.name)}.${OUTPUT_FORMAT_EXTENSIONS[format]}`;

const SUPPORTED_KEEP_FORMATS = new Set<string>(OUTPUT_FORMATS);

/** The format a given file actually compresses to: its own format when "Keep original format" is on and that format is one of the three this tool can encode, otherwise the batch-wide fallback format selected in the tool-bar. */
const effectiveFormat = (file: File, fallback: OutputFormat, keepOriginal: boolean): OutputFormat =>
  keepOriginal && SUPPORTED_KEEP_FORMATS.has(file.type) ? (file.type as OutputFormat) : fallback;

/** A drop zone that accepts one or many images at once — unlike the shared single-file `FileDropzone`, which every other file-based tool here uses. */
function MultiFileDropzone({ onFilesSelected, roomRemaining }: { onFilesSelected: (files: File[]) => void; roomRemaining: number }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      class={`dropzone${dragOver ? ' dropzone--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFilesSelected(files);
      }}
    >
      {/* Reflects how many more images the batch can actually take, not always the flat
          MAX_BATCH_FILES cap — once some are already added, "up to 30" reads as wrong. */}
      <p>
        {roomRemaining === MAX_BATCH_FILES
          ? `Drag one or more images here (up to ${MAX_BATCH_FILES} at once), or`
          : roomRemaining > 0
            ? `Drag more images here (${roomRemaining} more allowed), or`
            : `Batch is full (${MAX_BATCH_FILES} max) — remove one to add another, or`}
      </p>
      <label class="btn">
        Choose images
        <input
          type="file"
          class="sr-only"
          accept="image/*"
          multiple
          aria-label="Choose images to compress"
          onChange={(event) => {
            const input = event.target as HTMLInputElement;
            const files = Array.from(input.files ?? []);
            if (files.length > 0) onFilesSelected(files);
            input.value = '';
          }}
        />
      </label>
    </div>
  );
}

/** A format-button or "Keep original format" change waiting on user confirmation, since either can re-compress and rename every image already in the batch. Holds which one is pending so the banner can phrase itself correctly and `confirmPendingAction` knows which state to commit. */
type PendingAction = { kind: 'format'; value: OutputFormat } | { kind: 'keepOriginal'; value: boolean };

export default function ImageCompressor() {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [format, setFormat] = useState<OutputFormat>('image/jpeg');
  /** When on, an uploaded file that's already JPEG, WebP, or PNG keeps its own format instead of converting to `format` above — anything else still falls back to `format`. */
  const [keepOriginalFormat, setKeepOriginalFormat] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  // The slider itself is bound to `quality` so dragging always tracks the pointer instantly;
  // the actual (expensive: decode + canvas encode + WASM Oxipng for PNG) recompression only
  // runs against this settled value, 200ms after dragging stops — running it on every tick
  // was heavy enough to make the slider itself feel laggy while dragging.
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  // Tracks the latest compression request per image (not one shared counter), so editing one
  // image's own Max dimension field can't get its result thrown away by a batch-wide re-run
  // (or vice versa) racing it — only a *newer* request for that same image invalidates it.
  const jobSeqRef = useRef<Map<string, number>>(new Map());
  // Per-image debounce for the Max dimension slider/input, same reasoning as quality above.
  // Typed `number` (the browser's setTimeout return type) rather than `ReturnType<typeof
  // setTimeout>`, which resolves to Node's `Timeout` here because @types/node is in scope.
  const maxDimensionTimersRef = useRef<Map<string, number>>(new Map());
  const jobsRef = useRef<ImageJob[]>([]);
  jobsRef.current = jobs;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuality(quality), 200);
    return () => window.clearTimeout(timer);
  }, [quality]);

  useEffect(
    () => () => {
      maxDimensionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    []
  );

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
    // Keeps a valid selection without yanking focus away from what's already selected:
    // fixes up only when the current selection is gone (job removed) or nothing is
    // selected yet (first image just added) — adding more images never steals selection.
    setSelectedJobId((prev) => (prev && jobs.some((job) => job.id === prev) ? prev : (jobs[0]?.id ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds]);

  /** (Re)compresses one image with the given batch-wide settings and that image's own maxDimension. Safe to call directly from an event handler (e.g. editing one image's Max dimension) without waiting on an effect. */
  const runJob = (job: ImageJob, fmt: OutputFormat, q: number) => {
    const seq = (jobSeqRef.current.get(job.id) ?? 0) + 1;
    jobSeqRef.current.set(job.id, seq);

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'compressing', error: null } : j)));

    const validation = validateImageFile(job.file);
    if (!validation.ok) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'error', result: null, error: validation.error } : j)));
      return;
    }

    const maxDimension = job.maxDimension.trim() === '' ? null : Number(job.maxDimension);
    const jobFormat = effectiveFormat(job.file, fmt, keepOriginalFormat || job.keepOriginal);

    void compressImage(job.file, jobFormat, q, maxDimension)
      .then(({ blob, width, height, originalWidth, originalHeight, format: resultFormat, transparencyLost }) => {
        if (jobSeqRef.current.get(job.id) !== seq) return;
        const url = URL.createObjectURL(blob);
        setJobs((prev) =>
          prev.map((j) => {
            if (j.id !== job.id) return j;
            if (j.result) URL.revokeObjectURL(j.result.url);
            return {
              ...j,
              status: 'done',
              result: { blob, url, width, height, format: resultFormat, transparencyLost },
              originalWidth,
              originalHeight,
              error: null,
            };
          })
        );
      })
      .catch((thrown: unknown) => {
        if (jobSeqRef.current.get(job.id) !== seq) return;
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: 'error', result: null, error: thrown instanceof Error ? thrown.message : 'Could not compress this image.' }
              : j
          )
        );
      });
  };

  useEffect(() => {
    // Re-runs every image whenever the batch's membership changes (files added/removed) or a
    // batch-wide setting (format/quality/keep-original) changes. A single image's own Max
    // dimension field instead triggers `runJob` directly from its own input handler, below.
    jobs.forEach((job) => runJob(job, format, debouncedQuality));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds, format, debouncedQuality, keepOriginalFormat]);

  const updateJobMaxDimension = (job: ImageJob, value: string) => {
    const updated: ImageJob = { ...job, maxDimension: value };
    setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));

    const pending = maxDimensionTimersRef.current.get(job.id);
    if (pending) window.clearTimeout(pending);
    maxDimensionTimersRef.current.set(
      job.id,
      window.setTimeout(() => {
        maxDimensionTimersRef.current.delete(job.id);
        runJob(updated, format, debouncedQuality);
      }, 200)
    );
  };

  /** Scoped to one image, so — unlike the batch-wide format toggle and format buttons — this applies immediately with no confirmation banner; the blast radius is a single row, not the whole batch. */
  const toggleJobKeepOriginal = (job: ImageJob, next: boolean) => {
    const updated: ImageJob = { ...job, keepOriginal: next };
    setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    runJob(updated, format, debouncedQuality);
  };

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
        maxDimension: '',
        originalWidth: null,
        originalHeight: null,
        keepOriginal: false,
        status: 'compressing',
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
    setFormat('image/jpeg');
    setKeepOriginalFormat(false);
    setPendingAction(null);
    setQuality(DEFAULT_QUALITY);
    setDebouncedQuality(DEFAULT_QUALITY);
    maxDimensionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    maxDimensionTimersRef.current.clear();
  };

  const loadExample = () => {
    void generateSampleImageFile(format).then((file) => addFiles([file]));
  };

  /** Switching output format, or toggling "Keep original format", re-compresses (and can rename) every image already in the batch — worth confirming once there's something to lose, rather than silently converting files a user only meant to preview. Held as pending rather than applied via `window.confirm`, so the prompt is an in-page banner matching the rest of the UI instead of a jarring native browser dialog. */
  const requestFormatChange = (next: OutputFormat) => {
    if (next === format) return;
    if (jobs.length === 0) {
      setFormat(next);
      return;
    }
    setPendingAction({ kind: 'format', value: next });
  };

  const requestKeepOriginalFormatChange = (next: boolean) => {
    if (jobs.length === 0) {
      setKeepOriginalFormat(next);
      return;
    }
    setPendingAction({ kind: 'keepOriginal', value: next });
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.kind === 'format') setFormat(pendingAction.value);
    else setKeepOriginalFormat(pendingAction.value);
    setPendingAction(null);
  };

  const downloadJob = (job: ImageJob) => {
    if (!job.result) return;
    const link = document.createElement('a');
    link.href = job.result.url;
    link.download = outputFileName(job.file, job.result.format);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Keyed on having a result at all, not on status === 'done' — a job re-compressing in the
  // background (e.g. while dragging the quality slider) still has its *previous* result to
  // show, so it shouldn't drop out of the totals and make the savings banner (and the whole
  // page below it) jump in and out as the slider moves.
  const completedJobs = jobs.filter((job): job is ImageJob & { result: CompressedResult } => job.result !== null);
  const totalOriginalBytes = completedJobs.reduce((sum, job) => sum + job.file.size, 0);
  const totalCompressedBytes = completedJobs.reduce((sum, job) => sum + job.result.blob.size, 0);
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
        const ext = OUTPUT_FORMAT_EXTENSIONS[job.result.format];
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
      link.download = 'compressed-images.zip';
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
          practical way to carry arbitrary photo bytes in a shareable URL. */}
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Output format">
          {OUTPUT_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              class="seg__btn"
              aria-pressed={format === f}
              onClick={() => requestFormatChange(f)}
              title={
                (f === 'image/png' ? 'PNG — always lossless, re-compressed further with a WASM optimizer' : `${OUTPUT_FORMAT_LABELS[f]} — lossy, adjustable quality`) +
                (keepOriginalFormat ? ' — used as a fallback for anything "Keep original format" can\'t keep as-is.' : '')
              }
            >
              {OUTPUT_FORMAT_LABELS[f]}
            </button>
          ))}
        </div>

        <label
          class="checkbox"
          title="An image that's already JPEG, WebP, or PNG keeps its own format instead of converting to the one selected above. Anything else (BMP, AVIF, ...) still falls back to that format, since this tool can only encode those three."
        >
          <input
            type="checkbox"
            checked={keepOriginalFormat}
            onChange={(event) => requestKeepOriginalFormatChange((event.target as HTMLInputElement).checked)}
          />
          <span>Keep original format</span>
        </label>

        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Generate a sample image to try the tool with">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={jobs.length === 0} title="Remove every image and start over">
          Clear
        </button>
      </div>

      {pendingAction && (
        <p class="msg msg--warning" role="alertdialog" aria-label="Confirm output format change">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span class="msg__body">
            {pendingAction.kind === 'format' ? (
              <>
                Switch output format to {OUTPUT_FORMAT_LABELS[pendingAction.value]}? This will re-compress the {jobs.length} image
                {jobs.length === 1 ? '' : 's'} you've already added and download {jobs.length === 1 ? 'it' : 'them'} as{' '}
                {OUTPUT_FORMAT_EXTENSIONS[pendingAction.value]} files instead.
              </>
            ) : pendingAction.value ? (
              <>
                Keep each image's own format from now on? Any of the {jobs.length} image{jobs.length === 1 ? '' : 's'} already added that's
                already JPEG, WebP, or PNG will re-compress in its own format instead of converting to {OUTPUT_FORMAT_LABELS[format]}.
              </>
            ) : (
              <>
                Stop keeping each image's own format? This will re-compress the {jobs.length} image{jobs.length === 1 ? '' : 's'} you've
                already added to {OUTPUT_FORMAT_LABELS[format]}.
              </>
            )}
            <span class="msg__actions">
              <button type="button" class="btn btn--primary" onClick={confirmPendingAction}>
                {pendingAction.kind === 'format'
                  ? `Switch to ${OUTPUT_FORMAT_LABELS[pendingAction.value]}`
                  : pendingAction.value
                    ? 'Keep original formats'
                    : `Convert all to ${OUTPUT_FORMAT_LABELS[format]}`}
              </button>
              <button type="button" class="btn" onClick={() => setPendingAction(null)}>
                Cancel
              </button>
            </span>
          </span>
        </p>
      )}

      <MultiFileDropzone onFilesSelected={addFiles} roomRemaining={Math.max(0, MAX_BATCH_FILES - jobs.length)} />

      <ErrorMessage message={batchError} />

      {completedJobs.length > 0 && (
        <div class="savings-banner" data-testid="total-savings">
          <SavingsBadge beforeBytes={totalOriginalBytes} afterBytes={totalCompressedBytes} large />
          <span class="field__hint">
            {formatBytes(totalOriginalBytes)} → {formatBytes(totalCompressedBytes)} across {completedJobs.length}{' '}
            image{completedJobs.length === 1 ? '' : 's'}
          </span>
          <span class="tool-bar__spacer" />
          <button
            type="button"
            class="btn btn--primary"
            onClick={() => void downloadAll()}
            disabled={zipping}
            title={`Download all ${completedJobs.length} compressed images as a .zip`}
          >
            <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : `Download all (${completedJobs.length})`}
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <ul class="job-list">
          {jobs.map((job) => (
            <li class={`job${job.id === selectedJobId ? ' job--selected' : ''}`} key={job.id}>
              <span class="job__thumb-group">
                <img src={job.originalUrl} alt="" class={`job__thumb${job.file.type === 'image/png' ? ' job__thumb--checkerboard' : ''}`} />
                {/* Only shown when it would actually change something: the global toggle is
                    off, this file is one of the three formats the tool can "keep", and its
                    own format differs from the one it would otherwise convert to. A control
                    that's always visible but usually a no-op would just be noise. Locked =
                    stays in its own format; unlocked = follows the batch format like the rest. */}
                {!keepOriginalFormat && SUPPORTED_KEEP_FORMATS.has(job.file.type) && job.file.type !== format && (
                  <button
                    type="button"
                    class="job__lock"
                    aria-pressed={job.keepOriginal}
                    onClick={() => toggleJobKeepOriginal(job, !job.keepOriginal)}
                    title={
                      job.keepOriginal
                        ? `Locked to ${formatShortLabel(job.file.type)} — click to let it convert to ${OUTPUT_FORMAT_LABELS[format]} like the rest of the batch.`
                        : `Lock this image to its own format (${formatShortLabel(job.file.type)}) instead of converting it to ${OUTPUT_FORMAT_LABELS[format]}.`
                    }
                    aria-label={
                      job.keepOriginal
                        ? `${job.file.name} is locked to ${formatShortLabel(job.file.type)}, unlock to convert it`
                        : `Lock ${job.file.name} to ${formatShortLabel(job.file.type)}`
                    }
                  >
                    <span aria-hidden="true">{job.keepOriginal ? '🔒' : '🔓'}</span>
                  </button>
                )}
              </span>
              <button
                type="button"
                class="job__select"
                aria-pressed={job.id === selectedJobId}
                onClick={() => setSelectedJobId(job.id)}
                title={`View ${job.file.name}`}
              >
                <span class="job__info">
                  <span class="job__name">
                    {outputFileName(job.file, job.result?.format ?? effectiveFormat(job.file, format, keepOriginalFormat || job.keepOriginal))}
                  </span>
                  {job.result && (
                    <span class="job__size field__hint">
                      {formatBytes(job.file.size)} → {formatBytes(job.result.blob.size)}
                    </span>
                  )}
                </span>
                {/* Keeps showing the last result while a re-compression runs in the
                    background (status flips back to 'compressing' every time format/quality/max
                    dimension changes) — hiding the badge every tick made the row, the totals
                    banner above, and the rest of the page jump as items shifted in and out. The
                    spinner is what actually signals "this is stale, working on it" instead —
                    PNG's WASM pass in particular can take a moment, and a badge that just sits
                    there unchanged reads as nothing happening. */}
                {job.status === 'compressing' && <span class="job__spinner" aria-hidden="true" />}
                {job.status === 'compressing' && !job.result && <span class="field__hint">Compressing…</span>}
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
                  <button type="button" class="btn" onClick={() => downloadJob(job)} title={`Save ${job.file.name} as a compressed file`}>
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
            <span class="job-detail__filename">
              {outputFileName(
                selectedJob.file,
                selectedJob.result?.format ?? effectiveFormat(selectedJob.file, format, keepOriginalFormat || selectedJob.keepOriginal)
              )}
            </span>
            {/* Makes the format conversion visible before download, not a surprise after — a
                dropped "photo.png" shows as "photo.jpg" the moment JPEG output is picked.
                Compared by MIME type, not the filename's own extension spelling, so a
                "photo.jpeg" re-encoded to JPEG output correctly doesn't flag as "converted".
                Names the original format explicitly (not just the filename) since the
                filename alone doesn't say what format a name like "photo" without an
                extension, or an unusual one like .jfif, actually was. */}
            {selectedJob.result && selectedJob.file.type !== selectedJob.result.format && (
              <span class="control__hint"> (converted from {formatShortLabel(selectedJob.file.type)})</span>
            )}
          </p>

          {selectedJob.result?.transparencyLost && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>Transparency was lost converting to JPEG — it has no alpha channel, so transparent areas were filled with a solid background.</span>
            </p>
          )}

          {selectedJob.status === 'error' && <ErrorMessage message={selectedJob.error} />}
          {selectedJob.status === 'compressing' && !selectedJob.result && (
            <p class="field__hint">
              <span class="job__spinner" aria-hidden="true" /> Compressing…
            </p>
          )}

          {/* Keeps showing the last result (and the controls) while a change re-compresses in
              the background, instead of unmounting everything — losing the slider mid-drag
              every time quality/dimension changes would make it unusable. */}
          {selectedJob.result && (
            <>
              <p class="job__stats" data-testid="selected-job-stats">
                <SavingsBadge beforeBytes={selectedJob.file.size} afterBytes={selectedJob.result.blob.size} large />
                <span class="field__hint">
                  {formatBytes(selectedJob.file.size)} → {formatBytes(selectedJob.result.blob.size)}
                </span>
                {selectedJob.status === 'compressing' && (
                  <span class="field__hint">
                    <span class="job__spinner" aria-hidden="true" /> Updating…
                  </span>
                )}
              </p>
              <div class="compare-panel">
                <div class="compare-panel__controls">
                  {LOSSY_FORMATS.has(selectedJob.result.format) && (
                    <label class="control" title="70-85% is usually visually indistinguishable from the original while cutting file size dramatically. Go lower only for thumbnails or previews where some visible compression is acceptable.">
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
                  <label
                    class="control"
                    title="Downscale so this image's longer side (width or height, whichever is bigger) never exceeds this many pixels, keeping its proportions. Leave blank (or drag the slider to its rightmost end) to keep its original size."
                  >
                    <span class="field__hint">
                      Max dimension (px)
                      {selectedJob.originalWidth && selectedJob.originalHeight && (
                        <span class="control__original">
                          {' '}
                          · original {selectedJob.originalWidth}×{selectedJob.originalHeight}
                        </span>
                      )}
                    </span>
                    {selectedJob.originalWidth && selectedJob.originalHeight && (
                      <input
                        type="range"
                        min={MIN_DIMENSION_SLIDER}
                        max={Math.max(selectedJob.originalWidth, selectedJob.originalHeight)}
                        value={
                          selectedJob.maxDimension.trim() === ''
                            ? Math.max(selectedJob.originalWidth, selectedJob.originalHeight)
                            : Number(selectedJob.maxDimension)
                        }
                        aria-label={`Maximum dimension slider for ${selectedJob.file.name}`}
                        onInput={(event) => updateJobMaxDimension(selectedJob, (event.target as HTMLInputElement).value)}
                      />
                    )}
                    <input
                      type="number"
                      class="input"
                      min="1"
                      placeholder={
                        selectedJob.originalWidth && selectedJob.originalHeight
                          ? String(Math.max(selectedJob.originalWidth, selectedJob.originalHeight))
                          : 'Original'
                      }
                      value={selectedJob.maxDimension}
                      aria-label={`Maximum dimension in pixels for ${selectedJob.file.name} — downscales the longer side, keeping proportions`}
                      onInput={(event) => updateJobMaxDimension(selectedJob, (event.target as HTMLInputElement).value)}
                    />
                    <span class="control__hint">
                      Output: {selectedJob.result.width}×{selectedJob.result.height}px
                    </span>
                  </label>
                </div>
                <CompareSlider
                  beforeUrl={selectedJob.originalUrl}
                  afterUrl={selectedJob.result.url}
                  width={selectedJob.result.width}
                  height={selectedJob.result.height}
                  transparent={selectedJob.file.type === 'image/png' || selectedJob.result.format === 'image/png'}
                />
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        .dropzone {
          border: 2px dashed var(--border-strong); border-radius: var(--radius-lg);
          padding: var(--space-6) var(--space-4); text-align: center;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: var(--space-2); color: var(--text-muted); background: var(--surface);
          min-height: 8rem;
        }
        .dropzone--active { border-color: var(--accent); background: var(--accent-subtle); }

        /* Compact, clickable gallery — select a row to view its full comparison below,
           rather than stacking a full compare slider under every single image. */
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
        /* Sits outside .job__select (a <button>) rather than inside it — nested interactive
           controls (a button inside a button) aren't valid HTML. */
        .job__thumb-group { position: relative; flex-shrink: 0; display: inline-flex; }
        .job__thumb { width: 2.5rem; height: 2.5rem; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); }
        /* Smaller checker squares than the full-size preview's — the 16px pattern used
           there would read as a couple of muddy blobs at this thumbnail's actual size. */
        .job__thumb--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
        }
        .job__lock {
          position: absolute; bottom: -0.35rem; right: -0.35rem; display: flex; align-items: center; justify-content: center;
          width: 1.15rem; height: 1.15rem; font-size: 0.65rem; line-height: 1;
          background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          padding: 0; cursor: pointer; box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
        }
        .job__lock[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-subtle); }
        .job__info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .job__name { font-family: var(--font-mono); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .job__size { font-size: var(--text-xs); }
        .job__actions { display: flex; gap: var(--space-2); flex-shrink: 0; }

        .job-detail {
          margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border);
        }
        .job-detail__name { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-muted); margin: 0 0 var(--space-2); overflow-wrap: anywhere; }
        .job__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0 0 var(--space-3); }
        .job__error-flag { font-size: var(--text-sm); font-weight: 600; color: var(--danger); }
        .job__warning-flag { color: var(--warning); font-size: var(--text-base); line-height: 1; cursor: help; }
        .job__spinner {
          display: inline-block; width: 0.9rem; height: 0.9rem; flex-shrink: 0;
          border: 2px solid var(--border-strong); border-top-color: var(--accent);
          border-radius: 50%; animation: job-spin 0.6s linear infinite; vertical-align: -0.15em;
        }
        @media (prefers-reduced-motion: reduce) {
          .job__spinner { animation-duration: 1.5s; }
        }
        @keyframes job-spin { to { transform: rotate(360deg); } }

        .savings-banner {
          display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
          margin: var(--space-4) 0 0; padding: var(--space-3); border-radius: var(--radius-lg);
          background: var(--surface); border: 1px solid var(--border);
        }

        /* In-page confirmation for a format switch — deliberately not window.confirm(), which
           renders as a jarring native browser dialog that clashes with everything else here. */
        .msg--warning { margin-top: var(--space-3); }
        .msg__body { display: flex; flex-direction: column; gap: var(--space-2); flex: 1; }
        .msg__actions { display: flex; gap: var(--space-2); }

        /* Puts quality/dimension controls directly beside the image they affect, so adjusting
           one and seeing the compare result is one glance, not a scroll back up to the
           tool-bar — and per-image, since a batch can mix a 4K photo with a small icon that
           needs a completely different Max dimension. */
        .compare-panel { display: flex; align-items: flex-start; gap: var(--space-4); margin-top: var(--space-3); }
        .compare-panel__controls {
          display: flex; flex-direction: column; gap: var(--space-4);
          width: 13rem; flex-shrink: 0; padding-top: var(--space-2);
        }
        .control { display: flex; flex-direction: column; gap: var(--space-1); }
        .control__original { font-weight: 400; color: var(--text-subtle); }
        .control__hint { font-size: var(--text-xs); color: var(--text-subtle); }
        @media (max-width: 40rem) {
          .compare-panel { flex-direction: column; }
          .compare-panel__controls { width: 100%; }
        }
      `}</style>
    </div>
  );
}
