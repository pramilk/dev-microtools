import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_PRESET,
  DPI_CHOICES,
  PDF_IMAGE_FORMATS,
  PDF_IMAGE_FORMAT_HINTS,
  PDF_IMAGE_FORMAT_LABELS,
  PDF_PRESETS,
  PDF_PRESET_IDS,
  UNSUPPORTED_REASON_LABELS,
  plural,
  presetMatching,
  usesJpegQuality,
  validatePdfFile,
  type PdfCompressOptions,
  type PdfCompressReport,
} from '../lib/tools/pdfCompress';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { PdfPreview } from './shared/PdfPreview';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import PdfCompressWorker from '../workers/pdfCompress.worker?worker';
import type { PdfCompressWorkerRequest, PdfCompressWorkerResult } from '../workers/pdfCompress.worker';

// Deliberately no ShareLinkButton — the input is a binary PDF from the visitor's own disk,
// which can't (and shouldn't) travel in a URL, and the settings alone are meaningless
// without it. Same reasoning as the image tools.

/** Settings changes wait this long before re-running, so dragging the quality slider
 *  doesn't queue a full re-compression per pixel of movement. */
const RERUN_DEBOUNCE_MS = 300;

interface CompressedPdf {
  url: string;
  bytes: number;
  report: PdfCompressReport;
  preview: { beforeUrl: string; afterUrl: string; width: number; height: number; originalWidth: number; originalHeight: number } | null;
}

type Status = 'idle' | 'processing' | 'done' | 'error';

const outputFileName = (file: File): string => `${file.name.replace(/\.pdf$/i, '') || 'document'}-compressed.pdf`;

const blobUrl = (bytes: Uint8Array, type: string): string => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));

function revoke(result: CompressedPdf | null): void {
  if (!result) return;
  if (result.url) URL.revokeObjectURL(result.url);
  if (result.preview) {
    URL.revokeObjectURL(result.preview.beforeUrl);
    URL.revokeObjectURL(result.preview.afterUrl);
  }
}

/** Which document the whole-file viewer shows. */
type ViewerSource = 'compressed' | 'original';

const dpiLabel = (dpi: number | null): string => (dpi === null ? 'Original (no downsampling)' : `${dpi} DPI`);

