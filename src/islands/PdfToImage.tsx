import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_PDF_TO_IMAGE_SETTINGS,
  DPI_OPTIONS,
  FORMAT_INFO,
  IMAGE_FORMATS,
  MAX_QUALITY,
  MIN_QUALITY,
  QUALITY_PRESETS,
  SAMPLE_FILE_NAME,
  describeSelection,
  formatPageList,
  pageImageName,
  pagesToConvert,
  plural,
  validatePdfFile,
  validateSettings,
  zipNameFor,
  type PdfToImageSettings,
} from '../lib/tools/pdfToImage';
import { pageRun, updatePicked } from '../lib/tools/pdfSplit';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { FileDropzone } from './shared/FileDropzone';
import { PdfPageThumb } from './shared/PdfPageThumb';
import { downloadUrl } from './shared/downloadUrl';
import { downloadZip } from './shared/downloadZip';
import { usePdfThumbnails } from './shared/usePdfThumbnails';

// Deliberately no ShareLinkButton — the input is a PDF from the visitor's own disk, which can't
// (and shouldn't) travel in a URL, and the settings are meaningless without it. Same reasoning
// as Split PDF and the other PDF tools.

interface PageImageResult {
  page: number;
  name: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  capped: boolean;
}

type Status = 'idle' | 'converting' | 'done' | 'error';

