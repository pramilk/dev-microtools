import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_MIN_SIDE,
  IMAGE_COLOR_LABELS,
  IMAGE_FORMAT_INFO,
  SKIPPED_REASON_LABELS,
  formatPages,
  imageFileName,
  isTinyImage,
  plural,
  validatePdfFile,
  zipFileName,
  type ExtractedPdfImage,
  type PdfImageExtractReport,
} from '../lib/tools/pdfImageExtract';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { downloadUrl } from './shared/downloadUrl';
import { downloadZip } from './shared/downloadZip';
import { useWorkerTask } from './shared/useWorkerTask';
import PdfImageExtractWorker from '../workers/pdfImageExtract.worker?worker';
import type { PdfImageExtractWorkerRequest, PdfImageExtractWorkerResult } from '../workers/pdfImageExtract.worker';

// Deliberately no ShareLinkButton — the input is a binary PDF from the visitor's own disk,
// which can't (and shouldn't) travel in a URL. Same reasoning as the other PDF and image tools.

interface GalleryImage extends Omit<ExtractedPdfImage, 'bytes'> {
  blob: Blob;
  url: string;
  fileName: string;
}

interface Extraction {
  images: GalleryImage[];
  report: PdfImageExtractReport;
}

type Status = 'idle' | 'processing' | 'done' | 'error';
type CopyState = 'idle' | 'copied' | 'failed';

function revoke(extraction: Extraction | null): void {
  for (const image of extraction?.images ?? []) URL.revokeObjectURL(image.url);
}

const supportsImageClipboard = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;

/** Browsers only reliably accept PNG on the clipboard, so a JPEG is converted on demand. */
async function asPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('PNG encode failed'))), 'image/png'));
  } finally {
    bitmap.close();
  }
}

