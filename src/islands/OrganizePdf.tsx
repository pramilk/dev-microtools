import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { validatePdfFile } from '../lib/tools/pdfFile';
import { batchRoom, plural } from '../lib/tools/fileBatch';
import { PDF_PRESETS } from '../lib/tools/pdfCompress';
import type { PdfSourceInfo } from '../lib/tools/pdfMerge';
import { inkCoverage, looksBlank } from '../lib/tools/blankPage';
import {
  BACKGROUND_KINDS,
  COMPRESSION_CHOICES,
  DEFAULT_ORGANIZE_SETTINGS,
  IMAGE_FITS,
  NUMBER_FORMATS,
  ORGANIZE_FILE_LIMITS,
  SAMPLE_FILE_NAME,
  STAMP_POSITIONS,
  STAMP_POSITION_LABELS,
  STAMP_SIZES,
  WATERMARK_COLORS,
  WATERMARK_SIZES,
  backgroundImageFormat,
  canMoveSelection,
  collateDuplex,
  defaultOutputName,
  describeChanges,
  duplicatePages,
  formatPageNumber,
  initialPages,
  insertBlankPage,
  insertFilePages,
  isPristine,
  moveSelection,
  movePage,
  outputNameFor,
  planOrganize,
  pushHistory,
  redoHistory,
  removePages,
  reversePages,
  rotatePages,
  selectionRun,
  startHistory,
  undoHistory,
  type BackgroundKind,
  type BackgroundSettings,
  type CompressionChoice,
  type HeaderFooterSettings,
  type ImageFit,
  type NumberFormat,
  type OrganizePage,
  type OrganizePlan,
  type OrganizeReport,
  type OrganizeSettings,
  type PageNumberSettings,
  type StampPosition,
  type WatermarkColor,
  type WatermarkSettings,
  type WatermarkSize,
} from '../lib/tools/pdfOrganize';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { PdfPreview } from './shared/PdfPreview';
import { PdfPageThumb } from './shared/PdfPageThumb';
import { PdfPageViewer } from './shared/PdfPageViewer';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import { usePdfThumbnailSet } from './shared/usePdfThumbnails';
import { useReorderableList } from './shared/useReorderableList';
import PdfOrganizeWorker from '../workers/pdfOrganize.worker?worker';
import type { PdfOrganizeWorkerRequest, PdfOrganizeWorkerResult } from '../workers/pdfOrganize.worker';

// Deliberately no ShareLinkButton — the input is a PDF from the visitor's own disk, which
// can't (and shouldn't) travel in a URL, and the page edits are meaningless without it. Same
// reasoning as Merge PDF, Split PDF and the image tools.

/** Edits wait this long before the PDF is rewritten, so a burst of clicks rewrites it once. */
const REBUILD_DEBOUNCE_MS = 400;

const FORMAT_LABELS: Record<NumberFormat, string> = {
  n: formatPageNumber('n', 1, 12),
  'page-n': formatPageNumber('page-n', 1, 12),
  'n-of-total': formatPageNumber('n-of-total', 1, 12),
  'page-n-of-total': formatPageNumber('page-n-of-total', 1, 12),
};

const COMPRESSION_LABELS: Record<CompressionChoice, string> = { off: 'Off', light: PDF_PRESETS.light.label, balanced: PDF_PRESETS.balanced.label, strong: PDF_PRESETS.strong.label };
const COMPRESSION_HINTS: Record<CompressionChoice, string> = {
  off: 'Write the pages as they are — text and images untouched.',
  light: PDF_PRESETS.light.hint,
  balanced: PDF_PRESETS.balanced.hint,
  strong: PDF_PRESETS.strong.hint,
};

const BACKGROUND_LABELS: Record<BackgroundKind, string> = { none: 'None', color: 'Colour', image: 'Image' };
const FIT_LABELS: Record<ImageFit, string> = { cover: 'Fill page', contain: 'Fit inside', stretch: 'Stretch' };
const FIT_HINTS: Record<ImageFit, string> = {
  cover: 'Covers the whole page, trimming the image’s edges if its shape differs from the page’s',
  contain: 'Shows the whole image, leaving bands where its shape differs from the page’s',
  stretch: 'Covers the whole page exactly, distorting the image if its shape differs',
};
const SIZE_LABELS: Record<WatermarkSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const COLOR_LABELS: Record<WatermarkColor, string> = { gray: 'Grey', red: 'Red', blue: 'Blue' };

interface SourceFile {
  /** Stable identity, for the rebuild key. */
  id: number;
  file: File;
  info: PdfSourceInfo;
}

interface BuildResult {
  name: string;
  report: OrganizeReport;
  blob: Blob;
  url: string;
}

interface RunTarget {
  plan: OrganizePlan;
  sources: SourceFile[];
  backgroundImage: File | null;
  name: string;
}

type Status = 'idle' | 'building' | 'done' | 'error';

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type !== 'checkbox');

