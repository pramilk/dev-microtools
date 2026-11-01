import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_IMAGE_TO_PDF_OPTIONS,
  DEFAULT_OUTPUT_NAME,
  MARGIN_IDS,
  MARGIN_LABELS,
  MAX_IMAGES,
  ORIENTATION_IDS,
  ORIENTATION_LABELS,
  PAGE_SIZE_IDS,
  PAGE_SIZE_LABELS,
  batchRoom,
  moveItem,
  nextRotation,
  normalizeOutputName,
  plural,
  sortByName,
  validateImageFile,
  type ImageToPdfOptions,
  type ImageToPdfReport,
  type Rotation,
} from '../lib/tools/imageToPdf';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { MultiFileDropzone } from './shared/MultiFileDropzone';
import { PdfPreview } from './shared/PdfPreview';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import { useReorderableList } from './shared/useReorderableList';
import ImageToPdfWorker from '../workers/imageToPdf.worker?worker';
import type { ImageToPdfWorkerRequest, ImageToPdfWorkerResult } from '../workers/imageToPdf.worker';

// Deliberately no ShareLinkButton — the inputs are images from the visitor's own disk, which
// can't (and shouldn't) travel in a URL, and the page settings are meaningless without them.
// Same reasoning as Merge PDF and the image tools.

/** Edits (reordering, rotating, changing an option) wait this long before the PDF is
 *  rebuilt, so clicking rotate three times builds once. */
const REBUILD_DEBOUNCE_MS = 300;

interface ImageItem {
  id: number;
  file: File;
  /** Object URL for the row thumbnail; revoked when the item is removed. */
  thumbUrl: string;
  rotation: Rotation;
  /** Displayed size, once the thumbnail has loaded (EXIF orientation already applied). */
  size: { width: number; height: number } | null;
  /** Set when the last build couldn't read this image. */
  error: string | null;
}

interface BuiltPdf {
  url: string;
  bytes: number;
  report: ImageToPdfReport;
}

interface BuildPlan {
  items: ImageItem[];
  options: ImageToPdfOptions;
}

type Status = 'idle' | 'building' | 'done' | 'error';

const fileNameOf = (item: ImageItem): string => item.file.name;

const sameOptions = (a: ImageToPdfOptions, b: ImageToPdfOptions): boolean => a.pageSize === b.pageSize && a.orientation === b.orientation && a.margin === b.margin;

let nextItemId = 1;

