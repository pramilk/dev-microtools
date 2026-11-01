import { useEffect, useRef, useState } from 'preact/hooks';
import { validatePdfFile } from '../lib/tools/pdfFile';
import {
  BOOKMARK_LEVELS,
  DEFAULT_SPLIT_SETTINGS,
  SAMPLE_FILE_NAME,
  SAMPLE_RANGES,
  SPLIT_MODES,
  SPLIT_MODE_HINTS,
  SPLIT_MODE_LABELS,
  SIZE_UNITS,
  convertSizeInput,
  defaultRangesFor,
  describePages,
  partBase,
  planSplit,
  plural,
  zipNameFor,
  pageRun,
  updatePicked,
  type BookmarkLevel,
  type PdfSplitSettings,
  type PdfSplitSourceInfo,
  type SplitPlan,
} from '../lib/tools/pdfSplit';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { PdfPreview } from './shared/PdfPreview';
import { downloadUrl } from './shared/downloadUrl';
import { downloadZip } from './shared/downloadZip';
import { useWorkerTask } from './shared/useWorkerTask';
import { usePdfThumbnails } from './shared/usePdfThumbnails';
import { PdfPageThumb } from './shared/PdfPageThumb';
import PdfSplitWorker from '../workers/pdfSplit.worker?worker';
import type { PdfSplitWorkerRequest, PdfSplitWorkerResult } from '../workers/pdfSplit.worker';

// Deliberately no ShareLinkButton — the input is a PDF from the visitor's own disk, which
// can't (and shouldn't) travel in a URL, and the ranges are meaningless without it. Same
// reasoning as Merge PDF, PDF Compressor and the image tools.

/** Edits (typing a range, changing a setting) wait this long before the split re-runs, so
 *  typing "1-12" doesn't split three times on the way. */
const RERUN_DEBOUNCE_MS = 350;

const LEVEL_LABELS: Record<BookmarkLevel, string> = {
  1: 'Top-level bookmarks (chapters)',
  2: 'Down to level 2 (sections)',
  3: 'Down to level 3 (sub-sections)',
};

interface PartResult {
  name: string;
  label: string;
  pages: number[];
  pageCount: number;
  bookmarkCount: number;
  formFieldCount: number;
  linksRemoved: number;
  overLimit: boolean;
  blob: Blob;
  url: string;
}

interface SplitResult {
  parts: PartResult[];
  signed: boolean;
  totalBytes: number;
}

interface RunTarget {
  file: File;
  plan: SplitPlan;
  keepBookmarks: boolean;
}

type Status = 'idle' | 'splitting' | 'done' | 'error';

const sameSettings = (a: PdfSplitSettings, b: PdfSplitSettings): boolean => (Object.keys(a) as (keyof PdfSplitSettings)[]).every((key) => a[key] === b[key]);