export default function PdfToImage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState(0);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PdfToImageSettings>(DEFAULT_PDF_TO_IMAGE_SETTINGS);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [convertError, setConvertError] = useState<string | null>(null);
  const [results, setResults] = useState<PageImageResult[]>([]);
  const [loadingExample, setLoadingExample] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const thumbnails = usePdfThumbnails(file);
  const thumbnailsRef = useRef(thumbnails);
  thumbnailsRef.current = thumbnails;
  const resultsRef = useRef<PageImageResult[]>([]);
  /** Bumped to cancel a running conversion (Stop, a new file, an edit, Clear). */
  const runRef = useRef(0);
  const pickAnchorRef = useRef<number | null>(null);

  const replaceResults = (next: PageImageResult[]) => {
    for (const old of resultsRef.current) URL.revokeObjectURL(old.url);
    resultsRef.current = next;
    setResults(next);
  };
  useEffect(
    () => () => {
      runRef.current += 1;
      for (const old of resultsRef.current) URL.revokeObjectURL(old.url);
    },
    []
  );

  // The page count comes from pdf.js — the same document the thumbnails are drawn from, so the
  // file is parsed once. A file it can't open surfaces through `thumbnails.unavailable`.
  useEffect(() => {
    if (!file) return undefined;
    let current = true;
    thumbnailsRef.current.document().then(
      (doc) => {
        if (current) setPageCount(doc.pageCount);
      },
      () => {
        // The reason is shown from `thumbnails.unavailable`; the page count simply stays unknown.
        if (current) setPageCount(null);
      }
    );
    return () => {
      current = false;
    };
  }, [file, fileId]);

  const unavailable = thumbnails.unavailable;
  const openProblem = unavailable
    ? /password/i.test(unavailable)
      ? 'This PDF is password-protected. Remove the password first with Unlock PDF, then convert the unlocked copy.'
      : `Couldn’t open this PDF: ${unavailable}`
    : null;

  const selectFile = (next: File | null) => {
    runRef.current += 1;
    replaceResults([]);
    setConvertError(null);
    setPageCount(null);
    setStatus('idle');
    pickAnchorRef.current = null;
    setSettings((current) => ({ ...current, selection: 'all', pages: '' }));
    if (!next) {
      setFile(null);
      setFileError(null);
      return;
    }
    const checked = validatePdfFile(next);
    if (!checked.ok) {
      setFile(null);
      setFileError(checked.error);
      return;
    }
    setFileError(null);
    setFileId((id) => id + 1);
    setFile(next);
  };

  /** Any edit makes finished images stale: they no longer match the settings on screen. */
  const update = (patch: Partial<PdfToImageSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setConvertError(null);
    if (resultsRef.current.length > 0) {
      replaceResults([]);
      setStatus('idle');
    }
  };

  const selection = pageCount === null ? null : pagesToConvert(settings, pageCount);
  const typedPages = settings.selection === 'selected' && settings.pages.trim() !== '';
  const selectionError = selection && !selection.ok && typedPages ? selection.error : null;
  const chosen = selection && selection.ok ? selection.value : [];
  const picked = new Set(settings.selection === 'selected' ? chosen : []);
  const canConvert = file !== null && pageCount !== null && chosen.length > 0 && status !== 'converting';

  const setPicked = (pages: number[]) => update({ pages: formatPageList(pages) });
  const clickPage = (event: MouseEvent, page: number) => {
    event.preventDefault();
    const pick = !picked.has(page);
    const pages = event.shiftKey ? pageRun(pickAnchorRef.current, page) : [page];
    pickAnchorRef.current = page;
    setPicked(updatePicked([...picked], pages, pick));
    setAnnouncement(`Page ${page + 1} ${pick ? 'selected' : 'unselected'}.`);
  };

  const convert = async (): Promise<void> => {
    if (!file || pageCount === null || !selection || !selection.ok) return;
    const validated = validateSettings(settings);
    if (!validated.ok) {
      setConvertError(validated.error);
      return;
    }
    const run = (runRef.current += 1);
    replaceResults([]);
    setConvertError(null);
    setStatus('converting');
    setProgress({ done: 0, total: selection.value.length });
    const made: PageImageResult[] = [];
    try {
      const doc = await thumbnails.document();
      for (const page of selection.value) {
        if (runRef.current !== run) return;
        const image = await doc.renderImage(page, {
          format: settings.format,
          quality: settings.quality / 100,
          dpi: settings.dpi,
          transparent: settings.transparent,
        });
        if (runRef.current !== run) return;
        made.push({
          page,
          name: pageImageName(file.name, page, pageCount, settings.format),
          blob: image.blob,
          url: URL.createObjectURL(image.blob),
          width: image.width,
          height: image.height,
          capped: image.capped,
        });
        setProgress({ done: made.length, total: selection.value.length });
        // Let painting and input in between pages, so progress updates and Stop works.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      resultsRef.current = made;
      setResults(made);
      setStatus('done');
    } catch (thrown: unknown) {
      for (const partial of made) URL.revokeObjectURL(partial.url);
      if (runRef.current !== run) return;
      setConvertError(
        thrown instanceof Error && thrown.message
          ? `Couldn’t convert page ${(selection.value[made.length] ?? 0) + 1}: ${thrown.message}`
          : 'Conversion failed unexpectedly. Try a lower resolution, or fewer pages at a time.'
      );
      setStatus('error');
    }
  };

  const stop = () => {
    runRef.current += 1;
    setStatus('idle');
  };

  const downloadAll = async () => {
    if (!file) return;
    setZipping(true);
    try {
      await downloadZip(
        results.map((result) => ({ name: result.name, blob: result.blob })),
        zipNameFor(file.name)
      );
    } catch (thrown: unknown) {
      setConvertError(`Couldn’t build the ZIP${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
    } finally {
      setZipping(false);
    }
  };

  const clearAll = () => {
    selectFile(null);
    setSettings(DEFAULT_PDF_TO_IMAGE_SETTINGS);
  };

  const loadExample = async () => {
    setLoadingExample(true);
    setFileError(null);
    try {
      const { buildSamplePdf } = await import('../lib/tools/pdfToImageSample');
      const bytes = await buildSamplePdf();
      selectFile(new File([bytes as Uint8Array<ArrayBuffer>], SAMPLE_FILE_NAME, { type: 'application/pdf' }));
    } catch (thrown: unknown) {
      setFileError(`Couldn’t generate the example PDF${thrown instanceof Error && thrown.message ? `: ${thrown.message}` : '.'}`);
    } finally {
      setLoadingExample(false);
    }
  };

  const totalBytes = results.reduce((sum, result) => sum + result.blob.size, 0);
  const anyCapped = results.some((result) => result.capped);
  const pristine = !file && !fileError;
  const isJpeg = settings.format === 'jpeg';

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="field__hint">Turn PDF pages into JPEG or PNG images — all on your device.</span>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => void loadExample()} disabled={loadingExample} title="Generate a 4-page sample PDF to convert">
          {loadingExample ? 'Generating…' : 'Load example'}
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={pristine} title="Remove the PDF and its images">
          Clear
        </button>
      </div>

      <FileDropzone file={file} onFileSelected={selectFile} chooseLabel="Choose a PDF to convert" accept="application/pdf,.pdf" />
      <ErrorMessage message={fileError ?? openProblem} />

      {file && !openProblem && pageCount === null && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Reading the PDF…
        </p>
      )}

      {file && pageCount !== null && (
        <div class="p2i-settings">
          <p class="field__hint">
            {plural(pageCount, 'page')} · {formatBytes(file.size)}
          </p>

          <fieldset class="p2i-group">
            <legend class="field__label">Image format</legend>
            <div class="p2i-formats">
              {IMAGE_FORMATS.map((format) => (
                <label key={format} class="checkbox" title={FORMAT_INFO[format].hint}>
                  <input type="radio" name="p2i-format" checked={settings.format === format} onChange={() => update({ format })} />
                  <span>{FORMAT_INFO[format].label}</span>
                </label>
              ))}
            </div>
            <span class="field__hint">{FORMAT_INFO[settings.format].hint}.</span>
          </fieldset>

          <div class="p2i-row">
            <div class="field">
              <label class="field__label" for="p2i-dpi" title="Dots per inch. An A4 page at 150 DPI is about 1240 × 1750 px. Higher is sharper and bigger.">
                Resolution
              </label>
              <select id="p2i-dpi" class="select" value={settings.dpi} onChange={(event) => update({ dpi: Number((event.target as HTMLSelectElement).value) })}>
                {DPI_OPTIONS.map((option) => (
                  <option key={option.dpi} value={option.dpi}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {isJpeg ? (
              <div class="field p2i-quality" title="70–85% is usually indistinguishable on screen. Below 50% expect visible blockiness around text.">
                <label class="field__label" for="p2i-quality">
                  JPEG quality ({settings.quality}%)
                </label>
                <input
                  id="p2i-quality"
                  type="range"
                  min={MIN_QUALITY}
                  max={MAX_QUALITY}
                  value={settings.quality}
                  onInput={(event) => update({ quality: Number((event.target as HTMLInputElement).value) })}
                />
                <div class="p2i-presets" role="group" aria-label="Quality presets">
                  {QUALITY_PRESETS.map((preset) => (
                    <button
                      key={preset.quality}
                      type="button"
                      class="btn"
                      aria-pressed={settings.quality === preset.quality}
                      onClick={() => update({ quality: preset.quality })}
                      title={`${preset.label} — quality ${preset.quality}%`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <label class="checkbox p2i-transparent" title="Leave the page background see-through instead of white. Pages that paint their own background stay opaque.">
                <input type="checkbox" checked={settings.transparent} onChange={(event) => update({ transparent: (event.target as HTMLInputElement).checked })} />
                <span>Transparent background</span>
              </label>
            )}
          </div>

          <fieldset class="p2i-group">
            <legend class="field__label">Pages</legend>
            <div class="p2i-formats">
              <label class="checkbox">
                <input type="radio" name="p2i-pages" checked={settings.selection === 'all'} onChange={() => update({ selection: 'all' })} />
                <span>All pages ({pageCount})</span>
              </label>
              <label class="checkbox">
                <input type="radio" name="p2i-pages" checked={settings.selection === 'selected'} onChange={() => update({ selection: 'selected' })} />
                <span>Choose pages</span>
              </label>
            </div>
          </fieldset>

          {settings.selection === 'selected' && (
            <div class="p2i-pick">
              <div class="field">
                <label class="field__label" for="p2i-pages-input" title="Commas separate pages. 8- runs to the end; odd and even pick alternate pages.">
                  Page numbers
                </label>
                <input
                  id="p2i-pages-input"
                  class="input p2i-pages-input"
                  type="text"
                  spellcheck={false}
                  autocomplete="off"
                  placeholder="e.g. 1-3, 5, 8-"
                  value={settings.pages}
                  onInput={(event) => update({ pages: (event.target as HTMLInputElement).value })}
                />
                <span class="field__hint">Type pages and ranges, or click pages below — Shift-click picks a run.</span>
              </div>
              <ErrorMessage message={selectionError} />
              <div class="p2i-pick__bar">
                <span class="field__hint" role="status">
                  {picked.size === 0 ? 'No pages chosen yet.' : `${picked.size} of ${plural(pageCount, 'page')} chosen`}
                </span>
                <span class="tool-bar__spacer" />
                <button type="button" class="btn" disabled={picked.size === pageCount} onClick={() => setPicked(Array.from({ length: pageCount }, (_, page) => page))} title="Choose every page">
                  Select all
                </button>
                <button type="button" class="btn" disabled={picked.size === 0} onClick={() => update({ pages: '' })} title="Unchoose every page">
                  Select none
                </button>
              </div>
              <ol class="p2i-grid" key={fileId} aria-label="Pages — click to choose">
                {Array.from({ length: pageCount }, (_, page) => {
                  const isPicked = picked.has(page);
                  return (
                    <li key={page}>
                      <label class="p2i-page" data-testid="p2i-page" onClick={(event) => clickPage(event, page)}>
                        <PdfPageThumb
                          pageNumber={page + 1}
                          src={thumbnails.thumbnailFor(page)}
                          failed={thumbnails.hasFailed(page)}
                          onVisible={() => thumbnails.request(page)}
                          selected={isPicked}
                        >
                          <span class="p2i-page__row">
                            <input type="checkbox" checked={isPicked} aria-label={`Choose page ${page + 1}`} />
                            <span aria-hidden="true">{page + 1}</span>
                          </span>
                        </PdfPageThumb>
                      </label>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}

      <div class="p2i-actions">
        <button type="button" class="btn btn--primary" onClick={() => void convert()} disabled={!canConvert} title={file ? 'Draw the pages as images' : 'Choose a PDF first'}>
          {status === 'converting' ? 'Converting…' : chosen.length > 1 ? `Convert ${chosen.length} pages` : 'Convert to images'}
        </button>
        {status === 'converting' && (
          <button type="button" class="btn" onClick={stop} title="Stop converting">
            Stop
          </button>
        )}
      </div>

      <ErrorMessage message={convertError} />

      {status === 'converting' && (
        <p class="field__hint" role="status">
          <span class="job__spinner" aria-hidden="true" /> Converting page {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      )}

      {results.length > 0 && (
        <div class="p2i-result" data-testid="p2i-result">
          <div class="p2i-summary">
            <p class="msg msg--success" role="status">
              <span class="msg__icon" aria-hidden="true">
                ✓
              </span>
              <span>
                {plural(results.length, 'image')} · {formatBytes(totalBytes)} · {describeSelection(results.map((result) => result.page))}
              </span>
            </p>
            <span class="tool-bar__spacer" />
            {results.length > 1 && (
              <button type="button" class="btn btn--primary" onClick={() => void downloadAll()} disabled={zipping} title="Save every image in one ZIP file">
                <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : `Download all (${results.length}) as ZIP`}
              </button>
            )}
          </div>
          {anyCapped && <p class="field__hint">Some pages are very large, so they were drawn a little smaller than {settings.dpi} DPI to fit what your browser can handle.</p>}
          <ul class="p2i-images">
            {results.map((result) => (
              <li key={result.page} class="p2i-image" data-testid="p2i-image">
                <div class="p2i-image__frame">
                  <img src={result.url} alt={`Page ${result.page + 1} as ${FORMAT_INFO[settings.format].label}`} width={result.width} height={result.height} loading="lazy" decoding="async" />
                </div>
                <p class="p2i-image__name" title={result.name}>
                  {result.name}
                </p>
                <p class="p2i-image__meta">
                  {result.width} × {result.height} px · {formatBytes(result.blob.size)}
                </p>
                <button type="button" class="btn" onClick={() => downloadUrl(result.url, result.name)} title={`Save ${result.name}`}>
                  <span aria-hidden="true">⭳</span> Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p class="sr-only" aria-live="polite">
        {announcement}
      </p>

      <style>{`
        .p2i-settings { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-4); }
        .p2i-settings > .field__hint { margin: 0; }
        .p2i-group { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
        .p2i-group legend { padding: 0; margin-bottom: var(--space-1); }
        .p2i-formats { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
        .p2i-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-4) var(--space-6); }
        .p2i-quality { min-width: 14rem; max-width: 22rem; flex: 1 1 14rem; }
        .p2i-presets { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-1); }
        .p2i-presets .btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
        .p2i-transparent { align-self: end; }
        .p2i-pick { display: flex; flex-direction: column; gap: var(--space-3); }
        .p2i-pages-input { max-width: 32rem; font-family: var(--font-mono); }
        .p2i-pick__bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .p2i-pick__bar .field__hint { margin: 0; }
        .p2i-grid {
          list-style: none; margin: 0; padding: var(--space-3); max-height: 30rem; overflow-y: auto;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: var(--space-3);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        }
        .p2i-page { display: block; cursor: pointer; border-radius: var(--radius-sm); }
        .p2i-page:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
        .p2i-page__row { display: flex; align-items: center; gap: var(--space-1); font-family: var(--font-mono); color: var(--text); }
        .p2i-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
        .p2i-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .p2i-summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
        .p2i-summary .msg { margin: 0; }
        .p2i-images { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: var(--space-3); }
        .p2i-image {
          display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); min-width: 0;
        }
        .p2i-image__frame {
          aspect-ratio: 3 / 4; display: flex; align-items: center; justify-content: center; overflow: hidden;
          border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .p2i-image__frame img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
        .p2i-image__name {
          margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .p2i-image__meta { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
      `}</style>
    </div>
  );
}