export default function PdfCompressor() {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<PdfCompressOptions>(PDF_PRESETS[DEFAULT_PRESET].options);
  const [settledOptions, setSettledOptions] = useState<PdfCompressOptions>(options);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompressedPdf | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [viewerSource, setViewerSource] = useState<ViewerSource>('compressed');
  /** Object URL of the file as chosen, for the viewer's "Original" side. Owned separately
   *  from `result` because it lives exactly as long as the file does, across re-runs. */
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  const worker = useWorkerTask<PdfCompressWorkerRequest, PdfCompressWorkerResult>(() => new PdfCompressWorker());
  const resultRef = useRef<CompressedPdf | null>(null);
  /** Latest-wins coalescing: at most one compression in flight plus one queued, so a burst
   *  of settings changes on a big PDF costs one extra run, not one per change. */
  const inFlightRef = useRef(false);
  const queuedRef = useRef<{ file: File; options: PdfCompressOptions } | null>(null);
  const latestRequestRef = useRef(0);

  const activePreset = presetMatching(options);
  const replaceResult = (next: CompressedPdf | null) => {
    revoke(resultRef.current);
    resultRef.current = next;
    setResult(next);
  };

  useEffect(() => () => revoke(resultRef.current), []);

  useEffect(() => {
    if (!file) {
      setOriginalUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledOptions(options), RERUN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [options]);

  const run = async (target: File, runOptions: PdfCompressOptions): Promise<void> => {
    if (inFlightRef.current) {
      queuedRef.current = { file: target, options: runOptions };
      return;
    }
    inFlightRef.current = true;
    const requestId = (latestRequestRef.current += 1);
    setStatus('processing');
    setError(null);

    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      const response = await worker.run({ kind: 'compress', bytes, options: runOptions }, { transfer: [bytes.buffer] });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'compress') throw new Error('Unexpected response from the compression worker.');
      if (!response.ok) {
        replaceResult(null);
        setError(response.error);
        setStatus('error');
        return;
      }
      const { output } = response;
      replaceResult({
        url: output.report.keptOriginal ? '' : blobUrl(output.bytes, 'application/pdf'),
        bytes: output.bytes.length,
        report: output.report,
        preview: output.preview && {
          beforeUrl: blobUrl(output.preview.before.bytes, output.preview.before.mime),
          afterUrl: blobUrl(output.preview.after.bytes, output.preview.after.mime),
          width: output.preview.width,
          height: output.preview.height,
          originalWidth: output.preview.originalWidth,
          originalHeight: output.preview.originalHeight,
        },
      });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      replaceResult(null);
      setError(
        thrown instanceof Error && thrown.message
          ? `Compression failed: ${thrown.message}`
          : 'Compression failed unexpectedly. Try reloading the page, or a smaller file.'
      );
      setStatus('error');
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) void run(queued.file, queued.options);
    }
  };

  useEffect(() => {
    if (file) void run(file, settledOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, settledOptions]);

  const selectFile = (next: File | null) => {
    queuedRef.current = null;
    latestRequestRef.current += 1; // Anything still in flight belongs to the previous file.
    replaceResult(null);
    setError(null);
    setStatus('idle');
    setViewerSource('compressed');
    if (!next) {
      setFile(null);
      return;
    }
    const validation = validatePdfFile(next);
    if (!validation.ok) {
      setFile(null);
      setError(validation.error);
      setStatus('error');
      return;
    }
    setFile(next);
  };

  const update = (patch: Partial<PdfCompressOptions>) => setOptions((prev) => ({ ...prev, ...patch }));

  const clearAll = () => {
    selectFile(null);
    const defaults = PDF_PRESETS[DEFAULT_PRESET].options;
    setOptions(defaults);
    setSettledOptions(defaults);
  };

  const loadExample = async () => {
    setLoadingExample(true);
    setError(null);
    try {
      const response = await worker.run({ kind: 'sample' });
      if (response.kind !== 'sample') throw new Error('Unexpected response from the compression worker.');
      selectFile(new File([response.bytes as Uint8Array<ArrayBuffer>], 'sample-report.pdf', { type: 'application/pdf' }));
    } catch (thrown: unknown) {
      setError(`Couldn’t generate the example PDF${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
      setStatus('error');
    } finally {
      setLoadingExample(false);
    }
  };

  const report = result?.report;
  const showQuality = usesJpegQuality(options);

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Compression level">
          {PDF_PRESET_IDS.map((id) => (
            <button key={id} type="button" class="seg__btn" aria-pressed={activePreset === id} onClick={() => setOptions(PDF_PRESETS[id].options)} title={PDF_PRESETS[id].hint}>
              {PDF_PRESETS[id].label}
            </button>
          ))}
        </div>
        {activePreset === null && (
          <span class="field__hint" title="Your advanced settings don't match a preset">
            Custom settings
          </span>
        )}
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Generate a sample PDF with text and a large photo to try the tool with">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={!file && !error && activePreset === DEFAULT_PRESET} title="Remove the PDF and reset every setting">
          Clear
        </button>
      </div>


      <FileDropzone
        file={file}
        onFileSelected={selectFile}
        chooseLabel="Choose a PDF to compress"
        accept="application/pdf,.pdf"
      />

      <details class="customize">
        <summary>Advanced options (image format, quality, resolution…)</summary>
        <div class="customize__body">
          <div class="pdfc-field">
            <span class="field__label">Image format</span>
            <div class="seg" role="group" aria-label="Image format">
              {PDF_IMAGE_FORMATS.map((format) => (
                <button key={format} type="button" class="seg__btn" aria-pressed={options.imageFormat === format} onClick={() => update({ imageFormat: format })} title={PDF_IMAGE_FORMAT_HINTS[format]}>
                  {PDF_IMAGE_FORMAT_LABELS[format]}
                </button>
              ))}
            </div>
            <span class="field__hint">
              {PDF_IMAGE_FORMAT_HINTS[options.imageFormat]} PDF files can only store JPEG, JPEG 2000 or lossless images — WebP and AVIF aren’t allowed inside a PDF.
            </span>
          </div>

          {showQuality && (
            <label class="pdfc-field" title="70–85% is usually indistinguishable on screen. Below 50% expect visible blockiness around text in scans.">
              <span class="field__label">JPEG quality ({Math.round(options.quality * 100)}%)</span>
              <input type="range" min="10" max="100" value={Math.round(options.quality * 100)} aria-label="JPEG quality" onInput={(event) => update({ quality: Number((event.target as HTMLInputElement).value) / 100 })} />
              <span class="field__hint">Recommended: 60–85%. Lower is smaller but blockier.</span>
            </label>
          )}

          <label class="pdfc-field" title="Images sharper than this (measured against a full page) are downsampled. 150 DPI suits screens and office printers; 300 DPI is print quality.">
            <span class="field__label">Max image resolution</span>
            <select
              class="select"
              value={options.maxDpi === null ? 'original' : String(options.maxDpi)}
              onChange={(event) => {
                const value = (event.target as HTMLSelectElement).value;
                update({ maxDpi: value === 'original' ? null : Number(value) });
              }}
            >
              {DPI_CHOICES.map((dpi) => (
                <option key={String(dpi)} value={dpi === null ? 'original' : String(dpi)}>
                  {dpiLabel(dpi)}
                </option>
              ))}
            </select>
            <span class="field__hint">Downsampling is usually the biggest single saving — a 600 DPI scan capped at 150 DPI has 16× fewer pixels.</span>
          </label>

          <div class="pdfc-checks">
            <label class="checkbox" title="Converts colour images to grayscale — a big extra saving for scanned documents where colour doesn't matter.">
              <input type="checkbox" checked={options.grayscale} onChange={(event) => update({ grayscale: (event.target as HTMLInputElement).checked })} />
              <span>Convert images to grayscale</span>
            </label>
            <label class="checkbox" title="Removes title, author, creator app, XMP metadata and editor-private data. Leave off for PDF/A archival files, which require metadata.">
              <input type="checkbox" checked={options.removeMetadata} onChange={(event) => update({ removeMetadata: (event.target as HTMLInputElement).checked })} />
              <span>Remove metadata</span>
            </label>
            <label class="checkbox" title="Removes embedded page-thumbnail images. Modern PDF viewers generate thumbnails themselves.">
              <input type="checkbox" checked={options.removeThumbnails} onChange={(event) => update({ removeThumbnails: (event.target as HTMLInputElement).checked })} />
              <span>Remove embedded thumbnails</span>
            </label>
          </div>
          <p class="field__hint">
            Always applied, with no quality cost: maximum-level recompression of text and font streams, merging duplicate images and fonts,
            removing unused objects, and compact object streams. Text stays selectable — pages are never turned into pictures.
          </p>
        </div>
      </details>

      <ErrorMessage message={error} />

      {status === 'processing' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Compressing{result ? ' with new settings' : ''}… large scanned PDFs can take a little while.
        </p>
      )}

      {file && result && report && (
        <div class="pdfc-result" data-testid="pdf-result">
          {report.keptOriginal ? (
            <p class="msg msg--info">
              <span class="msg__icon" aria-hidden="true">
                i
              </span>
              <span>
                This PDF couldn’t be made any smaller with these settings — it’s already well optimized
                {report.images.total === 0 ? ' and has no images to re-encode' : ''}. Try the Strong preset, a lower quality or resolution
                {report.images.total > 0 && !options.grayscale ? ', or grayscale' : ''}.
              </span>
            </p>
          ) : (
            <div class="pdfc-summary">
              <SavingsBadge beforeBytes={report.originalBytes} afterBytes={result.bytes} large />
              <span class="field__hint">
                {formatBytes(report.originalBytes)} → {formatBytes(result.bytes)}
              </span>
              <span class="tool-bar__spacer" />
              <button type="button" class="btn btn--primary" onClick={() => downloadUrl(result.url, outputFileName(file))} title={`Save as ${outputFileName(file)}`}>
                <span aria-hidden="true">⭳</span> Download PDF
              </button>
            </div>
          )}

          <ul class="pdfc-stats">
            <li>
              {plural(report.pageCount, 'page')} · {report.images.recompressed} of {plural(report.images.total, 'image')} re-encoded
              {report.images.unchanged > 0 && ` · ${report.images.unchanged} already optimal`}
            </li>
            {(report.streamsRecompressed > 0 || report.duplicatesMerged > 0 || report.unusedObjectsRemoved > 0) && (
              <li>
                {[
                  report.streamsRecompressed > 0 && `${plural(report.streamsRecompressed, 'text/font stream')} recompressed`,
                  report.duplicatesMerged > 0 && `${plural(report.duplicatesMerged, 'duplicate')} merged`,
                  report.unusedObjectsRemoved > 0 && `${plural(report.unusedObjectsRemoved, 'unused object')} removed`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            )}
            {(report.metadataRemoved || report.thumbnailsRemoved > 0) && (
              <li>
                {[report.metadataRemoved && 'Metadata removed', report.thumbnailsRemoved > 0 && `${plural(report.thumbnailsRemoved, 'thumbnail')} removed`]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            )}
            {report.images.unsupported > 0 && (
              <li>
                {plural(report.images.unsupported, 'image')} left as-is: {report.unsupportedReasons.map((reason) => UNSUPPORTED_REASON_LABELS[reason]).join('; ')}.
              </li>
            )}
          </ul>

          {(() => {
            // When nothing got smaller the tool hands back no new file, so the only
            // document there is to show is the original.
            const showing: ViewerSource = report.keptOriginal ? 'original' : viewerSource;
            const url = showing === 'original' ? originalUrl : result.url;
            if (!url) return null;
            return (
              <PdfPreview
                url={url}
                heading="Document preview"
                frameTitle={`${showing === 'original' ? 'Original' : 'Compressed'} PDF preview`}
                controls={
                  !report.keptOriginal && (
                    <div class="seg" role="group" aria-label="Document to preview">
                      <button type="button" class="seg__btn" aria-pressed={showing === 'compressed'} onClick={() => setViewerSource('compressed')} title="Scroll through the compressed PDF exactly as it will download">
                        Compressed
                      </button>
                      <button type="button" class="seg__btn" aria-pressed={showing === 'original'} onClick={() => setViewerSource('original')} title="Scroll through your original file, to compare page by page">
                        Original
                      </button>
                    </div>
                  )
                }
              />
            );
          })()}

          {result.preview && (
            <div class="pdfc-preview">
              <p class="field__hint">
                Largest image in the document — drag to compare. {result.preview.originalWidth}×{result.preview.originalHeight}px →{' '}
                {result.preview.width}×{result.preview.height}px
              </p>
              <CompareSlider beforeUrl={result.preview.beforeUrl} afterUrl={result.preview.afterUrl} width={result.preview.width} height={result.preview.height} />
            </div>
          )}
        </div>
      )}

      <style>{`
        .customize {
          margin-top: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          background: var(--surface); padding: var(--space-3) var(--space-4);
        }
        .customize summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text); list-style: none; }
        .customize summary::-webkit-details-marker { display: none; }
        .customize summary::before { content: '▸ '; color: var(--text-subtle); }
        .customize[open] summary::before { content: '▾ '; }
        .customize__body { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-3); }
        .customize__body .field__hint { margin: 0; }
        .pdfc-field { display: flex; flex-direction: column; gap: var(--space-2); max-width: 36rem; }
        .pdfc-field .seg { align-self: flex-start; }
        .pdfc-checks { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
        .pdfc-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
        .pdfc-summary { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        .pdfc-stats { margin: var(--space-3) 0 0; padding-left: var(--space-5); color: var(--text-muted); font-size: var(--text-sm); }
        .pdfc-stats li + li { margin-top: var(--space-1); }
        .pdfc-preview { margin-top: var(--space-4); }
      `}</style>
    </div>
  );
}