export default function ImageToPdf() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [options, setOptions] = useState<ImageToPdfOptions>(DEFAULT_IMAGE_TO_PDF_OPTIONS);
  const [outputName, setOutputName] = useState(DEFAULT_OUTPUT_NAME);
  const [addError, setAddError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<BuiltPdf | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [settledKey, setSettledKey] = useState('');

  const worker = useWorkerTask<ImageToPdfWorkerRequest, ImageToPdfWorkerResult>(() => new ImageToPdfWorker());
  const resultRef = useRef<BuiltPdf | null>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  /** Latest-wins coalescing, as in Merge PDF: at most one build in flight plus one queued. */
  const inFlightRef = useRef(false);
  const queuedRef = useRef<BuildPlan | null>(null);
  const latestRequestRef = useRef(0);
  const planRef = useRef<BuildPlan | null>(null);

  itemsRef.current = items;

  const replaceResult = (next: BuiltPdf | null) => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = next;
    setResult(next);
  };

  useEffect(
    () => () => {
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
      for (const item of itemsRef.current) URL.revokeObjectURL(item.thumbUrl);
    },
    []
  );

  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const plan: BuildPlan | null = items.length > 0 ? { items, options } : null;
  const planKey = plan ? JSON.stringify([items.map((item) => [item.id, item.rotation]), options]) : '';
  planRef.current = plan;

  const run = async (target: BuildPlan): Promise<void> => {
    if (inFlightRef.current) {
      queuedRef.current = target;
      return;
    }
    inFlightRef.current = true;
    const requestId = (latestRequestRef.current += 1);
    setStatus('building');
    setBuildError(null);

    try {
      const sources = await Promise.all(target.items.map(async (item) => ({ name: item.file.name, bytes: new Uint8Array(await item.file.arrayBuffer()), rotation: item.rotation })));
      const response = await worker.run({ kind: 'build', sources, options: target.options }, { transfer: sources.map((source) => source.bytes.buffer) });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'build') throw new Error('Unexpected response from the PDF worker.');

      const failedIds = new Map<number, string>();
      if (response.ok) {
        for (const failure of response.output.report.failed) {
          const item = target.items[failure.index];
          if (item) failedIds.set(item.id, failure.error);
        }
      }
      setItems((prev) => prev.map((item) => ({ ...item, error: response.ok ? (failedIds.get(item.id) ?? null) : null })));

      if (!response.ok) {
        replaceResult(null);
        setBuildError(response.error);
        setStatus('error');
        return;
      }
      const { bytes, report } = response.output;
      replaceResult({ url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })), bytes: bytes.length, report });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      replaceResult(null);
      setBuildError(
        thrown instanceof Error && thrown.message
          ? `Making the PDF failed: ${thrown.message}`
          : 'Making the PDF failed unexpectedly. Try reloading the page, or fewer images at once.'
      );
      setStatus('error');
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) void run(queued);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKey(planKey), planKey ? REBUILD_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [planKey]);

  useEffect(() => {
    if (!settledKey) {
      latestRequestRef.current += 1; // Anything in flight belongs to a batch that no longer exists.
      queuedRef.current = null;
      replaceResult(null);
      setBuildError(null);
      setStatus('idle');
      return;
    }
    if (planRef.current) void run(planRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey]);

  const updateItem = (id: number, patch: Partial<ImageItem>) => setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const addFiles = (files: File[], existing: { count: number; bytes: number } = { count: items.length, bytes: totalBytes }) => {
    const problems: string[] = [];
    const valid: File[] = [];
    for (const file of files) {
      const validation = validateImageFile(file);
      if (validation.ok) valid.push(file);
      else problems.push(validation.error);
    }
    const room = batchRoom(existing, valid.map((file) => file.size));
    if (room.error) problems.push(room.error);
    setAddError(problems.length > 0 ? problems.join(' ') : null);

    const added: ImageItem[] = valid
      .slice(0, room.accepted)
      .map((file) => ({ id: nextItemId++, file, thumbUrl: URL.createObjectURL(file), rotation: 0, size: null, error: null }));
    if (added.length === 0) return;
    setItems((prev) => [...prev, ...added]);
    setAnnouncement(`Added ${plural(added.length, 'image')}.`);
  };

  const moveTo = (id: number, to: number, focus?: 'up' | 'down') => {
    const from = items.findIndex((item) => item.id === id);
    const moving = items[from];
    if (!moving || to < 0 || to >= items.length || from === to) return;
    if (focus) reorder.restoreFocusAfterMove(id, focus);
    setItems(moveItem(items, from, to));
    setAnnouncement(`Moved ${moving.file.name} to page ${to + 1} of ${items.length}.`);
  };

  const remove = (item: ImageItem) => {
    URL.revokeObjectURL(item.thumbUrl);
    setItems((prev) => prev.filter((candidate) => candidate.id !== item.id));
    setAnnouncement(`Removed ${item.file.name}.`);
  };

  const reorderAll = (next: ImageItem[], message: string) => {
    setItems(next);
    setAnnouncement(message);
  };

  const clearAll = () => {
    for (const item of items) URL.revokeObjectURL(item.thumbUrl);
    setItems([]);
    setOptions(DEFAULT_IMAGE_TO_PDF_OPTIONS);
    setOutputName(DEFAULT_OUTPUT_NAME);
    setAddError(null);
    setAnnouncement('Cleared all images.');
  };

  const loadExample = async () => {
    setLoadingExample(true);
    try {
      const response = await worker.run({ kind: 'samples' });
      if (response.kind !== 'samples') throw new Error('Unexpected response from the PDF worker.');
      clearAll();
      addFiles(
        response.files.map(({ name, type, bytes }) => new File([bytes as Uint8Array<ArrayBuffer>], name, { type })),
        { count: 0, bytes: 0 }
      );
    } catch (thrown: unknown) {
      setAddError(`Couldn’t generate the example images${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
    } finally {
      setLoadingExample(false);
    }
  };

  const reorder = useReorderableList({ items, onMove: (id, to) => moveTo(id, to), onFilesDropped: (files) => addFiles(files), dragLabel: fileNameOf });
  const { draggingId, dropTarget } = reorder;

  const report = result?.report;
  const downloadName = normalizeOutputName(outputName);
  const nothingToClear = items.length === 0 && !addError && sameOptions(options, DEFAULT_IMAGE_TO_PDF_OPTIONS) && outputName === DEFAULT_OUTPUT_NAME;
  const updateOption = (patch: Partial<ImageToPdfOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
  const failedCount = items.filter((item) => item.error).length;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Add three sample images (a photo, a chart and a sideways phone photo) to try the tool with">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={nothingToClear} title="Remove every image and reset all options">
          Clear
        </button>
      </div>

      <MultiFileDropzone
        onFilesSelected={(files) => addFiles(files)}
        roomRemaining={Math.max(0, MAX_IMAGES - items.length)}
        maxFiles={MAX_IMAGES}
        chooseLabel="Choose images to convert to PDF"
        accept="image/*"
        noun="images"
      />

      <ErrorMessage message={addError} />

      {items.length > 0 && (
        <section class="imgpdf-files" aria-label="Images to convert">
          <div class="imgpdf-files__bar">
            <span class="field__label">Page order ({plural(items.length, 'image')})</span>
            <span class="field__hint imgpdf-files__tip">Drag ⠿ or use the arrows to reorder</span>
            <span class="tool-bar__spacer" />
            <button type="button" class="btn" disabled={items.length < 2} onClick={() => reorderAll(sortByName(items, fileNameOf), 'Sorted images by name, A to Z.')} title="Sort by file name, A to Z — numbers in natural order, so IMG_2 comes before IMG_10">
              Sort A–Z
            </button>
            <button type="button" class="btn" disabled={items.length < 2} onClick={() => reorderAll(sortByName(items, fileNameOf, 'desc'), 'Sorted images by name, Z to A.')} title="Sort by file name, Z to A">
              Sort Z–A
            </button>
            <button type="button" class="btn" disabled={items.length < 2} onClick={() => reorderAll([...items].reverse(), 'Reversed the image order.')} title="Reverse the current order">
              Reverse
            </button>
          </div>

          <ol class="imgpdf-list" ref={reorder.listRef} onDragLeave={reorder.onListDragLeave}>
            {items.map((item, index) => {
              const classes = [
                'imgpdf-row',
                item.error && 'imgpdf-row--error',
                draggingId === item.id && 'imgpdf-row--dragging',
                dropTarget?.id === item.id && (dropTarget.after ? 'imgpdf-row--drop-after' : 'imgpdf-row--drop-before'),
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={item.id} class={classes} data-testid="image-row" {...reorder.rowProps(item)}>
                  <span class="imgpdf-row__handle" aria-hidden="true" title="Drag to reorder" {...reorder.handleProps(item)}>
                    ⠿
                  </span>
                  <span class="imgpdf-row__index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span class="imgpdf-row__thumb">
                    <img
                      src={item.thumbUrl}
                      alt=""
                      decoding="async"
                      style={{ transform: `rotate(${item.rotation}deg)` }}
                      onLoad={(event) => {
                        const img = event.currentTarget as HTMLImageElement;
                        updateItem(item.id, { size: { width: img.naturalWidth, height: img.naturalHeight } });
                      }}
                    />
                  </span>
                  <div class="imgpdf-row__main">
                    <p class="imgpdf-row__name" title={item.file.name}>
                      {item.file.name}
                    </p>
                    <p class="imgpdf-row__meta">
                      {item.error ? (
                        <span class="imgpdf-row__error">Left out: {item.error}</span>
                      ) : (
                        <span>
                          {item.size && `${item.size.width}×${item.size.height} · `}
                          {formatBytes(item.file.size)}
                          {item.rotation ? ` · rotated ${item.rotation}°` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <div class="imgpdf-row__actions">
                    <button
                      type="button"
                      class={`btn imgpdf-icon imgpdf-icon--rotate${item.rotation ? ' imgpdf-icon--active' : ''}`}
                      onClick={() => {
                        const rotation = nextRotation(item.rotation);
                        updateItem(item.id, { rotation });
                        setAnnouncement(`${item.file.name} rotated ${rotation}°.`);
                      }}
                      aria-label={`Rotate ${item.file.name} — currently ${item.rotation}°`}
                      title="Rotate this image 90° clockwise (click again for 180°, 270°, then back to 0°)"
                    >
                      ↻{item.rotation ? ` ${item.rotation}°` : ''}
                    </button>
                    <button type="button" class="btn imgpdf-icon" data-move={`${item.id}-up`} disabled={index === 0} onClick={() => moveTo(item.id, index - 1, 'up')} aria-label={`Move ${item.file.name} up`} title="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      class="btn imgpdf-icon"
                      data-move={`${item.id}-down`}
                      disabled={index === items.length - 1}
                      onClick={() => moveTo(item.id, index + 1, 'down')}
                      aria-label={`Move ${item.file.name} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button type="button" class="btn imgpdf-icon" onClick={() => remove(item)} aria-label={`Remove ${item.file.name}`} title="Remove from the PDF">
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          <fieldset class="imgpdf-options">
            <legend class="field__label">Page options</legend>
            <div class="imgpdf-options__row">
              <span class="field__hint">Page size</span>
              <div class="seg" role="group" aria-label="Page size">
                {PAGE_SIZE_IDS.map((id) => (
                  <button key={id} type="button" class="seg__btn" aria-pressed={options.pageSize === id} onClick={() => updateOption({ pageSize: id })} title={PAGE_SIZE_LABELS[id].hint}>
                    {PAGE_SIZE_LABELS[id].label}
                  </button>
                ))}
              </div>
            </div>
            <div class="imgpdf-options__row">
              <span class="field__hint">Orientation</span>
              <div class="seg" role="group" aria-label="Orientation">
                {ORIENTATION_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    class="seg__btn"
                    aria-pressed={options.orientation === id}
                    disabled={options.pageSize === 'fit'}
                    onClick={() => updateOption({ orientation: id })}
                    title={options.pageSize === 'fit' ? 'With “Fit to image”, every page takes its own image’s shape' : ORIENTATION_LABELS[id].hint}
                  >
                    {ORIENTATION_LABELS[id].label}
                  </button>
                ))}
              </div>
            </div>
            <div class="imgpdf-options__row">
              <span class="field__hint">Margin</span>
              <div class="seg" role="group" aria-label="Margin">
                {MARGIN_IDS.map((id) => (
                  <button key={id} type="button" class="seg__btn" aria-pressed={options.margin === id} onClick={() => updateOption({ margin: id })} title={MARGIN_LABELS[id].hint}>
                    {MARGIN_LABELS[id].label}
                  </button>
                ))}
              </div>
            </div>
            <p class="field__hint">
              {options.pageSize === 'fit' ? PAGE_SIZE_LABELS.fit.hint : `${PAGE_SIZE_LABELS[options.pageSize].hint} ${ORIENTATION_LABELS[options.orientation].hint}`}
            </p>
          </fieldset>
        </section>
      )}

      <ErrorMessage message={buildError} />

      {status === 'building' && (
        <p class="field__hint imgpdf-status" role="status">
          <span class="job__spinner" aria-hidden="true" /> {result ? 'Updating the PDF…' : 'Making the PDF…'}
        </p>
      )}

      {result && report && (
        <div class="imgpdf-result" data-testid="image-pdf-result">
          <div class="imgpdf-summary">
            <p class="imgpdf-summary__headline">
              <strong>{plural(report.pageCount, 'page')}</strong> · {formatBytes(result.bytes)}
            </p>
            <span class="tool-bar__spacer" />
            <label class="imgpdf-summary__name">
              <span class="sr-only">File name for the PDF</span>
              <input class="input" type="text" value={outputName} spellcheck={false} onInput={(event) => setOutputName((event.target as HTMLInputElement).value)} title="Name of the downloaded file — .pdf is added if you leave it off" />
            </label>
            <button type="button" class="btn btn--primary" onClick={() => downloadUrl(result.url, downloadName)} title={`Save as ${downloadName}`}>
              <span aria-hidden="true">⭳</span> Download PDF
            </button>
          </div>

          <ul class="imgpdf-stats">
            <li>
              {[
                report.embeddedAsIs > 0 && `${plural(report.embeddedAsIs, 'JPEG')} embedded as-is (no quality loss)`,
                report.lossless > 0 && `${plural(report.lossless, 'image')} stored losslessly`,
                report.convertedToJpeg > 0 && `${plural(report.convertedToJpeg, 'photo')} stored as high-quality JPEG`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </li>
            {report.autoRotated > 0 && <li>{plural(report.autoRotated, 'photo')} turned upright using the camera’s orientation tag.</li>}
          </ul>
          {failedCount > 0 && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>
                {plural(failedCount, 'image')} couldn’t be read and {failedCount === 1 ? 'was' : 'were'} left out — see the highlighted {failedCount === 1 ? 'row' : 'rows'} above.
              </span>
            </p>
          )}

          <PdfPreview url={result.url} heading="Preview" frameTitle="PDF preview" />
        </div>
      )}

      <p class="sr-only" aria-live="polite">
        {announcement}
      </p>

      <style>{`
        .imgpdf-files { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-3); }
        .imgpdf-files__bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .imgpdf-files .field__hint, .imgpdf-status { margin: 0; }
        .imgpdf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .imgpdf-row {
          display: grid; grid-template-columns: auto auto auto minmax(0, 1fr) auto;
          grid-template-areas: 'handle index thumb main actions';
          align-items: center; gap: var(--space-2) var(--space-3);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
          transition: box-shadow 0.12s ease, opacity 0.12s ease;
        }
        .imgpdf-row--error { border-color: var(--danger-border); }
        .imgpdf-row--dragging { opacity: 0.45; }
        .imgpdf-row--drop-before { box-shadow: 0 -3px 0 var(--accent); }
        .imgpdf-row--drop-after { box-shadow: 0 3px 0 var(--accent); }
        .imgpdf-row__handle {
          grid-area: handle; cursor: grab; color: var(--text-subtle); font-size: var(--text-lg);
          line-height: 1; padding: var(--space-1); user-select: none; border-radius: var(--radius-sm);
        }
        .imgpdf-row__handle:hover { color: var(--text); background: var(--surface-2); }
        .imgpdf-row__handle:active { cursor: grabbing; }
        .imgpdf-row__index {
          grid-area: index; min-width: 1.5rem; text-align: right;
          font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); font-variant-numeric: tabular-nums;
        }
        /* A fixed square, so a thumbnail loading (or rotating) never shifts the row. */
        .imgpdf-row__thumb {
          grid-area: thumb; width: 3rem; height: 3rem; display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); overflow: hidden;
        }
        .imgpdf-row__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; transition: transform 0.15s ease; }
        .imgpdf-row__main { grid-area: main; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
        .imgpdf-row__name {
          margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .imgpdf-row__meta { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
        .imgpdf-row__error { color: var(--danger); }
        .imgpdf-row__actions { grid-area: actions; display: flex; gap: var(--space-1); }
        .imgpdf-icon { padding: 0.4rem 0.55rem; min-width: 2.25rem; }
        .imgpdf-icon--rotate { width: 4.25rem; }
        .imgpdf-icon--active { border-color: var(--accent); color: var(--accent); }
        .imgpdf-options {
          margin: 0; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .imgpdf-options legend { padding: 0 var(--space-1); min-height: 0; }
        .imgpdf-options__row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .imgpdf-options__row > .field__hint { min-width: 6rem; }
        .imgpdf-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .imgpdf-summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .imgpdf-summary__headline { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
        .imgpdf-summary__headline strong { color: var(--text); font-size: var(--text-lg); }
        .imgpdf-summary__name { width: 14rem; max-width: 100%; }
        .imgpdf-stats { margin: 0; padding-left: var(--space-5); color: var(--text-muted); font-size: var(--text-sm); }
        .imgpdf-stats li + li { margin-top: var(--space-1); }
        .imgpdf-result .pdf-preview { margin-top: 0; }
        @media (max-width: 44rem) {
          .imgpdf-row {
            grid-template-columns: auto auto minmax(0, 1fr);
            grid-template-areas: 'index thumb main' 'actions actions actions';
          }
          /* Touch browsers don't support HTML drag and drop — the arrow buttons cover it. */
          .imgpdf-row__handle { display: none; }
          .imgpdf-row__actions { justify-content: flex-end; }
          .imgpdf-files__tip { display: none; }
          .imgpdf-summary__name { width: 100%; }
        }
      `}</style>
    </div>
  );
}
