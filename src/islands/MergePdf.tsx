import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { validatePdfFile } from '../lib/tools/pdfFile';
import {
  DEFAULT_MERGE_OPTIONS,
  DEFAULT_OUTPUT_NAME,
  MAX_MERGE_FILES,
  batchRoom,
  describeSelection,
  moveItem,
  nextRotation,
  normalizeOutputName,
  parsePageRanges,
  plural,
  sortByName,
  type PdfMergeOptions,
  type PdfMergeReport,
  type PdfSourceInfo,
  type Rotation,
} from '../lib/tools/pdfMerge';
import type { ToolResult } from '../lib/tools/result';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { MultiFileDropzone } from './shared/MultiFileDropzone';
import { PdfPreview } from './shared/PdfPreview';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import { useReorderableList } from './shared/useReorderableList';
import PdfMergeWorker from '../workers/pdfMerge.worker?worker';
import type { PdfMergeWorkerRequest, PdfMergeWorkerResult } from '../workers/pdfMerge.worker';

// Deliberately no ShareLinkButton — the inputs are PDFs from the visitor's own disk, which
// can't (and shouldn't) travel in a URL, and the order/page ranges are meaningless without
// them. Same reasoning as PDF Compressor and the image tools.

/** Edits (typing a page range, reordering, toggling an option) wait this long before the
 *  merge re-runs, so typing "1-12" doesn't merge three times on the way. */
const RERUN_DEBOUNCE_MS = 350;

interface MergeItem {
  id: number;
  file: File;
  status: 'reading' | 'ready' | 'error';
  info: PdfSourceInfo | null;
  error: string | null;
  /** The page selection as typed; empty means all pages. */
  range: string;
  rotation: Rotation;
}

interface MergedPdf {
  url: string;
  bytes: number;
  report: PdfMergeReport;
}

interface MergePlan {
  entries: { item: MergeItem; pages: number[] }[];
  options: PdfMergeOptions;
}

type Status = 'idle' | 'merging' | 'done' | 'error';

const selectionOf = (item: MergeItem): ToolResult<number[]> | null =>
  item.status === 'ready' && item.info ? parsePageRanges(item.range, item.info.pageCount) : null;

const sameOptions = (a: PdfMergeOptions, b: PdfMergeOptions): boolean =>
  (Object.keys(a) as (keyof PdfMergeOptions)[]).every((key) => a[key] === b[key]);

const fileNameOf = (item: MergeItem): string => item.file.name;

let nextItemId = 1;