export default function SplitPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState(0);
  const [info, setInfo] = useState<PdfSplitSourceInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PdfSplitSettings>(DEFAULT_SPLIT_SETTINGS);
  const [status, setStatus] = useState<Status>('idle');
  const [splitError, setSplitError] = useState<string | null>(null);
  const [result, setResult] = useState<SplitResult | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [loadingExample, setLoadingExample] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [settledKey, setSettledKey] = useState('');

  const worker = useWorkerTask<PdfSplitWorkerRequest, PdfSplitWorkerResult>(() => new PdfSplitWorker());
  /** Set once "Pick pages" has been opened for the current file, so switching modes and back
   *  doesn't throw the drawn thumbnails away. */
  const [pickOpened, setPickOpened] = useState(false);
  const pickAnchorRef = useRef<number | null>(null);
  // pdf.js only loads once "Pick pages" is opened, and only for a file pdf-lib could read.
  const thumbnails = usePdfThumbnails(info && (pickOpened || settings.mode === 'pick') ? file : null);
  const resultRef = useRef<SplitResult | null>(null);
  /** Latest-wins coalescing, as in Merge PDF: at most one split in flight plus one queued. */
  const inFlightRef = useRef(false);
  const queuedRef = useRef<RunTarget | null>(null);
  const latestRequestRef = useRef(0);
  const latestInspectRef = useRef(0);
  const targetRef = useRef<RunTarget | null>(null);

  const replaceResult = (next: SplitResult | null) => {
    if (resultRef.current) for (const part of resultRef.current.parts) URL.revokeObjectURL(part.url);
    resultRef.current = next;
    setResult(next);
  };

  useEffect(
    () => () => {
      if (resultRef.current) for (const part of resultRef.current.parts) URL.revokeObjectURL(part.url);
    },
    []
  );

  const plan = file && info ? planSplit(settings, info, file.name) : null;
  const target: RunTarget | null = file && plan?.ok ? { file, plan: plan.value, keepBookmarks: settings.keepBookmarks } : null;
  const targetKey = target ? JSON.stringify([fileId, target.plan, target.keepBookmarks]) : '';
  targetRef.current = target;

  const run = async (next: RunTarget): Promise<void> => {
    if (inFlightRef.current) {
      queuedRef.current = next;
      return;
    }
    inFlightRef.current = true;
    const requestId = (latestRequestRef.current += 1);
    setStatus('splitting');
    setSplitError(null);

    try {
      const bytes = new Uint8Array(await next.file.arrayBuffer());
      const response = await worker.run({ kind: 'split', bytes, plan: next.plan, options: { keepBookmarks: next.keepBookmarks } }, { transfer: [bytes.buffer] });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'split') throw new Error('Unexpected response from the split worker.');
      if (!response.ok) {
        replaceResult(null);
        setSplitError(response.error);
        setStatus('error');
        return;
      }
      const labels = next.plan.kind === 'parts' ? next.plan.parts.map((part) => part.label) : [];
      const parts = response.output.parts.map(({ bytes: partBytes, ...part }, index) => {
        const blob = new Blob([partBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
        return { ...part, label: labels[index] ?? describePages(part.pages), blob, url: URL.createObjectURL(blob) };
      });
      replaceResult({ parts, signed: response.output.signed, totalBytes: parts.reduce((sum, part) => sum + part.blob.size, 0) });
      setPreviewIndex((index) => (index < parts.length ? index : 0));
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      replaceResult(null);
      setSplitError(
        thrown instanceof Error && thrown.message ? `Splitting failed: ${thrown.message}` : 'Splitting failed unexpectedly. Try reloading the page, or splitting into fewer parts.'
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
    const timer = window.setTimeout(() => setSettledKey(targetKey), targetKey ? RERUN_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [targetKey]);

  useEffect(() => {
    if (!settledKey) {
      latestRequestRef.current += 1; // Anything in flight belongs to a plan that no longer exists.
      queuedRef.current = null;
      replaceResult(null);
      setSplitError(null);
      setStatus('idle');
      return;
    }
    if (targetRef.current) void run(targetRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey]);

  const selectFile = async (next: File | null, ranges?: string): Promise<void> => {
    const inspectId = (latestInspectRef.current += 1);
    setInfo(null);
    setFileError(null);
    setPreviewIndex(0);
    setReading(false);
    if (!next) {
      setFile(null);
      return;
    }
    const validation = validatePdfFile(next);
    if (!validation.ok) {
      setFile(null);
      setFileError(validation.error);
      return;
    }
    setFile(next);
    setFileId((id) => id + 1);
    setPickOpened(false);
    pickAnchorRef.current = null;
    setReading(true);
    try {
      const bytes = new Uint8Array(await next.arrayBuffer());
      const response = await worker.run({ kind: 'inspect', bytes }, { transfer: [bytes.buffer] });
      if (inspectId !== latestInspectRef.current) return;
      if (response.kind !== 'inspect') throw new Error('Unexpected response from the split worker.');
      if (!response.ok) {
        setFileError(response.error);
        return;
      }
      const { pageCount, bookmarks } = response.info;
      setInfo(response.info);
      // A new file gets ranges that fit it — whatever was typed for the last one probably doesn't.
      setSettings((prev) => ({
        ...prev,
        ranges: ranges ?? defaultRangesFor(pageCount),
        pickedPages: [],
        mode: prev.mode === 'bookmarks' && bookmarks.length === 0 ? 'ranges' : prev.mode,
      }));
      setAnnouncement(`Loaded ${next.name}: ${plural(pageCount, 'page')}.`);
    } catch (thrown: unknown) {
      if (inspectId !== latestInspectRef.current) return;
      setFileError(`This file couldn’t be read${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
    } finally {
      if (inspectId === latestInspectRef.current) setReading(false);
    }
  };

  const update = (patch: Partial<PdfSplitSettings>) => setSettings((prev) => ({ ...prev, ...patch }));

  const clearAll = () => {
    void selectFile(null);
    setSettings(DEFAULT_SPLIT_SETTINGS);
    setAnnouncement('Cleared the PDF and settings.');
  };

  const loadExample = async () => {
    setLoadingExample(true);
    try {
      const response = await worker.run({ kind: 'sample' });
      if (response.kind !== 'sample') throw new Error('Unexpected response from the split worker.');
      setSettings({ ...DEFAULT_SPLIT_SETTINGS, mode: 'ranges' });
      await selectFile(new File([response.bytes as Uint8Array<ArrayBuffer>], SAMPLE_FILE_NAME, { type: 'application/pdf' }), SAMPLE_RANGES);
    } catch (thrown: unknown) {
      setFileError(`Couldn’t generate the example PDF${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
    } finally {
      setLoadingExample(false);
    }
  };

  const downloadAll = async () => {
    if (!result || !file) return;
    setZipping(true);
    try {
      await downloadZip(
        result.parts.map((part) => ({ name: part.name, blob: part.blob })),
        zipNameFor(settings.prefix.trim() || file.name)
      );
    } catch (thrown: unknown) {
      setSplitError(`Couldn’t build the ZIP file${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'} Download the files one at a time instead.`);
    } finally {
      setZipping(false);
    }
  };

  // ------------------------------------------------------------------ render

  const planError = plan && !plan.ok ? plan.error : null;
  const plannedParts = plan?.ok && plan.value.kind === 'parts' ? plan.value.parts : null;
  const pageCount = info?.pageCount ?? 0;
  const pickedSet = new Set(settings.pickedPages);
  /** Clicking a page picks or unpicks it; Shift-click does the same to every page back to the
   *  last one clicked. Handled on the whole card (the checkbox's own click bubbles here), with
   *  the label's default toggle cancelled so the state changes exactly once. */
  const clickPage = (event: MouseEvent, page: number) => {
    event.preventDefault();
    const pick = !pickedSet.has(page);
    const pages = event.shiftKey ? pageRun(pickAnchorRef.current, page) : [page];
    pickAnchorRef.current = page;
    update({ pickedPages: updatePicked(settings.pickedPages, pages, pick) });
    setAnnouncement(pages.length > 1 ? `${pick ? 'Picked' : 'Unpicked'} pages ${(pages[0] ?? page) + 1}–${page + 1}.` : `Page ${page + 1} ${pick ? 'picked' : 'unpicked'}.`);
  };
  const nothingToClear = !file && !fileError && sameSettings(settings, DEFAULT_SPLIT_SETTINGS);
  const preview = result?.parts[previewIndex] ?? result?.parts[0];
  const hasBookmarks = (info?.bookmarks.length ?? 0) > 0;
  const fieldHint = (fallback: string) => (
    <span id="splitpdf-field-hint" class={`field__hint${planError ? ' splitpdf__error' : ''}`}>
      {planError ?? fallback}
    </span>
  );
  const plannedSummary = plannedParts
    ? plannedParts.length === 1
      ? `1 file: ${plannedParts[0]?.label ?? ''}`
      : `${plural(plannedParts.length, 'file')}: ${plannedParts
          .slice(0, 4)
          .map((part) => part.label)
          .join(' · ')}${plannedParts.length > 4 ? ' · …' : ''}`
    : '';

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Open a sample 6-page handbook with bookmarks, links and a form field to try the tool with">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={nothingToClear} title="Remove the PDF and reset every setting">
          Clear
        </button>
      </div>

      <FileDropzone
        file={file}
        onFileSelected={(next) => void selectFile(next)}
        chooseLabel="Choose a PDF to split"
        accept="application/pdf,.pdf"
        describeFile={(chosen) =>
          info
            ? [plural(info.pageCount, 'page'), formatBytes(chosen.size), info.bookmarkCount > 0 && plural(info.bookmarkCount, 'bookmark')].filter(Boolean).join(' · ')
            : formatBytes(chosen.size)
        }
      />

      <ErrorMessage message={fileError} />

      {reading && (
        <p class="field__hint splitpdf__status" role="status">
          <span class="job__spinner" aria-hidden="true" /> Reading the PDF…
        </p>
      )}

      {file && info && (
        <fieldset class="splitpdf-options">
          <legend class="field__label">How to split</legend>
          <div class="seg" role="group" aria-label="Split mode">
            {SPLIT_MODES.map((mode) => {
              const unavailable = mode === 'bookmarks' && !hasBookmarks;
              return (
                <button
                  key={mode}
                  type="button"
                  class="seg__btn"
                  aria-pressed={settings.mode === mode}
                  disabled={unavailable}
                  onClick={() => {
                    update({ mode });
                    if (mode === 'pick') setPickOpened(true);
                  }}
                  title={unavailable ? 'This PDF has no bookmarks to split at' : SPLIT_MODE_HINTS[mode]}
                >
                  {SPLIT_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>

          {settings.mode === 'ranges' && (
            <div class="splitpdf-field">
              <label class="field__label" for="splitpdf-ranges">
                Page ranges — one file each
              </label>
              <input
                id="splitpdf-ranges"
                class="input splitpdf-field__input"
                type="text"
                spellcheck={false}
                autocomplete="off"
                placeholder="e.g. 1-3, 4-8, 9-"
                value={settings.ranges}
                aria-invalid={planError !== null}
                aria-describedby="splitpdf-field-hint splitpdf-ranges-help"
                title="Commas separate files. 8- runs to the end, 5-1 reverses, odd/even pick alternate pages, and + joins pieces into one file (1-2+5)."
                onInput={(event) => update({ ranges: (event.target as HTMLInputElement).value })}
              />
              {fieldHint(plannedSummary)}
              <span id="splitpdf-ranges-help" class="field__hint">
                Commas separate files · <code>8-</code> to the end · <code>5-1</code> reversed · <code>odd</code>, <code>even</code> · <code>1-2+5</code> joins pages into one file
              </span>
              <label class="checkbox" title="Puts every range above into a single PDF instead of one file per range — for pulling a few pages out of a long document">
                <input type="checkbox" checked={settings.combine} onChange={(event) => update({ combine: (event.target as HTMLInputElement).checked })} />
                <span>Save all ranges as one PDF (extract pages)</span>
              </label>
            </div>
          )}

          {settings.mode === 'pick' && (
            <div class="splitpdf-field">
              <div class="splitpdf-pick__bar">
                <span id="splitpdf-field-hint" class="field__hint" role="status">
                  {settings.pickedPages.length === 0
                    ? 'Click the pages you want — Shift-click picks a run of pages.'
                    : `${settings.pickedPages.length} of ${plural(pageCount, 'page')} picked${plannedSummary ? ` → ${plannedSummary}` : ''}`}
                </span>
                <span class="tool-bar__spacer" />
                <button
                  type="button"
                  class="btn"
                  disabled={settings.pickedPages.length === pageCount}
                  onClick={() => update({ pickedPages: Array.from({ length: pageCount }, (_, page) => page) })}
                  title="Pick every page"
                >
                  Select all
                </button>
                <button type="button" class="btn" disabled={settings.pickedPages.length === 0} onClick={() => update({ pickedPages: [] })} title="Unpick every page">
                  Select none
                </button>
              </div>
              {thumbnails.unavailable && (
                <p class="field__hint">Page previews can’t be drawn for this PDF ({thumbnails.unavailable}) — you can still pick pages by number.</p>
              )}
              <ol class="splitpdf-pick__grid" key={fileId} aria-label="Pages — click to pick">
                {Array.from({ length: pageCount }, (_, page) => {
                  const picked = pickedSet.has(page);
                  return (
                    <li key={page}>
                      <label class="splitpdf-page" data-testid="split-page" onClick={(event) => clickPage(event, page)}>
                        <PdfPageThumb
                          pageNumber={page + 1}
                          src={thumbnails.thumbnailFor(page)}
                          failed={thumbnails.hasFailed(page)}
                          onVisible={() => thumbnails.request(page)}
                          selected={picked}
                        >
                          <span class="splitpdf-page__row">
                            <input type="checkbox" checked={picked} aria-label={`Pick page ${page + 1}`} />
                            <span aria-hidden="true">{page + 1}</span>
                          </span>
                        </PdfPageThumb>
                      </label>
                    </li>
                  );
                })}
              </ol>
              <label class="checkbox" title="Saves every picked page as a separate one-page PDF instead of putting them all in one file">
                <input type="checkbox" checked={settings.pickSeparate} onChange={(event) => update({ pickSeparate: (event.target as HTMLInputElement).checked })} />
                <span>Save each picked page as its own file</span>
              </label>
            </div>
          )}

          {settings.mode === 'every' && (
            <div class="splitpdf-field">
              <label class="field__label" for="splitpdf-every">
                Pages per file
              </label>
              <input
                id="splitpdf-every"
                class="input splitpdf-field__input splitpdf-field__input--short"
                type="text"
                inputMode="numeric"
                autocomplete="off"
                value={settings.everyN}
                aria-invalid={planError !== null}
                aria-describedby="splitpdf-field-hint"
                title="1 puts every page in its own file; 10 makes files of 10 pages, with whatever is left over in the last one"
                onInput={(event) => update({ everyN: (event.target as HTMLInputElement).value })}
              />
              {fieldHint(plannedParts ? `${plural(plannedParts.length, 'file')} of up to ${plural(Number(settings.everyN.trim()), 'page')}` : '')}
            </div>
          )}

          {settings.mode === 'bookmarks' && (
            <div class="splitpdf-field">
              <label class="field__label" for="splitpdf-level">
                Split at
              </label>
              <select
                id="splitpdf-level"
                class="select splitpdf-field__input"
                value={String(settings.bookmarkLevel)}
                aria-describedby="splitpdf-field-hint"
                title="Which bookmarks start a new file. Deeper levels make more, smaller files."
                onChange={(event) => update({ bookmarkLevel: Number((event.target as HTMLSelectElement).value) as BookmarkLevel })}
              >
                {BOOKMARK_LEVELS.map((level) => (
                  <option key={level} value={String(level)}>
                    {LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
              {fieldHint(plannedSummary)}
            </div>
          )}

          {settings.mode === 'size' && (
            <div class="splitpdf-field">
              <label class="field__label" for="splitpdf-size">
                Max size per file
              </label>
              <div class="splitpdf-size">
                <input
                  id="splitpdf-size"
                  class="input splitpdf-field__input splitpdf-field__input--short"
                  type="text"
                  inputMode="decimal"
                  autocomplete="off"
                  value={settings.maxSize}
                  aria-invalid={planError !== null}
                  aria-describedby="splitpdf-field-hint"
                  title="Pages stay in order and are packed into as few files as fit under this size — e.g. 10 or 20 MB for an email attachment limit"
                  onInput={(event) => update({ maxSize: (event.target as HTMLInputElement).value })}
                />
                <div class="seg" role="group" aria-label="Size unit">
                  {SIZE_UNITS.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      class="seg__btn"
                      aria-pressed={settings.maxSizeUnit === unit}
                      onClick={() => update({ maxSizeUnit: unit, maxSize: convertSizeInput(settings.maxSize, settings.maxSizeUnit, unit) })}
                      title={unit === 'KB' ? 'Kilobytes — 1 MB is 1024 KB. Switching converts the number, so the limit stays the same.' : 'Megabytes — switching converts the number, so the limit stays the same.'}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
              {fieldHint('Pages stay in order, packed into as few files as fit. A single page bigger than the limit gets a file of its own.')}
            </div>
          )}

          <div class="splitpdf-options__row">
            <label class="checkbox" title="Each file keeps the bookmarks that point at its own pages; bookmarks for pages in other files are left out">
              <input type="checkbox" checked={settings.keepBookmarks} onChange={(event) => update({ keepBookmarks: (event.target as HTMLInputElement).checked })} />
              <span>Keep bookmarks in each file</span>
            </label>
            <label class="splitpdf-options__prefix">
              <span class="field__hint">File names start with</span>
              <input
                class="input"
                type="text"
                spellcheck={false}
                maxLength={120}
                value={settings.prefix}
                placeholder={partBase(file.name)}
                title="The start of every downloaded file's name — the original file name if left empty"
                onInput={(event) => update({ prefix: (event.target as HTMLInputElement).value })}
              />
            </label>
          </div>
        </fieldset>
      )}

      <ErrorMessage message={splitError} />

      {status === 'splitting' && (
        <p class="field__hint splitpdf__status" role="status">
          <span class="job__spinner" aria-hidden="true" /> {result ? 'Updating the files…' : settings.mode === 'size' ? 'Measuring pages and splitting…' : 'Splitting…'}
        </p>
      )}

      {file && result && preview && (
        <div class="splitpdf-result" data-testid="split-result">
          <div class="splitpdf-summary">
            <p class="splitpdf-summary__headline">
              <strong>{plural(result.parts.length, 'file')}</strong> from {plural(info?.pageCount ?? 0, 'page')} · {formatBytes(result.totalBytes)} total
            </p>
            <span class="tool-bar__spacer" />
            {result.parts.length > 1 ? (
              <button type="button" class="btn btn--primary" onClick={() => void downloadAll()} disabled={zipping} title={`Save every file in one ZIP: ${zipNameFor(settings.prefix.trim() || file.name)}`}>
                <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : 'Download all (.zip)'}
              </button>
            ) : (
              <button type="button" class="btn btn--primary" onClick={() => downloadUrl(preview.url, preview.name)} title={`Save as ${preview.name}`}>
                <span aria-hidden="true">⭳</span> Download PDF
              </button>
            )}
          </div>

          <ol class="splitpdf-list">
            {result.parts.map((part, index) => (
              <li key={part.name} class={`splitpdf-row${index === previewIndex ? ' splitpdf-row--active' : ''}`} data-testid="split-part">
                <span class="splitpdf-row__index" aria-hidden="true">
                  {index + 1}
                </span>
                <div class="splitpdf-row__main">
                  <p class="splitpdf-row__name" title={part.name}>
                    {part.name}
                  </p>
                  <p class="splitpdf-row__meta">
                    <span>
                      {part.label} · {plural(part.pageCount, 'page')} · {formatBytes(part.blob.size)}
                    </span>
                    {part.bookmarkCount > 0 && <span class="splitpdf-tag">{plural(part.bookmarkCount, 'bookmark')}</span>}
                    {part.formFieldCount > 0 && (
                      <span class="splitpdf-tag" title="Form fields on these pages stay fillable">
                        {plural(part.formFieldCount, 'form field')}
                      </span>
                    )}
                    {part.linksRemoved > 0 && (
                      <span class="splitpdf-tag" title="Links that jumped to a page now in a different file were removed, rather than left pointing nowhere">
                        {plural(part.linksRemoved, 'link')} to other parts removed
                      </span>
                    )}
                    {part.overLimit && (
                      <span class="splitpdf-tag splitpdf-tag--warning" title="This single page is bigger than the size limit on its own, so it can't be split any further">
                        Over the size limit
                      </span>
                    )}
                  </p>
                </div>
                <div class="splitpdf-row__actions">
                  <button
                    type="button"
                    class="btn"
                    aria-pressed={index === previewIndex}
                    onClick={() => {
                      setPreviewIndex(index);
                      setAnnouncement(`Previewing ${part.name}.`);
                    }}
                    aria-label={`Preview ${part.name}`}
                    title="Show this file in the preview below"
                  >
                    Preview
                  </button>
                  <button type="button" class="btn" onClick={() => downloadUrl(part.url, part.name)} aria-label={`Download ${part.name}`} title={`Save as ${part.name}`}>
                    <span aria-hidden="true">⭳</span> Download
                  </button>
                </div>
              </li>
            ))}
          </ol>

          {result.signed && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>This PDF is digitally signed. A signature only covers the exact original file, so it won’t show as valid in any of the parts — keep the signed original as well.</span>
            </p>
          )}

          <PdfPreview url={preview.url} heading={`Preview — ${preview.name}`} frameTitle={`Preview of ${preview.name}`} />
        </div>
      )}

      <p class="sr-only" aria-live="polite">
        {announcement}
      </p>

      <style>{`
        .splitpdf__status { margin: 0; }
        .splitpdf__error { color: var(--danger); }
        .splitpdf-options {
          margin: 0; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .splitpdf-options legend { padding: 0 var(--space-1); min-height: 0; }
        .splitpdf-options .seg { flex-wrap: wrap; align-self: flex-start; }
        .splitpdf-field { display: flex; flex-direction: column; gap: var(--space-1); }
        .splitpdf-field .field__hint { margin: 0; }
        .splitpdf-field .checkbox { margin-top: var(--space-1); }
        .splitpdf-field__input { max-width: 32rem; font-family: var(--font-mono); }
        .splitpdf-field__input--short { max-width: 8rem; }
        .splitpdf-size { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .splitpdf-options__row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-2) var(--space-4); }
        .splitpdf-options__prefix { display: flex; flex-direction: column; gap: var(--space-1); width: 18rem; max-width: 100%; }
        .splitpdf-options__prefix .field__hint { margin: 0; }
        .splitpdf-pick__bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        /* A long document scrolls inside the grid, so the results stay close by. */
        .splitpdf-pick__grid {
          list-style: none; margin: 0; padding: var(--space-3); max-height: 30rem; overflow-y: auto;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .splitpdf-page { display: block; cursor: pointer; border-radius: var(--radius-sm); }
        .splitpdf-page:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
        .splitpdf-page__row { display: flex; align-items: center; gap: var(--space-1); font-family: var(--font-mono); color: var(--text); }
        .splitpdf-result { padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .splitpdf-summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .splitpdf-summary__headline { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
        .splitpdf-summary__headline strong { color: var(--text); font-size: var(--text-lg); }
        /* Long splits (a page per file) scroll inside the list rather than pushing the preview
           a long way down the page. */
        .splitpdf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); max-height: 26rem; overflow-y: auto; }
        .splitpdf-row {
          display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-2) var(--space-3);
          padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .splitpdf-row--active { border-color: var(--accent); }
        .splitpdf-row__index {
          min-width: 1.5rem; text-align: right; font-family: var(--font-mono); font-size: var(--text-xs);
          color: var(--text-subtle); font-variant-numeric: tabular-nums;
        }
        .splitpdf-row__main { min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
        .splitpdf-row__name {
          margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .splitpdf-row__meta { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); font-size: var(--text-xs); color: var(--text-muted); }
        .splitpdf-tag {
          padding: 0 0.4rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap;
        }
        .splitpdf-tag--warning { color: var(--warning); border-color: var(--warning-border); background: var(--warning-subtle); }
        .splitpdf-row__actions { display: flex; gap: var(--space-1); }
        .splitpdf-row__actions .btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
        .splitpdf-result .pdf-preview { margin-top: 0; }
        @media (max-width: 44rem) {
          .splitpdf-row { grid-template-columns: auto minmax(0, 1fr); }
          .splitpdf-row__actions { grid-column: 1 / -1; justify-content: flex-end; }
        }
      `}</style>
    </div>
  );
}