export default function PdfImageExtractor() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [showTiny, setShowTiny] = useState(false);
  const [zipping, setZipping] = useState(false);
  /** Index into `visible` of the image open in the viewer, or null when it's closed. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const worker = useWorkerTask<PdfImageExtractWorkerRequest, PdfImageExtractWorkerResult>(() => new PdfImageExtractWorker());
  const extractionRef = useRef<Extraction | null>(null);
  const latestRequestRef = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  const replaceExtraction = (next: Extraction | null) => {
    revoke(extractionRef.current);
    extractionRef.current = next;
    setExtraction(next);
  };

  useEffect(
    () => () => {
      revoke(extractionRef.current);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    []
  );

  const images = extraction?.images ?? [];
  const tinyCount = images.filter((image) => isTinyImage(image)).length;
  const visible = showTiny ? images : images.filter((image) => !isTinyImage(image));
  const viewing = viewerIndex === null ? null : (visible[viewerIndex] ?? null);

  // The native <dialog> gives a real modal for free: focus is trapped inside, Escape closes
  // it, and focus returns to the thumbnail that opened it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (viewing && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!viewing && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [viewing]);

  const run = async (target: File): Promise<void> => {
    const requestId = (latestRequestRef.current += 1);
    setStatus('processing');
    setError(null);
    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      const response = await worker.run({ kind: 'extract', bytes }, { transfer: [bytes.buffer] });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'extract') throw new Error('Unexpected response from the extraction worker.');
      if (!response.ok) {
        replaceExtraction(null);
        setError(response.error);
        setStatus('error');
        return;
      }
      const { images: extracted, report } = response.output;
      replaceExtraction({
        report,
        images: extracted.map(({ bytes: imageBytes, ...image }) => {
          const blob = new Blob([imageBytes as Uint8Array<ArrayBuffer>], { type: IMAGE_FORMAT_INFO[image.format].mime });
          return { ...image, blob, url: URL.createObjectURL(blob), fileName: imageFileName(target.name, image, extracted.length) };
        }),
      });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      replaceExtraction(null);
      setError(
        thrown instanceof Error && thrown.message
          ? `Extraction failed: ${thrown.message}`
          : 'Extraction failed unexpectedly. Try reloading the page, or a smaller file.'
      );
      setStatus('error');
    }
  };

  const selectFile = (next: File | null) => {
    latestRequestRef.current += 1; // Anything still in flight belongs to the previous file.
    replaceExtraction(null);
    setViewerIndex(null);
    setError(null);
    setStatus('idle');
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
    void run(next);
  };

  const clearAll = () => {
    selectFile(null);
    setShowTiny(false);
  };

  const loadExample = async () => {
    setLoadingExample(true);
    setError(null);
    try {
      const response = await worker.run({ kind: 'sample' });
      if (response.kind !== 'sample') throw new Error('Unexpected response from the extraction worker.');
      selectFile(new File([response.bytes as Uint8Array<ArrayBuffer>], 'sample-brochure.pdf', { type: 'application/pdf' }));
    } catch (thrown: unknown) {
      setError(`Couldn’t generate the example PDF${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
      setStatus('error');
    } finally {
      setLoadingExample(false);
    }
  };

  const downloadAll = async () => {
    if (!file || visible.length === 0) return;
    setZipping(true);
    setError(null);
    try {
      await downloadZip(
        visible.map((image) => ({ name: image.fileName, blob: image.blob })),
        zipFileName(file.name)
      );
    } catch (thrown: unknown) {
      setError(`Couldn’t build the ZIP${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'} Try downloading images one at a time.`);
    } finally {
      setZipping(false);
    }
  };

  const copyImage = async (image: GalleryImage) => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    try {
      // The ClipboardItem gets a *promise* of the PNG so Safari still counts the write as
      // part of the click, even though converting a JPEG takes a moment.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': asPngBlob(image.blob) })]);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    copyTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1600);
  };

  const step = (delta: number) => {
    if (viewerIndex === null || visible.length === 0) return;
    setCopyState('idle');
    setViewerIndex((viewerIndex + delta + visible.length) % visible.length);
  };

  const report = extraction?.report;
  const canCopy = supportsImageClipboard();

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample || status === 'processing'} title="Generate a two-page sample PDF with a photo, a chart and a transparent logo to try the tool with">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={!file && !error} title="Remove the PDF and its extracted images">
          Clear
        </button>
      </div>

      <FileDropzone file={file} onFileSelected={selectFile} chooseLabel="Choose a PDF to extract images from" accept="application/pdf,.pdf" />

      <ErrorMessage message={error} />

      {status === 'processing' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Extracting images… large PDFs can take a little while.
        </p>
      )}

      {file && report && status === 'done' && (
        <div class="pie-result" data-testid="pie-result">
          {report.extracted === 0 ? (
            <p class="msg msg--info">
              <span class="msg__icon" aria-hidden="true">
                i
              </span>
              <span>
                {report.found === 0
                  ? `No images found in this PDF’s ${plural(report.pageCount, 'page')} — its content is text and vector graphics, which aren’t stored as images.`
                  : `${plural(report.found, 'image')} found, but none could be extracted: ${report.skippedReasons.map((reason) => SKIPPED_REASON_LABELS[reason]).join('; ')}.`}
              </span>
            </p>
          ) : (
            <>
              <div class="pie-summary">
                <p class="pie-summary__text">
                  <strong>{plural(report.extracted, 'image')}</strong> from {plural(report.pageCount, 'page')}
                  {report.duplicatesMerged > 0 && <span class="field__hint"> · {plural(report.duplicatesMerged, 'repeated copy', 'repeated copies')} shown once</span>}
                </p>
                <span class="tool-bar__spacer" />
                <button
                  type="button"
                  class="btn btn--primary"
                  onClick={() => void downloadAll()}
                  disabled={zipping || visible.length === 0}
                  title={`Save the ${plural(visible.length, 'image')} shown below as ${zipFileName(file.name)}`}
                >
                  <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : `Download all (${visible.length}) as ZIP`}
                </button>
              </div>

              <ul class="pie-notes">
                {tinyCount > 0 && (
                  <li>
                    <label class="checkbox" title={`Images under ${DEFAULT_MIN_SIDE}px on a side are usually spacers, bullets or rules`}>
                      <input type="checkbox" checked={showTiny} onChange={(event) => setShowTiny((event.target as HTMLInputElement).checked)} />
                      <span>
                        Show {plural(tinyCount, 'tiny image')} (under {DEFAULT_MIN_SIDE}px)
                      </span>
                    </label>
                  </li>
                )}
                {report.skipped > 0 && (
                  <li>
                    {plural(report.skipped, 'image')} couldn’t be extracted: {report.skippedReasons.map((reason) => SKIPPED_REASON_LABELS[reason]).join('; ')}.
                  </li>
                )}
              </ul>

              <ul class="pie-grid" aria-label="Extracted images">
                {visible.map((image, index) => {
                  const info = IMAGE_FORMAT_INFO[image.format];
                  return (
                    <li key={image.url} class="pie-card">
                      <button
                        type="button"
                        class={`pie-card__thumb${image.hasAlpha ? ' pie-checkerboard' : ''}`}
                        onClick={() => {
                          setCopyState('idle');
                          setViewerIndex(index);
                        }}
                        aria-label={`View image ${image.number} (${image.width}×${image.height} ${info.label}) larger`}
                        title="View larger"
                      >
                        {info.previewable ? (
                          <img src={image.url} alt="" loading="lazy" decoding="async" width={image.width} height={image.height} />
                        ) : (
                          <span class="pie-card__noprev">{info.label}: no browser preview</span>
                        )}
                      </button>
                      <div class="pie-card__meta">
                        <span class="pie-card__title">Image {image.number}</span>
                        <span class="field__hint">
                          {image.width}×{image.height} · {info.label} · {formatBytes(image.blob.size)}
                        </span>
                        <span class="field__hint">
                          {formatPages(image.pages)} · {IMAGE_COLOR_LABELS[image.color]}
                          {image.hasAlpha ? ' · transparent' : ''}
                        </span>
                      </div>
                      <button type="button" class="btn pie-card__download" onClick={() => downloadUrl(image.url, image.fileName)} title={`Save as ${image.fileName}`}>
                        <span aria-hidden="true">⭳</span> Download
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <dialog
        ref={dialogRef}
        class="pie-viewer"
        aria-label={viewing ? `Image ${viewing.number} of ${images.length}` : 'Image viewer'}
        onClose={() => setViewerIndex(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') step(1);
          else if (event.key === 'ArrowLeft') step(-1);
        }}
        onClick={(event) => {
          // A click on the backdrop lands on the <dialog> element itself.
          if (event.target === dialogRef.current) setViewerIndex(null);
        }}
      >
        {viewing && (
          <div class="pie-viewer__body">
            <div class="pie-viewer__bar">
              <p class="pie-viewer__title">
                Image {viewing.number} · {viewing.width}×{viewing.height} {IMAGE_FORMAT_INFO[viewing.format].label} · {formatPages(viewing.pages)}
              </p>
              <span class="tool-bar__spacer" />
              <button type="button" class="btn" onClick={() => setViewerIndex(null)} aria-label="Close viewer" title="Close (Esc)">
                ✕
              </button>
            </div>
            <div class={`pie-viewer__stage${viewing.hasAlpha ? ' pie-checkerboard' : ''}`}>
              {IMAGE_FORMAT_INFO[viewing.format].previewable ? (
                <img src={viewing.url} alt={`Image ${viewing.number} extracted from ${file?.name ?? 'the PDF'}`} />
              ) : (
                <p class="field__hint">Browsers can’t display JPEG 2000 images — download it to open in an image viewer.</p>
              )}
            </div>
            <div class="pie-viewer__bar">
              <button type="button" class="btn" onClick={() => step(-1)} disabled={visible.length < 2} title="Previous image (←)">
                ← Previous
              </button>
              <button type="button" class="btn" onClick={() => step(1)} disabled={visible.length < 2} title="Next image (→)">
                Next →
              </button>
              <span class="tool-bar__spacer" />
              {canCopy && IMAGE_FORMAT_INFO[viewing.format].previewable && (
                <button type="button" class={`btn${copyState === 'copied' ? ' btn--copied' : ''}`} onClick={() => void copyImage(viewing)} title="Copy this image to the clipboard as PNG">
                  {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy image'}
                </button>
              )}
              <a class="btn" href={viewing.url} target="_blank" rel="noopener" title="Open the image at full size in a new tab">
                Open in new tab
              </a>
              <button type="button" class="btn btn--primary" onClick={() => downloadUrl(viewing.url, viewing.fileName)} title={`Save as ${viewing.fileName}`}>
                <span aria-hidden="true">⭳</span> Download
              </button>
            </div>
          </div>
        )}
      </dialog>

      <style>{`
        .pie-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
        .pie-summary { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        .pie-summary__text { margin: 0; color: var(--text); }
        .pie-notes { list-style: none; margin: var(--space-3) 0 0; padding: 0; color: var(--text-muted); font-size: var(--text-sm); }
        .pie-notes li + li { margin-top: var(--space-2); }
        .pie-grid {
          list-style: none; margin: var(--space-4) 0 0; padding: 0;
          display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        }
        .pie-card {
          display: flex; flex-direction: column; gap: var(--space-2); min-width: 0;
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: var(--space-2);
        }
        .pie-card__thumb {
          display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; width: 100%;
          border: 1px solid var(--border); border-radius: var(--radius); background-color: var(--surface-2);
          padding: var(--space-1); cursor: zoom-in; overflow: hidden; color: var(--text-muted);
        }
        .pie-card__thumb:hover { border-color: var(--accent-border); }
        .pie-card__thumb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .pie-card__thumb img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; image-rendering: auto; }
        .pie-card__noprev { font-size: var(--text-xs); text-align: center; }
        .pie-card__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .pie-card__meta .field__hint { margin: 0; font-size: var(--text-xs); overflow-wrap: anywhere; }
        .pie-card__title { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
        .pie-card__download { align-self: flex-start; }
        .pie-checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }
        .pie-viewer {
          width: min(64rem, calc(100vw - 2rem)); max-width: none; max-height: calc(100vh - 2rem);
          padding: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
          background: var(--surface); color: var(--text);
        }
        .pie-viewer::backdrop { background: rgb(0 0 0 / 0.7); }
        .pie-viewer__body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3); max-height: calc(100vh - 2rem); }
        .pie-viewer__bar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .pie-viewer__bar a.btn { text-decoration: none; }
        .pie-viewer__title { margin: 0; font-size: var(--text-sm); font-weight: 600; font-family: var(--font-mono); overflow-wrap: anywhere; }
        .pie-viewer__stage {
          display: flex; align-items: center; justify-content: center; min-height: 12rem; flex: 1 1 auto; overflow: auto;
          border-radius: var(--radius); background-color: var(--surface-2);
        }
        .pie-viewer__stage img { max-width: 100%; max-height: calc(100vh - 12rem); object-fit: contain; }
      `}</style>
    </div>
  );
}