export default function MergePdf() {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [options, setOptions] = useState<PdfMergeOptions>(DEFAULT_MERGE_OPTIONS);
  const [outputName, setOutputName] = useState(DEFAULT_OUTPUT_NAME);
  const [addError, setAddError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<MergedPdf | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [settledKey, setSettledKey] = useState('');

  const worker = useWorkerTask<PdfMergeWorkerRequest, PdfMergeWorkerResult>(() => new PdfMergeWorker());
  const resultRef = useRef<MergedPdf | null>(null);
  /** Latest-wins coalescing, as in PDF Compressor: at most one merge in flight plus one
   *  queued, so a burst of edits on big files costs one extra run, not one per edit. */
  const inFlightRef = useRef(false);
  const queuedRef = useRef<MergePlan | null>(null);
  const latestRequestRef = useRef(0);
  const planRef = useRef<MergePlan | null>(null);

  const replaceResult = (next: MergedPdf | null) => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = next;
    setResult(next);
  };

  useEffect(
    () => () => {
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    },
    []
  );

  const selections = useMemo(() => new Map(items.map((item) => [item.id, selectionOf(item)])), [items]);
  const readyItems = items.filter((item) => item.status === 'ready');
  const readingCount = items.filter((item) => item.status === 'reading').length;
  const unreadableCount = items.filter((item) => item.status === 'error').length;
  const invalidRange = readyItems.some((item) => selections.get(item.id)?.ok === false);
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);

  // Nothing merges while a file is still being read (its pages aren't known yet) or while a
  // page range is invalid — the preview would otherwise show a merge the visitor didn't ask for.
  const plan: MergePlan | null =
    readyItems.length > 0 && readingCount === 0 && !invalidRange
      ? {
          entries: readyItems.map((item) => {
            const selection = selections.get(item.id);
            return { item, pages: selection?.ok ? selection.value : [] };
          }),
          options,
        }
      : null;
  const planKey = plan ? JSON.stringify([plan.entries.map(({ item, pages }) => [item.id, pages, item.rotation]), plan.options]) : '';
  planRef.current = plan;

  const run = async (target: MergePlan): Promise<void> => {
    if (inFlightRef.current) {
      queuedRef.current = target;
      return;
    }
    inFlightRef.current = true;
    const requestId = (latestRequestRef.current += 1);
    setStatus('merging');
    setMergeError(null);

    try {
      const sources = await Promise.all(
        target.entries.map(async ({ item, pages }) => ({ name: item.file.name, bytes: new Uint8Array(await item.file.arrayBuffer()), pages, rotation: item.rotation }))
      );
      const response = await worker.run({ kind: 'merge', sources, options: target.options }, { transfer: sources.map((source) => source.bytes.buffer) });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'merge') throw new Error('Unexpected response from the merge worker.');
      if (!response.ok) {
        replaceResult(null);
        setMergeError(response.error);
        setStatus('error');
        return;
      }
      const { bytes, report } = response.output;
      replaceResult({ url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })), bytes: bytes.length, report });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      replaceResult(null);
      setMergeError(
        thrown instanceof Error && thrown.message
          ? `Merging failed: ${thrown.message}`
          : 'Merging failed unexpectedly. Try reloading the page, or merging fewer files at once.'
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
    const timer = window.setTimeout(() => setSettledKey(planKey), planKey ? RERUN_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [planKey]);

  useEffect(() => {
    if (!settledKey) {
      latestRequestRef.current += 1; // Anything in flight belongs to a plan that no longer exists.
      queuedRef.current = null;
      replaceResult(null);
      setMergeError(null);
      setStatus('idle');
      return;
    }
    if (planRef.current) void run(planRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey]);

  const updateItem = (id: number, patch: Partial<MergeItem>) => setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const inspect = async (item: MergeItem): Promise<void> => {
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const response = await worker.run({ kind: 'inspect', bytes }, { transfer: [bytes.buffer] });
      if (response.kind !== 'inspect') throw new Error('Unexpected response from the merge worker.');
      updateItem(item.id, response.ok ? { status: 'ready', info: response.info } : { status: 'error', error: response.error });
    } catch (thrown: unknown) {
      updateItem(item.id, { status: 'error', error: `This file couldn’t be read${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}` });
    }
  };

  const addFiles = (files: File[], existing: { count: number; bytes: number } = { count: items.length, bytes: totalBytes }) => {
    const problems: string[] = [];
    const valid: File[] = [];
    for (const file of files) {
      const validation = validatePdfFile(file);
      if (validation.ok) valid.push(file);
      else problems.push(validation.error);
    }
    const room = batchRoom(existing, valid.map((file) => file.size));
    if (room.error) problems.push(room.error);
    setAddError(problems.length > 0 ? problems.join(' ') : null);

    const added: MergeItem[] = valid.slice(0, room.accepted).map((file) => ({ id: nextItemId++, file, status: 'reading', info: null, error: null, range: '', rotation: 0 }));
    if (added.length === 0) return;
    setItems((prev) => [...prev, ...added]);
    setAnnouncement(`Added ${plural(added.length, 'file')}.`);
    for (const item of added) void inspect(item);
  };

  const moveTo = (id: number, to: number, focus?: 'up' | 'down') => {
    const from = items.findIndex((item) => item.id === id);
    const moving = items[from];
    if (!moving || to < 0 || to >= items.length || from === to) return;
    if (focus) reorder.restoreFocusAfterMove(id, focus);
    setItems(moveItem(items, from, to));
    setAnnouncement(`Moved ${moving.file.name} to position ${to + 1} of ${items.length}.`);
  };

  const remove = (item: MergeItem) => {
    setItems((prev) => prev.filter((candidate) => candidate.id !== item.id));
    setAnnouncement(`Removed ${item.file.name}.`);
  };

  const reorderAll = (next: MergeItem[], message: string) => {
    setItems(next);
    setAnnouncement(message);
  };

  const clearAll = () => {
    setItems([]);
    setOptions(DEFAULT_MERGE_OPTIONS);
    setOutputName(DEFAULT_OUTPUT_NAME);
    setAddError(null);
    setAnnouncement('Cleared all files.');
  };

  const loadExample = async () => {
    setLoadingExample(true);
    try {
      const response = await worker.run({ kind: 'samples' });
      if (response.kind !== 'samples') throw new Error('Unexpected response from the merge worker.');
      clearAll();
      addFiles(
        response.files.map(({ name, bytes }) => new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' })),
        { count: 0, bytes: 0 }
      );
    } catch (thrown: unknown) {
      setAddError(`Couldn’t generate the example PDFs${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
    } finally {
      setLoadingExample(false);
    }
  };

  const reorder = useReorderableList({ items, onMove: (id, to) => moveTo(id, to), onFilesDropped: (files) => addFiles(files), dragLabel: fileNameOf });
  const { draggingId, dropTarget } = reorder;

  // ------------------------------------------------------------------ render

  const report = result?.report;
  const downloadName = normalizeOutputName(outputName);
  const nothingToClear = items.length === 0 && !addError && sameOptions(options, DEFAULT_MERGE_OPTIONS) && outputName === DEFAULT_OUTPUT_NAME;
  const updateOption = (patch: Partial<PdfMergeOptions>) => setOptions((prev) => ({ ...prev, ...patch }));

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Add three sample PDFs (with bookmarks, a link and a form field) to try the tool with">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={nothingToClear} title="Remove every file and reset all options">
          Clear
        </button>
      </div>

      <MultiFileDropzone
        onFilesSelected={(files) => addFiles(files)}
        roomRemaining={Math.max(0, MAX_MERGE_FILES - items.length)}
        maxFiles={MAX_MERGE_FILES}
        chooseLabel="Choose PDFs to merge"
        accept="application/pdf,.pdf"
        noun="PDFs"
      />

      <ErrorMessage message={addError} />

      {items.length > 0 && (
        <section class="mergepdf-files" aria-label="Files to merge">
          <div class="mergepdf-files__bar">
            <span class="field__label">Merge order ({plural(items.length, 'file')})</span>
            <span class="field__hint mergepdf-files__tip">Drag ⠿ or use the arrows to reorder</span>
            <span class="tool-bar__spacer" />
            <button type="button" class="btn" disabled={items.length < 2} onClick={() => reorderAll(sortByName(items, fileNameOf), 'Sorted files by name, A to Z.')} title="Sort by file name, A to Z — numbers in natural order, so 2 comes before 10">
              Sort A–Z
            </button>
            <button type="button" class="btn" disabled={items.length < 2} onClick={() => reorderAll(sortByName(items, fileNameOf, 'desc'), 'Sorted files by name, Z to A.')} title="Sort by file name, Z to A">
              Sort Z–A
            </button>
            <button type="button" class="btn" disabled={items.length < 2} onClick={() => reorderAll([...items].reverse(), 'Reversed the file order.')} title="Reverse the current order">
              Reverse
            </button>
          </div>

          <ol class="mergepdf-list" ref={reorder.listRef} onDragLeave={reorder.onListDragLeave}>
            {items.map((item, index) => {
              const selection = selections.get(item.id);
              const rangeId = `mergepdf-range-${item.id}`;
              const rangeHintId = `${rangeId}-hint`;
              const classes = [
                'mergepdf-row',
                item.status === 'error' && 'mergepdf-row--error',
                draggingId === item.id && 'mergepdf-row--dragging',
                dropTarget?.id === item.id && (dropTarget.after ? 'mergepdf-row--drop-after' : 'mergepdf-row--drop-before'),
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={item.id} class={classes} data-testid="merge-row" {...reorder.rowProps(item)}>
                  <span class="mergepdf-row__handle" aria-hidden="true" title="Drag to reorder" {...reorder.handleProps(item)}>
                    ⠿
                  </span>
                  <span class="mergepdf-row__index" aria-hidden="true">
                    {index + 1}
                  </span>

                  <div class="mergepdf-row__main">
                    <p class="mergepdf-row__name" title={item.file.name}>
                      {item.file.name}
                    </p>
                    <p class="mergepdf-row__meta">
                      {item.status === 'reading' && (
                        <>
                          <span class="job__spinner" aria-hidden="true" /> Reading… · {formatBytes(item.file.size)}
                        </>
                      )}
                      {item.status === 'ready' && item.info && (
                        <>
                          <span>
                            {plural(item.info.pageCount, 'page')} · {formatBytes(item.file.size)}
                          </span>
                          {item.info.bookmarkCount > 0 && (
                            <span class="mergepdf-tag" title="This file's own bookmarks are carried into the merged PDF (see Merge options)">
                              {plural(item.info.bookmarkCount, 'bookmark')}
                            </span>
                          )}
                          {item.info.formFieldCount > 0 && (
                            <span class="mergepdf-tag" title="Form fields stay fillable in the merged PDF">
                              {plural(item.info.formFieldCount, 'form field')}
                            </span>
                          )}
                          {item.info.signed && (
                            <span class="mergepdf-tag mergepdf-tag--warning" title="A digital signature covers the exact bytes of the original file, so it can't remain valid inside a merged document">
                              Signed — signature won’t carry over
                            </span>
                          )}
                        </>
                      )}
                      {item.status === 'error' && <span class="mergepdf-row__error">Can’t be merged: {item.error}</span>}
                    </p>
                  </div>

                  {item.status === 'ready' && item.info && (
                    <div class="mergepdf-row__pages">
                      <label class="field__hint" for={rangeId}>
                        Pages
                      </label>
                      <input
                        id={rangeId}
                        class="input mergepdf-row__range"
                        type="text"
                        inputMode="text"
                        spellcheck={false}
                        autocomplete="off"
                        placeholder="All"
                        value={item.range}
                        aria-label={`Pages to include from ${item.file.name}`}
                        aria-invalid={selection?.ok === false}
                        aria-describedby={rangeHintId}
                        title="Which pages to include, in order: e.g. 1-3, 5, 8- (8 to the end), 5-1 (reversed), odd or even. Leave empty for all pages."
                        onInput={(event) => updateItem(item.id, { range: (event.target as HTMLInputElement).value })}
                      />
                      <span id={rangeHintId} class={`field__hint${selection?.ok === false ? ' mergepdf-row__error' : ''}`}>
                        {selection ? (selection.ok ? describeSelection(selection.value, item.info.pageCount) : selection.error) : ''}
                      </span>
                    </div>
                  )}

                  <div class="mergepdf-row__actions">
                    {item.status === 'ready' && (
                      <button
                        type="button"
                        class={`btn mergepdf-icon mergepdf-icon--rotate${item.rotation ? ' mergepdf-icon--active' : ''}`}
                        onClick={() => {
                          const rotation = nextRotation(item.rotation);
                          updateItem(item.id, { rotation });
                          setAnnouncement(`${item.file.name} rotated ${rotation}°.`);
                        }}
                        aria-label={`Rotate pages of ${item.file.name} — currently ${item.rotation}°`}
                        title="Rotate this file's pages 90° clockwise (click again for 180°, 270°, then back to 0°)"
                      >
                        ↻{item.rotation ? ` ${item.rotation}°` : ''}
                      </button>
                    )}
                    <button type="button" class="btn mergepdf-icon" data-move={`${item.id}-up`} disabled={index === 0} onClick={() => moveTo(item.id, index - 1, 'up')} aria-label={`Move ${item.file.name} up`} title="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      class="btn mergepdf-icon"
                      data-move={`${item.id}-down`}
                      disabled={index === items.length - 1}
                      onClick={() => moveTo(item.id, index + 1, 'down')}
                      aria-label={`Move ${item.file.name} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button type="button" class="btn mergepdf-icon" onClick={() => remove(item)} aria-label={`Remove ${item.file.name}`} title="Remove from the merge">
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          {unreadableCount > 0 && <p class="field__hint">Files that can’t be read are left out of the merge — remove them, or replace them with a working copy.</p>}
          {readyItems.length === 1 && readingCount === 0 && (
            <p class="field__hint">Add another PDF to merge — with a single file you can still pick, reorder, repeat or rotate its pages.</p>
          )}

          <fieldset class="mergepdf-options">
            <legend class="field__label">Merge options</legend>
            <div class="mergepdf-options__checks">
              <label class="checkbox" title="Adds a top-level bookmark for each file, named after it, so the merged PDF is easy to navigate">
                <input type="checkbox" checked={options.fileBookmarks} onChange={(event) => updateOption({ fileBookmarks: (event.target as HTMLInputElement).checked })} />
                <span>Add a bookmark for each file</span>
              </label>
              <label class="checkbox" title="Carries each file's own bookmarks across, pointing at the right merged pages. Bookmarks for pages you left out are dropped.">
                <input type="checkbox" checked={options.keepBookmarks} onChange={(event) => updateOption({ keepBookmarks: (event.target as HTMLInputElement).checked })} />
                <span>Keep each file’s own bookmarks</span>
              </label>
              <label class="checkbox" title="For double-sided printing: after any file with an odd number of pages, adds a blank page so the next file starts on a new sheet">
                <input type="checkbox" checked={options.blankPageAfterOdd} onChange={(event) => updateOption({ blankPageAfterOdd: (event.target as HTMLInputElement).checked })} />
                <span>Blank page after odd-length files (double-sided printing)</span>
              </label>
            </div>
            <label class="mergepdf-options__field">
              <span class="field__hint">Document title (optional)</span>
              <input
                class="input"
                type="text"
                value={options.title}
                maxLength={300}
                placeholder="e.g. Q3 board pack"
                title="Saved in the PDF's metadata and shown in the viewer's title bar instead of the file name"
                onInput={(event) => updateOption({ title: (event.target as HTMLInputElement).value })}
              />
            </label>
          </fieldset>
        </section>
      )}

      <ErrorMessage message={mergeError} />

      {(readingCount > 0 || status === 'merging' || (invalidRange && readyItems.length > 0)) && (
        <p class="field__hint mergepdf-status" role="status">
          {readingCount > 0 ? (
            <>
              <span class="job__spinner" aria-hidden="true" /> Reading {plural(readingCount, 'file')}…
            </>
          ) : invalidRange ? (
            'Fix the highlighted page range to update the merged PDF.'
          ) : (
            <>
              <span class="job__spinner" aria-hidden="true" /> {result ? 'Updating the merged PDF…' : 'Merging…'}
            </>
          )}
        </p>
      )}

      {result && report && (
        <div class="mergepdf-result" data-testid="merge-result">
          <div class="mergepdf-summary">
            <p class="mergepdf-summary__headline">
              <strong>{plural(report.pageCount, 'page')}</strong> from {plural(report.fileCount, 'file')} · {formatBytes(result.bytes)}
            </p>
            <span class="tool-bar__spacer" />
            <label class="mergepdf-summary__name">
              <span class="sr-only">File name for the merged PDF</span>
              <input class="input" type="text" value={outputName} spellcheck={false} onInput={(event) => setOutputName((event.target as HTMLInputElement).value)} title="Name of the downloaded file — .pdf is added if you leave it off" />
            </label>
            <button type="button" class="btn btn--primary" onClick={() => downloadUrl(result.url, downloadName)} title={`Save as ${downloadName}`}>
              <span aria-hidden="true">⭳</span> Download merged PDF
            </button>
          </div>

          <ul class="mergepdf-stats">
            {(report.bookmarkCount > 0 || report.formFieldCount > 0 || report.blankPagesAdded > 0) && (
              <li>
                {[
                  report.bookmarkCount > 0 && plural(report.bookmarkCount, 'bookmark'),
                  report.formFieldCount > 0 && `${plural(report.formFieldCount, 'form field')} kept fillable`,
                  report.blankPagesAdded > 0 && `${plural(report.blankPagesAdded, 'blank page')} added`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            )}
            {report.renamedFields > 0 && (
              <li>
                {plural(report.renamedFields, 'form field')} renamed (e.g. “name” → “name_2”) because another file used the same name — otherwise filling one would fill both.
              </li>
            )}
            {report.linksRemoved > 0 && <li>{plural(report.linksRemoved, 'internal link')} removed because the page it pointed to was left out.</li>}
          </ul>
          {report.signedFiles > 0 && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>
                {report.signedFiles === 1 ? 'One file was' : `${report.signedFiles} files were`} digitally signed. A signature only covers the exact original file, so it
                won’t show as valid in the merged PDF — keep the signed original as well.
              </span>
            </p>
          )}

          <PdfPreview url={result.url} heading="Merged preview" frameTitle="Merged PDF preview" />
        </div>
      )}

      <p class="sr-only" aria-live="polite">
        {announcement}
      </p>

      <style>{`
        .mergepdf-files { display: flex; flex-direction: column; gap: var(--space-3); }
        .mergepdf-files__bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .mergepdf-files .field__hint, .mergepdf-status { margin: 0; }
        .mergepdf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .mergepdf-row {
          display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto;
          grid-template-areas: 'handle index main pages actions';
          align-items: center; gap: var(--space-2) var(--space-3);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
          transition: box-shadow 0.12s ease, opacity 0.12s ease;
        }
        .mergepdf-row--error { border-color: var(--danger-border); }
        .mergepdf-row--dragging { opacity: 0.45; }
        .mergepdf-row--drop-before { box-shadow: 0 -3px 0 var(--accent); }
        .mergepdf-row--drop-after { box-shadow: 0 3px 0 var(--accent); }
        .mergepdf-row__handle {
          grid-area: handle; cursor: grab; color: var(--text-subtle); font-size: var(--text-lg);
          line-height: 1; padding: var(--space-1); user-select: none; border-radius: var(--radius-sm);
        }
        .mergepdf-row__handle:hover { color: var(--text); background: var(--surface-2); }
        .mergepdf-row__handle:active { cursor: grabbing; }
        .mergepdf-row__index {
          grid-area: index; min-width: 1.5rem; text-align: right;
          font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); font-variant-numeric: tabular-nums;
        }
        .mergepdf-row__main { grid-area: main; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
        .mergepdf-row__name {
          margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mergepdf-row__meta {
          margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2);
          font-size: var(--text-xs); color: var(--text-muted);
        }
        .mergepdf-row__error { color: var(--danger); }
        .mergepdf-tag {
          padding: 0 0.4rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap;
        }
        .mergepdf-tag--warning { color: var(--warning); border-color: var(--warning-border); background: var(--warning-subtle); }
        .mergepdf-row__pages { grid-area: pages; width: 12rem; display: flex; flex-direction: column; gap: 0.15rem; }
        .mergepdf-row__pages .field__hint { margin: 0; }
        .mergepdf-row__range { padding: 0.3rem 0.55rem; }
        .mergepdf-row__actions { grid-area: actions; display: flex; gap: var(--space-1); }
        .mergepdf-icon { padding: 0.4rem 0.55rem; min-width: 2.25rem; }
        /* Fixed width whether it reads "↻" or "↻ 270°", so the Pages column lines up across rows. */
        .mergepdf-icon--rotate { width: 4.25rem; }
        .mergepdf-icon--active { border-color: var(--accent); color: var(--accent); }
        .mergepdf-options {
          margin: 0; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .mergepdf-options legend { padding: 0 var(--space-1); min-height: 0; }
        .mergepdf-options__checks { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
        .mergepdf-options__field { display: flex; flex-direction: column; gap: var(--space-1); max-width: 28rem; }
        .mergepdf-result { padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .mergepdf-summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .mergepdf-summary__headline { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
        .mergepdf-summary__headline strong { color: var(--text); font-size: var(--text-lg); }
        .mergepdf-summary__name { width: 14rem; max-width: 100%; }
        .mergepdf-stats { margin: 0; padding-left: var(--space-5); color: var(--text-muted); font-size: var(--text-sm); }
        .mergepdf-stats:empty { display: none; }
        .mergepdf-stats li + li { margin-top: var(--space-1); }
        .mergepdf-result .pdf-preview { margin-top: 0; }
        @media (max-width: 44rem) {
          .mergepdf-row {
            grid-template-columns: auto minmax(0, 1fr);
            grid-template-areas: 'index main' 'pages pages' 'actions actions';
          }
          /* Touch browsers don't support HTML drag and drop — the arrow buttons cover it. */
          .mergepdf-row__handle { display: none; }
          .mergepdf-row__pages { width: auto; }
          .mergepdf-row__actions { justify-content: flex-end; }
          .mergepdf-files__tip { display: none; }
          .mergepdf-summary__name { width: 100%; }
        }
      `}</style>
    </div>
  );
}