const errorText = (thrown: unknown): string => (thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.');

export default function OrganizePdf() {
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [reading, setReading] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [history, setHistory] = useState(() => startHistory<OrganizePage[]>([]));
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [settings, setSettings] = useState<OrganizeSettings>(DEFAULT_ORGANIZE_SETTINGS);
  const [backgroundImage, setBackgroundImage] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [buildError, setBuildError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [detecting, setDetecting] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [settledKey, setSettledKey] = useState('');
  /** The page (by id) open full size in the viewer, if any. */
  const [zoomedId, setZoomedId] = useState<number | null>(null);

  const worker = useWorkerTask<PdfOrganizeWorkerRequest, PdfOrganizeWorkerResult>(() => new PdfOrganizeWorker());
  const files = useMemo(() => sources.map((source) => source.file), [sources]);
  const thumbnails = usePdfThumbnailSet(files);
  const nextSourceIdRef = useRef(1);
  const anchorRef = useRef<number | null>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  /** Position whose checkbox should take focus once the grid re-renders (after a removal). */
  const pendingFocusRef = useRef<number | null>(null);
  const cancelDetectRef = useRef(false);
  const resultRef = useRef<BuildResult | null>(null);
  /** Latest-wins coalescing, as in Merge and Split PDF: at most one build in flight plus one queued. */
  const inFlightRef = useRef(false);
  const queuedRef = useRef<RunTarget | null>(null);
  const latestRequestRef = useRef(0);
  const latestInspectRef = useRef(0);
  const targetRef = useRef<RunTarget | null>(null);

  const pages = history.present;
  const main = sources[0] ?? null;
  const pageCount = main?.info.pageCount ?? 0;
  const liveSelected = useMemo(() => new Set(pages.filter((page) => selected.has(page.id)).map((page) => page.id)), [pages, selected]);

  const replaceResult = (next: BuildResult | null) => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = next;
    setResult(next);
  };

  useEffect(
    () => () => {
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
      cancelDetectRef.current = true;
    },
    []
  );

  useLayoutEffect(() => {
    const position = pendingFocusRef.current;
    if (position === null) return;
    pendingFocusRef.current = null;
    const cards = gridRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    if (!cards || cards.length === 0) return;
    cards[Math.min(position, cards.length - 1)]?.focus();
  }, [pages]);

  // ------------------------------------------------------------------ building

  const plan = main ? planOrganize(pages, settings, sources.map((source) => source.info.pageCount), backgroundImage) : null;
  const outputName = main ? outputNameFor(settings.fileName, main.file.name) : '';
  const target: RunTarget | null = main && plan?.ok ? { plan: plan.value, sources, backgroundImage, name: outputName } : null;
  const imageKey = backgroundImage ? [backgroundImage.name, backgroundImage.size, backgroundImage.lastModified] : null;
  const targetKey = target ? JSON.stringify([sources.map((source) => source.id), target.plan, target.plan.background?.kind === 'image' ? imageKey : null, outputName]) : '';
  targetRef.current = target;

  const run = async (next: RunTarget): Promise<void> => {
    if (inFlightRef.current) {
      queuedRef.current = next;
      return;
    }
    inFlightRef.current = true;
    const requestId = (latestRequestRef.current += 1);
    setStatus('building');
    setBuildError(null);
    try {
      const used = new Set(next.plan.pages.flatMap((page) => (page.source ? [page.source.file] : [])));
      const fileBytes = await Promise.all(next.sources.map(async (source, index) => (used.has(index) ? new Uint8Array(await source.file.arrayBuffer()) : null)));
      const imageBytes = next.plan.background?.kind === 'image' && next.backgroundImage ? new Uint8Array(await next.backgroundImage.arrayBuffer()) : null;
      const transfer = [...fileBytes, imageBytes].flatMap((bytes) => (bytes ? [bytes.buffer] : []));
      const response = await worker.run({ kind: 'organize', plan: next.plan, files: fileBytes, backgroundImage: imageBytes }, { transfer });
      if (requestId !== latestRequestRef.current) return;
      if (response.kind !== 'organize') throw new Error('Unexpected response from the organize worker.');
      if (!response.ok) {
        replaceResult(null);
        setBuildError(response.error);
        setStatus('error');
        return;
      }
      const { bytes, ...report } = response.output;
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
      replaceResult({ name: next.name, report, blob, url: URL.createObjectURL(blob) });
      setStatus('done');
    } catch (thrown: unknown) {
      if (requestId !== latestRequestRef.current) return;
      replaceResult(null);
      setBuildError(thrown instanceof Error && thrown.message ? `Writing the PDF failed: ${thrown.message}` : 'Writing the PDF failed unexpectedly. Try reloading the page.');
      setStatus('error');
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) void run(queued);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKey(targetKey), targetKey ? REBUILD_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [targetKey]);

  useEffect(() => {
    if (!settledKey) {
      latestRequestRef.current += 1; // Anything in flight belongs to a plan that no longer exists.
      queuedRef.current = null;
      replaceResult(null);
      setBuildError(null);
      setStatus('idle');
      return;
    }
    if (targetRef.current) void run(targetRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey]);

  // --------------------------------------------------------------------- files

  const inspect = async (file: File): Promise<PdfSourceInfo> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const response = await worker.run({ kind: 'inspect', bytes }, { transfer: [bytes.buffer] });
    if (response.kind !== 'inspect') throw new Error('Unexpected response from the organize worker.');
    if (!response.ok) throw new Error(response.error);
    return response.info;
  };

  const selectFile = async (next: File | null): Promise<void> => {
    const inspectId = (latestInspectRef.current += 1);
    cancelDetectRef.current = true;
    setFileError(null);
    setNotice(null);
    setReading(false);
    setSources([]);
    setHistory(startHistory([]));
    setSelected(new Set());
    anchorRef.current = null;
    if (!next) return;
    const validation = validatePdfFile(next);
    if (!validation.ok) {
      setFileError(validation.error);
      return;
    }
    setReading(true);
    try {
      const info = await inspect(next);
      if (inspectId !== latestInspectRef.current) return;
      setSources([{ id: nextSourceIdRef.current++, file: next, info }]);
      setHistory(startHistory(initialPages(info.pageCount)));
      setSettings((prev) => ({ ...prev, fileName: '' }));
      setAnnouncement(`Loaded ${next.name}: ${plural(info.pageCount, 'page')}.`);
    } catch (thrown: unknown) {
      if (inspectId !== latestInspectRef.current) return;
      setFileError(thrown instanceof Error && thrown.message ? thrown.message : 'This file couldn’t be read.');
    } finally {
      if (inspectId === latestInspectRef.current) setReading(false);
    }
  };

  /** Adds other PDFs' pages after the selection (or at the end), one file after another. */
  const insertFiles = async (chosen: File[]): Promise<void> => {
    if (!main || chosen.length === 0) return;
    const pdfs: File[] = [];
    const problems: string[] = [];
    for (const file of chosen) {
      const validation = validatePdfFile(file);
      if (validation.ok) pdfs.push(file);
      else problems.push(`“${file.name}”: ${validation.error}`);
    }
    const room = batchRoom(
      { count: sources.length, bytes: sources.reduce((sum, source) => sum + source.file.size, 0) },
      pdfs.map((file) => file.size),
      ORGANIZE_FILE_LIMITS
    );
    if (room.error) problems.push(room.error);
    setInserting(true);
    let nextPages = pages;
    let after: ReadonlySet<number> = liveSelected;
    const added: SourceFile[] = [];
    const addedIds: number[] = [];
    for (const file of pdfs.slice(0, room.accepted)) {
      try {
        const info = await inspect(file);
        const fileIndex = sources.length + added.length;
        const inserted = insertFilePages(nextPages, after, fileIndex, info.pageCount);
        nextPages = inserted.pages;
        after = new Set(inserted.ids);
        addedIds.push(...inserted.ids);
        added.push({ id: nextSourceIdRef.current++, file, info });
      } catch (thrown: unknown) {
        problems.push(`“${file.name}” couldn’t be added${errorText(thrown)}`);
      }
    }
    setInserting(false);
    setFileError(problems.length > 0 ? problems.join(' ') : null);
    if (added.length === 0) return;
    setSources((prev) => [...prev, ...added]);
    setHistory((prev) => pushHistory(prev, nextPages));
    setSelected(new Set(addedIds));
    setAnnouncement(`Inserted ${plural(addedIds.length, 'page')} from ${added.length === 1 ? (added[0]?.file.name ?? 'the PDF') : `${added.length} PDFs`}. They’re selected, so you can move them.`);
  };

  const clearAll = () => {
    void selectFile(null);
    setSettings(DEFAULT_ORGANIZE_SETTINGS);
    setBackgroundImage(null);
    setAnnouncement('Cleared the PDF and settings.');
  };

  const loadExample = async () => {
    setLoadingExample(true);
    try {
      const response = await worker.run({ kind: 'sample' });
      if (response.kind !== 'sample') throw new Error('Unexpected response from the organize worker.');
      setSettings(DEFAULT_ORGANIZE_SETTINGS);
      await selectFile(new File([response.bytes as Uint8Array<ArrayBuffer>], SAMPLE_FILE_NAME, { type: 'application/pdf' }));
    } catch (thrown: unknown) {
      setFileError(`Couldn’t generate the example PDF${errorText(thrown)}`);
    } finally {
      setLoadingExample(false);
    }
  };

  // --------------------------------------------------------------------- edits

  const commit = (next: OrganizePage[], message: string) => {
    setHistory((prev) => pushHistory(prev, next));
    setNotice(null);
    setAnnouncement(message);
  };

  const selectedCount = liveSelected.size;
  const selectionLabel = (count: number) => (count === 1 ? '1 page' : `${count} pages`);
  const rotate = (ids: ReadonlySet<number>, delta: number) => commit(rotatePages(pages, ids, delta), `Rotated ${selectionLabel(ids.size)} ${delta < 0 ? 'left' : 'right'}.`);
  const remove = (ids: ReadonlySet<number>) => {
    const first = pages.findIndex((page) => ids.has(page.id));
    pendingFocusRef.current = Math.max(0, first);
    commit(removePages(pages, ids), `Removed ${selectionLabel(ids.size)}. Press Undo to bring ${ids.size === 1 ? 'it' : 'them'} back.`);
  };
  const move = (direction: -1 | 1) => {
    commit(moveSelection(pages, liveSelected, direction), `Moved ${selectionLabel(selectedCount)} ${direction < 0 ? 'earlier' : 'later'}.`);
    window.requestAnimationFrame(() => gridRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }));
  };
  const duplicate = () => {
    const next = duplicatePages(pages, liveSelected);
    const existing = new Set(pages.map((page) => page.id));
    commit(next, `Duplicated ${selectionLabel(selectedCount)}. The copies are selected.`);
    // The copies become the selection, so the next action (move, rotate) applies to them.
    setSelected(new Set(next.filter((page) => !existing.has(page.id)).map((page) => page.id)));
  };
  const addBlank = () => {
    const { pages: next, id } = insertBlankPage(pages, liveSelected);
    commit(next, 'Added a blank page.');
    setSelected(new Set([id]));
  };
  const undo = () => {
    if (history.past.length === 0) return;
    setHistory(undoHistory(history));
    setAnnouncement('Undone.');
  };
  const redo = () => {
    if (history.future.length === 0) return;
    setHistory(redoHistory(history));
    setAnnouncement('Redone.');
  };

  const findBlankPages = async () => {
    const candidates = pages.filter((page) => page.source !== null);
    cancelDetectRef.current = false;
    setDetecting({ done: 0, total: candidates.length });
    setNotice(null);
    const coverage = new Map<string, boolean>();
    const blank: number[] = [];
    let failures = 0;
    for (const [index, page] of candidates.entries()) {
      if (cancelDetectRef.current) break;
      const source = page.source;
      const file = source ? sources[source.file]?.file : undefined;
      if (!source || !file) continue;
      const key = `${source.file}:${source.page}`;
      let isBlank = coverage.get(key);
      if (isBlank === undefined) {
        try {
          const pixels = await thumbnails.pixels(file, source.page);
          isBlank = looksBlank(inkCoverage(pixels.data, pixels.width, pixels.height));
        } catch {
          // A page pdf.js can't draw is counted and reported, but never guessed to be blank.
          failures += 1;
          isBlank = false;
        }
        coverage.set(key, isBlank);
      }
      if (isBlank) blank.push(page.id);
      setDetecting({ done: index + 1, total: candidates.length });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    const cancelled = cancelDetectRef.current;
    setDetecting(null);
    if (cancelled) return;
    const unreadable = failures > 0 ? ` ${plural(failures, 'page')} couldn’t be checked.` : '';
    if (blank.length === 0) {
      setNotice(`No blank pages found.${unreadable}`);
    } else {
      setSelected(new Set(blank));
      setNotice(`Found ${plural(blank.length, 'blank page')} — ${blank.length === 1 ? 'it’s' : 'they’re'} selected. Check them, then press Remove.${unreadable}`);
    }
    setAnnouncement(blank.length === 0 ? 'No blank pages found.' : `Found and selected ${plural(blank.length, 'blank page')}.`);
  };

  const clickCard = (event: MouseEvent, page: OrganizePage) => {
    // The checkbox's own click bubbles here; cancelling it stops it toggling a second time.
    event.preventDefault();
    const pick = !liveSelected.has(page.id);
    const ids = event.shiftKey ? selectionRun(pages, anchorRef.current, page.id) : [page.id];
    anchorRef.current = page.id;
    const next = new Set(liveSelected);
    for (const id of ids) {
      if (pick) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const onGridKeyDown = (event: KeyboardEvent) => {
    if (isTextEntry(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      redo();
    } else if (mod && key === 'a') {
      event.preventDefault();
      setSelected(new Set(pages.map((page) => page.id)));
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCount > 0) {
      event.preventDefault();
      remove(liveSelected);
    }
  };

  const reorder = useReorderableList({
    items: pages,
    onMove: (id, to) => commit(movePage(pages, id, to), `Moved page to position ${to + 1}.`),
    onFilesDropped: (dropped) => void insertFiles(dropped),
    dragLabel: (page) => (page.source ? `Page ${page.source.page + 1}` : 'Blank page'),
    axis: 'horizontal',
  });

  // -------------------------------------------------------------------- render

  const update = (patch: Partial<OrganizeSettings>) => setSettings((prev) => ({ ...prev, ...patch }));
  const updateNumbers = (patch: Partial<PageNumberSettings>) => setSettings((prev) => ({ ...prev, numbers: { ...prev.numbers, ...patch } }));
  const updateHeader = (patch: Partial<HeaderFooterSettings>) => setSettings((prev) => ({ ...prev, headerFooter: { ...prev.headerFooter, ...patch } }));
  const updateWatermark = (patch: Partial<WatermarkSettings>) => setSettings((prev) => ({ ...prev, watermark: { ...prev.watermark, ...patch } }));
  const updateBackground = (patch: Partial<BackgroundSettings>) => setSettings((prev) => ({ ...prev, background: { ...prev.background, ...patch } }));

  const planError = plan && !plan.ok ? plan.error : null;
  const imageError = settings.background.kind === 'image' && backgroundImage ? (() => {
    const format = backgroundImageFormat(backgroundImage);
    return format.ok ? null : format.error;
  })() : null;
  const nothingToClear = !main && !fileError && !backgroundImage && JSON.stringify(settings) === JSON.stringify(DEFAULT_ORGANIZE_SETTINGS);
  const pristine = isPristine(pages, pageCount);
  const busy = detecting !== null;
  const noSelection = selectedCount === 0;
  const needSelection = 'Select pages first — click them, or use Select all';
  const fileLabel = (index: number) => (index === 0 ? '' : `PDF ${index + 1} · `);
  const { numbers, headerFooter, watermark, background } = settings;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button
          type="button"
          class="btn"
          onClick={() => void loadExample()}
          disabled={loadingExample}
          title="Open a sample 6-page report that's out of order, with a sideways page and a page to remove"
        >
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={nothingToClear} title="Remove the PDF and reset every setting">
          Clear
        </button>
      </div>

      <FileDropzone
        file={main?.file ?? null}
        onFileSelected={(next) => void selectFile(next)}
        chooseLabel="Choose a PDF to organize"
        accept="application/pdf,.pdf"
        describeFile={(chosen) =>
          main
            ? [plural(main.info.pageCount, 'page'), formatBytes(chosen.size), sources.length > 1 && `+ ${plural(sources.length - 1, 'inserted PDF')}`].filter(Boolean).join(' · ')
            : formatBytes(chosen.size)
        }
      />

      <ErrorMessage message={fileError} />

      {reading && (
        <p class="field__hint orgpdf__status" role="status">
          <span class="job__spinner" aria-hidden="true" /> Reading the PDF…
        </p>
      )}

      {main && (
        <section class="orgpdf-editor" aria-label="Pages" onKeyDown={onGridKeyDown}>
          <div class="orgpdf-bar" aria-label="Selection">
            <span class="field__hint orgpdf-bar__count" role="status">
              {noSelection ? `${plural(pages.length, 'page')} · click to select, Shift-click for a run, drag to move` : `${selectedCount} of ${plural(pages.length, 'page')} selected`}
            </span>
            <span class="tool-bar__spacer" />
            <button type="button" class="btn" onClick={() => setSelected(new Set(pages.map((page) => page.id)))} disabled={selectedCount === pages.length || pages.length === 0} title="Select every page (Ctrl+A)">
              Select all
            </button>
            <button type="button" class="btn" onClick={() => setSelected(new Set())} disabled={noSelection} title="Clear the selection">
              Select none
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => void findBlankPages()}
              disabled={busy || pages.every((page) => page.source === null)}
              title="Looks at every page and selects the ones with (almost) nothing on them — scanned blank backs, separator sheets — so you can check and remove them"
            >
              Find blank pages
            </button>
          </div>

          <div class="orgpdf-bar orgpdf-bar--actions" aria-label="Page actions">
            <div class="orgpdf-group">
              <button type="button" class="btn" onClick={() => rotate(liveSelected, -90)} disabled={noSelection} title={noSelection ? needSelection : 'Rotate the selected pages 90° anticlockwise'}>
                <span aria-hidden="true">↺</span> Rotate left
              </button>
              <button type="button" class="btn" onClick={() => rotate(liveSelected, 90)} disabled={noSelection} title={noSelection ? needSelection : 'Rotate the selected pages 90° clockwise'}>
                <span aria-hidden="true">↻</span> Rotate right
              </button>
              <button type="button" class="btn" onClick={() => move(-1)} disabled={!canMoveSelection(pages, liveSelected, -1)} title={noSelection ? needSelection : 'Move the selected pages one place earlier'}>
                <span aria-hidden="true">←</span> Earlier
              </button>
              <button type="button" class="btn" onClick={() => move(1)} disabled={!canMoveSelection(pages, liveSelected, 1)} title={noSelection ? needSelection : 'Move the selected pages one place later'}>
                Later <span aria-hidden="true">→</span>
              </button>
              <button type="button" class="btn" onClick={duplicate} disabled={noSelection} title={noSelection ? needSelection : 'Put a copy of each selected page straight after it — the copies are then selected'}>
                Duplicate
              </button>
              <button type="button" class="btn orgpdf-danger" onClick={() => remove(liveSelected)} disabled={noSelection} aria-label="Remove selected pages" title={noSelection ? needSelection : 'Leave the selected pages out (Delete key) — Undo brings them back'}>
                <span aria-hidden="true">✕</span> Remove
              </button>
            </div>
            <div class="orgpdf-group">
              <button type="button" class="btn" onClick={addBlank} title="Insert an empty page after the selection, or at the end — the size of the page before it">
                + Blank page
              </button>
              <button type="button" class="btn" onClick={() => insertInputRef.current?.click()} disabled={inserting} title="Add the pages of other PDFs after the selection, or at the end — you can also drop PDFs onto the pages">
                {inserting ? 'Adding…' : '+ Insert PDF…'}
              </button>
              <input
                ref={insertInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                aria-label="Insert pages from other PDFs"
                onChange={(event) => {
                  const input = event.target as HTMLInputElement;
                  void insertFiles(Array.from(input.files ?? []));
                  input.value = '';
                }}
              />
              <button type="button" class="btn" onClick={() => commit(reversePages(pages), 'Reversed the page order.')} disabled={pages.length < 2} title="Put every page in the opposite order">
                Reverse
              </button>
              <button
                type="button"
                class="btn"
                onClick={() => commit(collateDuplex(pages), 'Interleaved the fronts and backs.')}
                disabled={pages.length < 3}
                title="Fix a one-sided scan of double-sided pages: all the fronts, then all the backs from the last sheet to the first, become front 1, back 1, front 2, back 2…"
              >
                Collate duplex scan
              </button>
            </div>
            <div class="orgpdf-group">
              <button type="button" class="btn" onClick={undo} disabled={history.past.length === 0} title="Undo the last change (Ctrl+Z)">
                Undo
              </button>
              <button type="button" class="btn" onClick={redo} disabled={history.future.length === 0} title="Redo (Ctrl+Y)">
                Redo
              </button>
              <button type="button" class="btn" onClick={() => commit(initialPages(pageCount), 'Back to the original pages.')} disabled={pristine} title="Go back to the original pages and order — Undo still works afterwards">
                Reset
              </button>
            </div>
          </div>

          {detecting && (
            <p class="field__hint orgpdf__status" role="status">
              <span class="job__spinner" aria-hidden="true" /> Checking page {detecting.done} of {detecting.total} for blank pages…
              <button type="button" class="btn" onClick={() => (cancelDetectRef.current = true)}>
                Stop
              </button>
            </p>
          )}
          {notice && (
            <p class="field__hint orgpdf__notice" role="status">
              {notice}
            </p>
          )}
          {sources.map((source) =>
            thumbnails.unavailable(source.file) ? (
              <p key={source.id} class="field__hint">
                Page previews can’t be drawn for {source.file.name} ({thumbnails.unavailable(source.file)}) — you can still organize its pages by number.
              </p>
            ) : null
          )}

          <ol class="orgpdf-grid" ref={gridRef} onDragLeave={reorder.onListDragLeave} aria-label="Pages — click to select, drag to move">
            {pages.map((page, index) => {
              const isSelected = liveSelected.has(page.id);
              const source = page.source;
              const file = source ? sources[source.file]?.file : undefined;
              const origin = !source ? 'Blank' : source.file === 0 && source.page === index ? '' : `${fileLabel(source.file)}p. ${source.page + 1}`;
              const classes = [
                'orgpdf-item',
                reorder.draggingId === page.id && 'orgpdf-item--dragging',
                reorder.dropTarget?.id === page.id && (reorder.dropTarget.after ? 'orgpdf-item--drop-after' : 'orgpdf-item--drop-before'),
              ]
                .filter(Boolean)
                .join(' ');
              const described = `page ${index + 1}${origin ? ` (${origin === 'Blank' ? 'blank' : `was ${origin}`})` : ''}`;
              return (
                <li key={page.id} class={classes} data-testid="organize-page" data-selected={isSelected} {...reorder.rowProps(page)}>
                  <div class="orgpdf-card" {...reorder.handleProps(page)} onClick={(event) => clickCard(event, page)}>
                    <PdfPageThumb
                      pageNumber={index + 1}
                      src={source && file ? thumbnails.thumbnailFor(file, source.page) : undefined}
                      failed={source && file ? thumbnails.hasFailed(file, source.page) : false}
                      onVisible={() => {
                        if (source && file) thumbnails.request(file, source.page);
                      }}
                      selected={isSelected}
                      rotation={page.rotation}
                      blank={!source}
                      onZoom={source && file ? () => setZoomedId(page.id) : undefined}
                    >
                      <span class="orgpdf-card__row">
                        <input type="checkbox" checked={isSelected} aria-label={`Select ${described}`} />
                        <span class="orgpdf-card__number">{index + 1}</span>
                        {origin && (
                          <span class="orgpdf-card__origin" title={source && source.file > 0 ? file?.name : undefined}>
                            {origin}
                          </span>
                        )}
                      </span>
                      <span class="orgpdf-card__actions">
                        <button
                          type="button"
                          class="btn orgpdf-icon"
                          aria-label={`Rotate ${described} left`}
                          title="Rotate left"
                          onClick={(event) => {
                            event.stopPropagation();
                            rotate(new Set([page.id]), -90);
                          }}
                        >
                          ↺
                        </button>
                        <button
                          type="button"
                          class="btn orgpdf-icon"
                          aria-label={`Rotate ${described} right`}
                          title="Rotate right"
                          onClick={(event) => {
                            event.stopPropagation();
                            rotate(new Set([page.id]), 90);
                          }}
                        >
                          ↻
                        </button>
                        <button
                          type="button"
                          class="btn orgpdf-icon orgpdf-danger"
                          aria-label={`Remove ${described}`}
                          title="Remove this page"
                          onClick={(event) => {
                            event.stopPropagation();
                            remove(new Set([page.id]));
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </PdfPageThumb>
                  </div>
                </li>
              );
            })}
          </ol>
          <p class="field__hint orgpdf__changes">{describeChanges(pages, pageCount)}</p>
        </section>
      )}

      {main && (
        <div class="orgpdf-options">
          <fieldset class="orgpdf-panel">
            <legend class="field__label">Add to the pages</legend>

            <div class="orgpdf-stamp">
              <label class="checkbox" title="Print a page number on every page of the organized PDF">
                <input type="checkbox" checked={numbers.enabled} onChange={(event) => updateNumbers({ enabled: (event.target as HTMLInputElement).checked })} />
                <span>Page numbers</span>
              </label>
              {numbers.enabled && (
                <div class="orgpdf-fields">
                  <label class="orgpdf-field">
                    <span class="field__hint">Position</span>
                    <select class="select" value={numbers.position} onChange={(event) => updateNumbers({ position: (event.target as HTMLSelectElement).value as StampPosition })}>
                      {STAMP_POSITIONS.map((position) => (
                        <option key={position} value={position}>
                          {STAMP_POSITION_LABELS[position]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="orgpdf-field">
                    <span class="field__hint">Format</span>
                    <select class="select" value={numbers.format} onChange={(event) => updateNumbers({ format: (event.target as HTMLSelectElement).value as NumberFormat })}>
                      {NUMBER_FORMATS.map((format) => (
                        <option key={format} value={format}>
                          {FORMAT_LABELS[format]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="orgpdf-field orgpdf-field--short">
                    <span class="field__hint">Start at</span>
                    <input class="input" type="text" inputMode="numeric" value={numbers.start} title="The number the first numbered page shows" onInput={(event) => updateNumbers({ start: (event.target as HTMLInputElement).value })} />
                  </label>
                  <label class="orgpdf-field orgpdf-field--short">
                    <span class="field__hint">Number from page</span>
                    <input
                      class="input"
                      type="text"
                      inputMode="numeric"
                      value={numbers.fromPage}
                      title="Pages before this one get no number — 2 leaves a cover page unnumbered"
                      onInput={(event) => updateNumbers({ fromPage: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                  <label class="orgpdf-field orgpdf-field--short">
                    <span class="field__hint">Size</span>
                    <select class="select" value={String(numbers.size)} onChange={(event) => updateNumbers({ size: Number((event.target as HTMLSelectElement).value) })}>
                      {STAMP_SIZES.map((size) => (
                        <option key={size} value={String(size)}>
                          {size} pt
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="checkbox" title="Blank pages still count towards the numbering, but don't show their number">
                    <input type="checkbox" checked={numbers.skipBlank} onChange={(event) => updateNumbers({ skipBlank: (event.target as HTMLInputElement).checked })} />
                    <span>No number on blank pages</span>
                  </label>
                </div>
              )}
            </div>

            <div class="orgpdf-stamp">
              <label class="checkbox" title="Print the same line of text — a company name, a document title — on every page">
                <input type="checkbox" checked={headerFooter.enabled} onChange={(event) => updateHeader({ enabled: (event.target as HTMLInputElement).checked })} />
                <span>Header or footer text</span>
              </label>
              {headerFooter.enabled && (
                <div class="orgpdf-fields">
                  <label class="orgpdf-field orgpdf-field--wide">
                    <span class="field__hint">Text</span>
                    <input class="input" type="text" maxLength={200} value={headerFooter.text} placeholder="e.g. Acme Corp · Confidential" onInput={(event) => updateHeader({ text: (event.target as HTMLInputElement).value })} />
                  </label>
                  <label class="orgpdf-field">
                    <span class="field__hint">Position</span>
                    <select class="select" value={headerFooter.position} onChange={(event) => updateHeader({ position: (event.target as HTMLSelectElement).value as StampPosition })}>
                      {STAMP_POSITIONS.map((position) => (
                        <option key={position} value={position}>
                          {STAMP_POSITION_LABELS[position]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="orgpdf-field orgpdf-field--short">
                    <span class="field__hint">Size</span>
                    <select class="select" value={String(headerFooter.size)} onChange={(event) => updateHeader({ size: Number((event.target as HTMLSelectElement).value) })}>
                      {STAMP_SIZES.map((size) => (
                        <option key={size} value={String(size)}>
                          {size} pt
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="checkbox">
                    <input type="checkbox" checked={headerFooter.skipBlank} onChange={(event) => updateHeader({ skipBlank: (event.target as HTMLInputElement).checked })} />
                    <span>Not on blank pages</span>
                  </label>
                </div>
              )}
            </div>

            <div class="orgpdf-stamp">
              <label class="checkbox" title="Print large, faint text across every page — CONFIDENTIAL, DRAFT, COPY">
                <input type="checkbox" checked={watermark.enabled} onChange={(event) => updateWatermark({ enabled: (event.target as HTMLInputElement).checked })} />
                <span>Watermark</span>
              </label>
              {watermark.enabled && (
                <div class="orgpdf-fields">
                  <label class="orgpdf-field orgpdf-field--wide">
                    <span class="field__hint">Text</span>
                    <input class="input" type="text" maxLength={100} value={watermark.text} onInput={(event) => updateWatermark({ text: (event.target as HTMLInputElement).value })} />
                  </label>
                  <div class="orgpdf-field">
                    <span class="field__hint">Direction</span>
                    <div class="seg" role="group" aria-label="Watermark direction">
                      <button type="button" class="seg__btn" aria-pressed={watermark.layout === 'diagonal'} onClick={() => updateWatermark({ layout: 'diagonal' })} title="Corner to corner, bottom-left to top-right">
                        Diagonal
                      </button>
                      <button type="button" class="seg__btn" aria-pressed={watermark.layout === 'horizontal'} onClick={() => updateWatermark({ layout: 'horizontal' })} title="Straight across the middle of the page">
                        Horizontal
                      </button>
                    </div>
                  </div>
                  <label class="orgpdf-field orgpdf-field--short">
                    <span class="field__hint">Size</span>
                    <select class="select" value={watermark.size} onChange={(event) => updateWatermark({ size: (event.target as HTMLSelectElement).value as WatermarkSize })}>
                      {WATERMARK_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {SIZE_LABELS[size]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="orgpdf-field orgpdf-field--short">
                    <span class="field__hint">Colour</span>
                    <select class="select" value={watermark.color} onChange={(event) => updateWatermark({ color: (event.target as HTMLSelectElement).value as WatermarkColor })}>
                      {WATERMARK_COLORS.map((color) => (
                        <option key={color} value={color}>
                          {COLOR_LABELS[color]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="orgpdf-field">
                    <span class="field__hint">Opacity {watermark.opacity}%</span>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={watermark.opacity}
                      title="How strongly the watermark shows over the page — 15–30% keeps the text underneath readable"
                      onInput={(event) => updateWatermark({ opacity: Number((event.target as HTMLInputElement).value) })}
                    />
                  </label>
                </div>
              )}
            </div>

            <div class="orgpdf-stamp">
              <div class="orgpdf-field">
                <span class="field__label orgpdf-stamp__title">Background</span>
                <div class="seg" role="group" aria-label="Page background">
                  {BACKGROUND_KINDS.map((kind) => (
                    <button key={kind} type="button" class="seg__btn" aria-pressed={background.kind === kind} onClick={() => updateBackground({ kind })}>
                      {BACKGROUND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              </div>
              {background.kind !== 'none' && (
                <div class="orgpdf-fields">
                  {background.kind === 'color' && (
                    <label class="orgpdf-field orgpdf-field--short">
                      <span class="field__hint">Colour</span>
                      <input class="orgpdf-color" type="color" value={background.color} onInput={(event) => updateBackground({ color: (event.target as HTMLInputElement).value })} />
                    </label>
                  )}
                  {background.kind === 'image' && (
                    <>
                      <div class="orgpdf-field">
                        <span class="field__hint">Image (JPG or PNG)</span>
                        <span class="orgpdf-image">
                          <button type="button" class="btn" onClick={() => imageInputRef.current?.click()} title="Choose the picture drawn behind every page">
                            {backgroundImage ? 'Change image…' : 'Choose image…'}
                          </button>
                          {backgroundImage && (
                            <span class="orgpdf-image__name" title={backgroundImage.name}>
                              {backgroundImage.name} · {formatBytes(backgroundImage.size)}
                            </span>
                          )}
                        </span>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                          hidden
                          aria-label="Background image"
                          onChange={(event) => {
                            const input = event.target as HTMLInputElement;
                            setBackgroundImage(input.files?.[0] ?? null);
                            input.value = '';
                          }}
                        />
                      </div>
                      <label class="orgpdf-field">
                        <span class="field__hint">Fit</span>
                        <select class="select" value={background.fit} title={FIT_HINTS[background.fit]} onChange={(event) => updateBackground({ fit: (event.target as HTMLSelectElement).value as ImageFit })}>
                          {IMAGE_FITS.map((fit) => (
                            <option key={fit} value={fit}>
                              {FIT_LABELS[fit]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label class="orgpdf-field">
                        <span class="field__hint">Strength {background.opacity}%</span>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          step="5"
                          value={background.opacity}
                          title="Lower values fade the image towards white, so text on top stays easy to read"
                          onInput={(event) => updateBackground({ opacity: Number((event.target as HTMLInputElement).value) })}
                        />
                      </label>
                    </>
                  )}
                  <label class="checkbox">
                    <input type="checkbox" checked={background.skipBlank} onChange={(event) => updateBackground({ skipBlank: (event.target as HTMLInputElement).checked })} />
                    <span>Not on blank pages</span>
                  </label>
                  <p class="field__hint orgpdf-fields__note">
                    Drawn underneath each page’s content. Scanned pages, and pages that paint their own white background, will cover it.
                  </p>
                </div>
              )}
              <ErrorMessage message={imageError} />
            </div>
          </fieldset>

          <fieldset class="orgpdf-panel">
            <legend class="field__label">Output</legend>
            <div class="orgpdf-field">
              <span class="field__hint">Compression</span>
              <div class="seg" role="group" aria-label="Compression">
                {COMPRESSION_CHOICES.map((choice) => (
                  <button key={choice} type="button" class="seg__btn" aria-pressed={settings.compression === choice} onClick={() => update({ compression: choice })} title={COMPRESSION_HINTS[choice]}>
                    {COMPRESSION_LABELS[choice]}
                  </button>
                ))}
              </div>
              <span class="field__hint">{COMPRESSION_HINTS[settings.compression]}</span>
            </div>
            <div class="orgpdf-fields">
              <label class="orgpdf-field orgpdf-field--wide">
                <span class="field__hint">File name</span>
                <input
                  class="input"
                  type="text"
                  spellcheck={false}
                  maxLength={200}
                  value={settings.fileName}
                  placeholder={defaultOutputName(main.file.name)}
                  title="The downloaded file's name — leave empty for the original name with -organized"
                  onInput={(event) => update({ fileName: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="checkbox" title="Bookmarks pointing at pages you kept come along, re-pointed at their new position">
                <input type="checkbox" checked={settings.keepBookmarks} onChange={(event) => update({ keepBookmarks: (event.target as HTMLInputElement).checked })} />
                <span>Keep bookmarks</span>
              </label>
            </div>
          </fieldset>
        </div>
      )}

      <ErrorMessage message={planError ?? buildError} />

      {status === 'building' && (
        <p class="field__hint orgpdf__status" role="status">
          <span class="job__spinner" aria-hidden="true" /> {result ? 'Updating the PDF…' : settings.compression !== 'off' ? 'Writing and compressing the PDF…' : 'Writing the PDF…'}
        </p>
      )}

      {main && result && (
        <div class="orgpdf-result" data-testid="organize-result">
          <div class="orgpdf-summary">
            <p class="orgpdf-summary__headline">
              <strong>{plural(result.report.pageCount, 'page')}</strong> · {formatBytes(result.blob.size)}
              {result.report.fileCount > 1 && ` · from ${result.report.fileCount} PDFs`}
            </p>
            <span class="tool-bar__spacer" />
            <button type="button" class="btn btn--primary" onClick={() => downloadUrl(result.url, result.name)} title={`Save as ${result.name}`}>
              <span aria-hidden="true">⭳</span> Download PDF
            </button>
          </div>
          <p class="orgpdf-tags">
            <span class="orgpdf-tag" title={result.name}>
              {result.name}
            </span>
            {result.report.bookmarkCount > 0 && <span class="orgpdf-tag">{plural(result.report.bookmarkCount, 'bookmark')}</span>}
            {result.report.formFieldCount > 0 && (
              <span class="orgpdf-tag" title="Form fields on the kept pages stay fillable">
                {plural(result.report.formFieldCount, 'form field')}
              </span>
            )}
            {result.report.numberedPages > 0 && <span class="orgpdf-tag">{plural(result.report.numberedPages, 'page')} numbered</span>}
            {result.report.linksRemoved > 0 && (
              <span class="orgpdf-tag" title="Links that jumped to a page you removed were taken out, rather than left pointing nowhere">
                {plural(result.report.linksRemoved, 'link')} to removed pages taken out
              </span>
            )}
            {result.report.renamedFields > 0 && (
              <span class="orgpdf-tag" title="Two PDFs used the same field name; without renaming, typing in one would fill both">
                {plural(result.report.renamedFields, 'form field')} renamed
              </span>
            )}
            {result.report.compression &&
              (result.report.compression.keptOriginal ? (
                <span class="orgpdf-tag" title="Compressing didn't make this file any smaller, so it's left uncompressed">
                  Already compact
                </span>
              ) : (
                <span class="orgpdf-tag orgpdf-tag--good">
                  Compressed {formatBytes(result.report.compression.before)} → {formatBytes(result.report.compression.after)}
                </span>
              ))}
          </p>
          {result.report.signed && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>This PDF is digitally signed. A signature only covers the exact original file, so it won’t show as valid in the organized copy — keep the signed original as well.</span>
            </p>
          )}
          <PdfPreview url={result.url} heading={`Preview — ${result.name}`} frameTitle={`Preview of ${result.name}`} />
        </div>
      )}

      {(() => {
        const position = pages.findIndex((page) => page.id === zoomedId);
        const page = pages[position];
        const source = page?.source;
        const file = source ? sources[source.file]?.file : undefined;
        if (!page || !source || !file) return null;
        // Steps over blank pages, which have nothing to show full size.
        const neighbour = (step: -1 | 1) => {
          for (let index = position + step; index >= 0 && index < pages.length; index += step) {
            const candidate = pages[index];
            if (candidate?.source) return candidate.id;
          }
          return null;
        };
        const previous = neighbour(-1);
        const next = neighbour(1);
        return (
          <PdfPageViewer
            title={`Page ${position + 1} of ${pages.length}${source.file > 0 ? ` — from ${file.name}` : ''}`}
            pageKey={`${source.file}:${source.page}`}
            load={() => thumbnails.renderLarge(file, source.page)}
            rotation={page.rotation}
            onClose={() => setZoomedId(null)}
            onPrevious={previous === null ? undefined : () => setZoomedId(previous)}
            onNext={next === null ? undefined : () => setZoomedId(next)}
          />
        );
      })()}

      <p class="sr-only" aria-live="polite">
        {announcement}
      </p>

      <style>{`
        .orgpdf__status { margin: 0; display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .orgpdf__notice { margin: 0; color: var(--text); }
        .orgpdf__changes { margin: 0; }
        .orgpdf-editor { display: flex; flex-direction: column; gap: var(--space-2); }
        .orgpdf-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
        .orgpdf-bar__count { margin: 0; }
        .orgpdf-bar--actions { gap: var(--space-2) var(--space-4); }
        .orgpdf-group { display: flex; flex-wrap: wrap; gap: var(--space-1); }
        .orgpdf-danger:not(:disabled):hover { color: var(--danger); border-color: var(--danger-border); }
        /* A long document scrolls inside the grid, so the options and result stay close by. */
        .orgpdf-grid {
          list-style: none; margin: 0; padding: var(--space-3); max-height: 34rem; overflow-y: auto;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .orgpdf-item { border-radius: var(--radius-sm); }
        .orgpdf-item--dragging { opacity: 0.4; }
        .orgpdf-item--drop-before { box-shadow: -3px 0 0 var(--accent); }
        .orgpdf-item--drop-after { box-shadow: 3px 0 0 var(--accent); }
        .orgpdf-card { cursor: grab; border-radius: var(--radius-sm); }
        .orgpdf-card:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
        .orgpdf-card__row { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
        .orgpdf-card__number { font-family: var(--font-mono); color: var(--text); }
        .orgpdf-card__origin { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-subtle); }
        .orgpdf-card__actions { display: flex; gap: 0.15rem; }
        .orgpdf-icon { min-width: 0; padding: 0 0.4rem; min-height: 1.75rem; font-size: var(--text-sm); line-height: 1; }
        .orgpdf-options { display: grid; gap: var(--space-3); }
        .orgpdf-panel {
          margin: 0; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .orgpdf-panel legend { padding: 0 var(--space-1); }
        .orgpdf-stamp { display: flex; flex-direction: column; gap: var(--space-2); }
        .orgpdf-stamp + .orgpdf-stamp { padding-top: var(--space-3); border-top: 1px solid var(--border); }
        .orgpdf-stamp__title { margin: 0; }
        .orgpdf-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-2) var(--space-3); padding-left: var(--space-5); }
        .orgpdf-fields__note { flex-basis: 100%; margin: 0; }
        .orgpdf-field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 9rem; }
        .orgpdf-field .field__hint { margin: 0; }
        .orgpdf-field .seg { align-self: flex-start; flex-wrap: wrap; }
        .orgpdf-field--short { min-width: 0; width: 7.5rem; }
        .orgpdf-field--wide { flex: 1 1 16rem; max-width: 28rem; }
        .orgpdf-panel > .orgpdf-fields { padding-left: 0; }
        .orgpdf-color { width: 3rem; height: 2.25rem; padding: 0.15rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; }
        .orgpdf-image { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .orgpdf-image__name { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 16rem; }
        .orgpdf-result { padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .orgpdf-summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .orgpdf-summary__headline { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
        .orgpdf-summary__headline strong { color: var(--text); font-size: var(--text-lg); }
        .orgpdf-tags { margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
        .orgpdf-tag {
          padding: 0 0.4rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
        }
        .orgpdf-tag--good { color: var(--accent); border-color: var(--accent-border); background: var(--accent-subtle); }
        .orgpdf-result .pdf-preview { margin-top: 0; }
        @media (max-width: 44rem) {
          .orgpdf-grid { grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); padding: var(--space-2); gap: var(--space-2); }
          .orgpdf-fields { padding-left: 0; }
        }
      `}</style>
    </div>
  );
}
