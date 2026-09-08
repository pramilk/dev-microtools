import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  renderMermaidDiagram,
  svgIntrinsicSize,
  exampleById,
  detectDiagramTypeId,
  DIAGRAM_KEYWORDS,
  MERMAID_DOCS_URL,
  MERMAID_EXAMPLES,
  MERMAID_THEMES,
  DEFAULT_THEME,
  type MermaidTheme,
} from '../lib/tools/mermaid';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { downloadUrl } from './shared/downloadUrl';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const RENDER_DEBOUNCE_MS = 350;
/** Rasterised above the on-screen preview size so a downloaded/copied PNG stays crisp even
 *  though the source is vector — same reasoning as QR Code Generator's fixed download sizes. */
const PNG_EXPORT_SCALE = 2;

const clampZoom = (value: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

const isKnownTheme = (value: unknown): value is MermaidTheme =>
  typeof value === 'string' && MERMAID_THEMES.some((theme) => theme.id === value);

/** Rasterises the SVG markup to a PNG blob via an off-screen canvas — the same dance
 *  QR Code Generator and Barcode Generator each do for their own SVG output. */
async function rasterizeToPng(svgMarkup: string, width: number, height: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render the diagram as an image.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser does not support canvas image export.');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export a PNG from this diagram.');
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

const supportsImageClipboard = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;

/** Fixed box every example thumbnail is scaled to fit inside, contain-style. */
const THUMB_WIDTH = 108;
const THUMB_HEIGHT = 72;

/** Centers a rendered diagram's SVG inside the fixed thumbnail box, scaled down (never up)
 *  to fit — the same "contain" technique `object-fit: contain` gives an `<img>`, done by hand
 *  here because the content is inline SVG at its own intrinsic size, not a raster image. */
function thumbnailCanvasStyle(width: number, height: number): string {
  const scale = Math.min(1, THUMB_WIDTH / width, THUMB_HEIGHT / height);
  return `width:${width}px;height:${height}px;transform:translate(-50%,-50%) scale(${scale});`;
}

/**
 * Opens the browser's own print dialog on a document containing only the diagram, sized to
 * its own intrinsic dimensions — "Save as PDF" is then a destination choice inside that
 * native dialog. There's no PDF-generating dependency here on purpose: the browser already
 * has a print-to-PDF pipeline, and adding a client-side PDF library just to reproduce it
 * would fail this project's "every dependency needs a real justification" bar.
 */
function printDiagramAsPdf(svgMarkup: string, width: number, height: number): void {
  const doc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>diagram</title>
<style>
  @page { size: ${Math.max(1, Math.round(width))}px ${Math.max(1, Math.round(height))}px; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  svg { display: block; width: ${width}px; height: ${height}px; }
</style>
</head>
<body>${svgMarkup}</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // Gives the print dialog time to open before the source document disappears — some
      // browsers cancel an in-flight print job the instant its document is torn down.
      setTimeout(cleanup, 1000);
    }
  };

  document.body.appendChild(iframe);
  iframe.srcdoc = doc;
}

interface ShareState {
  source: string;
  theme: MermaidTheme;
}

export default function MermaidDiagramGenerator() {
  const [source, setSource] = useState('');
  const [selectedExampleId, setSelectedExampleId] = useState('');
  const [theme, setTheme] = useState<MermaidTheme>(DEFAULT_THEME);

  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [exportError, setExportError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const [exampleThumbnails, setExampleThumbnails] = useState<Record<string, string>>({});
  const [thumbnailsStatus, setThumbnailsStatus] = useState<'idle' | 'loading' | 'ready'>('idle');

  const requestId = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const examplesDetailsRef = useRef<HTMLDetailsElement>(null);
  const dragState = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  useEffect(() => {
    void readShareStateFromLocation<Partial<ShareState>>().then((restored) => {
      if (!restored?.ok) return;
      const v = restored.value;
      if (typeof v.source === 'string') setSource(v.source);
      if (isKnownTheme(v.theme)) setTheme(v.theme);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === previewRef.current);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    },
    []
  );

  useEffect(() => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);

    if (source.trim() === '') {
      setSvg('');
      setError(null);
      setBusy(false);
      return;
    }

    setBusy(true);
    debounceTimer.current = setTimeout(() => {
      const id = (requestId.current += 1);
      void renderMermaidDiagram(source, { theme }).then((result) => {
        if (id !== requestId.current) return;
        setBusy(false);
        if (result.ok) {
          setSvg(result.value);
          setError(null);
        } else {
          setSvg('');
          setError(result.error);
        }
      });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    };
  }, [source, theme]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const selectExample = (id: string) => {
    setSelectedExampleId(id);
    const example = exampleById(id);
    if (!example) return;
    setSource(example.code);
    resetView();
    if (examplesDetailsRef.current) examplesDetailsRef.current.open = false;
  };

  /**
   * Renders every example once, lazily — only when the gallery is actually opened, never on
   * page load — so the picker can show a real thumbnail per diagram instead of a bare label.
   * Rendered one at a time rather than in parallel: Mermaid's `initialize()` + `render()`
   * share global state on the `mermaid` singleton, so concurrent calls can race and pick up
   * each other's theme/config mid-flight. Results are stored incrementally so cards fill in
   * as they finish instead of the whole gallery staying blank until the last one resolves.
   */
  const loadExampleThumbnails = async () => {
    if (thumbnailsStatus !== 'idle') return;
    setThumbnailsStatus('loading');
    for (const example of MERMAID_EXAMPLES) {
      const result = await renderMermaidDiagram(example.code, { theme: 'default' });
      if (result.ok) {
        setExampleThumbnails((current) => ({ ...current, [example.id]: result.value }));
      }
    }
    setThumbnailsStatus('ready');
  };

  const handleExamplesToggle = (event: Event) => {
    if ((event.target as HTMLDetailsElement).open) void loadExampleThumbnails();
  };

  const handleClear = () => {
    setSource('');
    setSelectedExampleId('');
    setError(null);
    setExportError(null);
    resetView();
  };

  const detectedTypeId = detectDiagramTypeId(source);
  const detectedExample = detectedTypeId ? exampleById(detectedTypeId) : undefined;

  /**
   * Inserts a snippet at the current cursor position (replacing any selection), then
   * restores focus and places the cursor right after what was just inserted — a lightweight,
   * dependency-free stand-in for full autocomplete, since a real code-editor component isn't
   * worth adding to this site's bundle for one tool.
   */
  const insertSnippet = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setSource((current) => current + text);
      return;
    }
    const start = el.selectionStart ?? source.length;
    const end = el.selectionEnd ?? source.length;
    const next = source.slice(0, start) + text + source.slice(end);
    setSource(next);
    const cursor = start + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const zoomIn = () => setZoom((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100));
  const zoomOut = () => setZoom((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100));

  const handleWheel = (event: WheelEvent) => {
    if (!svg) return;
    event.preventDefault();
    setZoom((z) => clampZoom(Math.round((z + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)) * 100) / 100));
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!svg) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragState.current = { startX: event.clientX, startY: event.clientY, startPan: pan };
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragState.current) return;
    const { startX, startY, startPan } = dragState.current;
    setPan({ x: startPan.x + (event.clientX - startX), y: startPan.y + (event.clientY - startY) });
  };

  const handlePointerUp = () => {
    dragState.current = null;
  };

  const fullscreenSupported = typeof document !== 'undefined' && document.fullscreenEnabled;

  const toggleFullscreen = () => {
    if (!previewRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void previewRef.current.requestFullscreen();
    }
  };

  const handleDownloadPng = async () => {
    if (!svg) return;
    setExportError(null);
    try {
      const { width, height } = svgIntrinsicSize(svg);
      const blob = await rasterizeToPng(svg, Math.round(width * PNG_EXPORT_SCALE), Math.round(height * PNG_EXPORT_SCALE));
      const url = URL.createObjectURL(blob);
      downloadUrl(url, 'diagram.png');
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export a PNG from this diagram.');
    }
  };

  const handleDownloadPdf = () => {
    if (!svg) return;
    setExportError(null);
    try {
      const { width, height } = svgIntrinsicSize(svg);
      printDiagramAsPdf(svg, width, height);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not open the print dialog for a PDF export.');
    }
  };

  const handleCopyImage = async () => {
    if (!svg) return;
    setExportError(null);
    if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    try {
      const { width, height } = svgIntrinsicSize(svg);
      const blob = await rasterizeToPng(svg, Math.round(width * PNG_EXPORT_SCALE), Math.round(height * PNG_EXPORT_SCALE));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    copyResetTimer.current = setTimeout(() => setCopyState('idle'), 1600);
  };

  const viewAtDefault = zoom === 1 && pan.x === 0 && pan.y === 0;

  // Mermaid's own SVG output sizes itself inconsistently across diagram types (sometimes a
  // percentage width with no height, sometimes neither) — reading its real size from the
  // viewBox and setting it explicitly on the wrapper is what makes the wrapper have any
  // box at all to center, zoom and pan, regardless of what Mermaid put on the SVG itself.
  const diagramSize = useMemo(() => (svg ? svgIntrinsicSize(svg) : null), [svg]);

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Examples and appearance">
        <details class="mermaid-examples" ref={examplesDetailsRef} onToggle={handleExamplesToggle}>
          <summary class="btn mermaid-examples__summary" title="Browse starter diagrams by type">
            Examples
          </summary>
          <div class="mermaid-examples__panel" role="group" aria-label="Example diagrams">
            {MERMAID_EXAMPLES.map((example) => {
              const thumbSvg = exampleThumbnails[example.id];
              const thumbSize = thumbSvg ? svgIntrinsicSize(thumbSvg) : null;
              return (
                <button
                  key={example.id}
                  type="button"
                  class="mermaid-examples__card"
                  aria-pressed={selectedExampleId === example.id}
                  title={example.description}
                  onClick={() => selectExample(example.id)}
                >
                  <span class="mermaid-examples__thumb">
                    {thumbSvg && thumbSize ? (
                      <span
                        class="mermaid-examples__thumb-canvas"
                        style={thumbnailCanvasStyle(thumbSize.width, thumbSize.height)}
                        dangerouslySetInnerHTML={{ __html: thumbSvg }}
                      />
                    ) : (
                      thumbnailsStatus === 'loading' && <span class="job__spinner" aria-hidden="true" />
                    )}
                  </span>
                  <span class="mermaid-examples__label">{example.label}</span>
                </button>
              );
            })}
          </div>
        </details>
        <label class="checkbox">
          <span class="field__hint">Theme</span>
          <select
            class="select"
            style="width:auto"
            value={theme}
            aria-label="Diagram theme"
            title="Mermaid's built-in colour theme for the rendered diagram"
            onChange={(event) => setTheme((event.target as HTMLSelectElement).value as MermaidTheme)}
          >
            {MERMAID_THEMES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <a
          class="field__hint mermaid-docs-link"
          href={MERMAID_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Mermaid's full official syntax reference, opens in a new tab"
        >
          Syntax reference ↗
        </a>
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ source, theme })} describe="this diagram" />
        <button type="button" class="btn" onClick={handleClear} disabled={source === ''} title="Clear the diagram source">
          Clear
        </button>
      </div>

      <div class="panes mermaid-panes">
        <div class="field">
          <label class="field__label" for="mermaid-input">
            <span>Diagram source (Mermaid syntax)</span>
            {detectedExample && (
              <span class="badge--ai" title={`Detected from the first line as a ${detectedExample.label.toLowerCase()}`}>
                {detectedExample.label}
              </span>
            )}
          </label>
          <textarea
            ref={textareaRef}
            id="mermaid-input"
            class="textarea mermaid-input"
            spellcheck={false}
            autocomplete="off"
            placeholder={'flowchart TD\n    A[Start] --> B[End]'}
            value={source}
            aria-invalid={error !== null}
            onInput={(event) => setSource((event.target as HTMLTextAreaElement).value)}
          />
          {detectedExample ? (
            <div class="mermaid-snippets" role="group" aria-label={`${detectedExample.label} snippets`}>
              <span class="field__hint">Insert:</span>
              {detectedExample.snippets.map((snippet) => (
                <button
                  key={snippet.label}
                  type="button"
                  class="btn mermaid-snippets__btn"
                  onClick={() => insertSnippet(snippet.insert)}
                  title={snippet.description}
                >
                  {snippet.label}
                </button>
              ))}
            </div>
          ) : (
            source.trim() !== '' && (
              <span class="field__hint">
                Start the first line with a diagram-type keyword to get snippets and a live type badge, e.g.{' '}
                {DIAGRAM_KEYWORDS.slice(0, 4).join(', ')}, …
              </span>
            )
          )}
        </div>

        <div class="field">
          <div class="field__label">
            <span>Preview{busy ? ' — rendering…' : ''}</span>
            <span class="tool-bar__group">
              <button type="button" class="btn" onClick={zoomOut} disabled={!svg || zoom <= ZOOM_MIN} title="Zoom out">
                <span aria-hidden="true">−</span>
              </button>
              <span class="field__hint tnum" style="min-width:3.5ch;text-align:center">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" class="btn" onClick={zoomIn} disabled={!svg || zoom >= ZOOM_MAX} title="Zoom in">
                <span aria-hidden="true">+</span>
              </button>
              <button type="button" class="btn" onClick={resetView} disabled={!svg || viewAtDefault} title="Reset zoom and position">
                Reset
              </button>
              {fullscreenSupported && (
                <button
                  type="button"
                  class="btn"
                  onClick={toggleFullscreen}
                  disabled={!svg}
                  title={isFullscreen ? 'Exit the fullscreen viewer' : 'Open a fullscreen viewer for this diagram'}
                >
                  {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                </button>
              )}
            </span>
          </div>

          <div
            ref={previewRef}
            class={`mermaid-viewer${isFullscreen ? ' mermaid-viewer--fullscreen' : ''}`}
            aria-live="polite"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDblClick={resetView}
          >
            {svg && diagramSize ? (
              <div
                class="mermaid-viewer__canvas"
                role="img"
                aria-label="Rendered diagram preview"
                style={`width:${diagramSize.width}px;height:${diagramSize.height}px;transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <p class="field__hint">
                {busy ? 'Rendering…' : 'Choose an example above, or write your own Mermaid syntax to see it rendered here.'}
              </p>
            )}
          </div>
          {svg && <span class="field__hint">Scroll to zoom, drag to pan, double-click to reset.</span>}

          <div class="tool-bar">
            <CopyButton value={svg} label="Copy SVG" describe="the diagram's SVG markup" />
            <DownloadButton value={svg} filename="diagram.svg" mimeType="image/svg+xml" label="Download SVG" describe="the diagram" />
            <button type="button" class="btn" onClick={() => void handleDownloadPng()} disabled={!svg} title="Save as a PNG image">
              <span aria-hidden="true">⭳</span> Download PNG
            </button>
            <button
              type="button"
              class="btn"
              onClick={handleDownloadPdf}
              disabled={!svg}
              title="Opens your browser's print dialog — choose &quot;Save as PDF&quot; as the destination"
            >
              <span aria-hidden="true">⭳</span> Download PDF
            </button>
            <DownloadButton
              value={source}
              filename="diagram.mmd"
              mimeType="text/plain"
              label="Download .mmd"
              describe="the raw Mermaid source"
            />
            {supportsImageClipboard() && (
              <button
                type="button"
                class={`btn${copyState === 'copied' ? ' btn--copied' : ''}`}
                onClick={() => void handleCopyImage()}
                disabled={!svg}
                title="Copy the rendered diagram image to your clipboard"
              >
                <span aria-hidden="true">{copyState === 'copied' ? '✓' : '⧉'}</span>{' '}
                {copyState === 'idle' ? 'Copy image' : copyState === 'copied' ? 'Copied' : 'Copy failed'}
              </button>
            )}
          </div>
        </div>
      </div>

      <ErrorMessage message={error} />
      <ErrorMessage message={exportError} />

      <style>{`
        .mermaid-examples {
          position: relative;
        }
        .mermaid-examples__summary {
          list-style: none;
          cursor: pointer;
        }
        .mermaid-examples__summary::-webkit-details-marker {
          display: none;
        }
        .mermaid-examples__summary::after {
          content: ' ▾';
        }
        .mermaid-examples[open] .mermaid-examples__summary::after {
          content: ' ▴';
        }
        .mermaid-examples__panel {
          position: absolute;
          top: calc(100% + var(--space-2));
          left: 0;
          z-index: 20;
          width: min(90vw, 36rem);
          max-height: 24rem;
          overflow-y: auto;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
          gap: var(--space-2);
          padding: var(--space-3);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-lg);
          background: var(--surface);
          box-shadow: var(--shadow);
        }
        .mermaid-examples__card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface);
          color: var(--text-muted);
          cursor: pointer;
        }
        .mermaid-examples__card:hover {
          background: var(--surface-2);
          color: var(--text);
        }
        .mermaid-examples__card[aria-pressed='true'] {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .mermaid-examples__thumb {
          position: relative;
          width: ${THUMB_WIDTH}px;
          height: ${THUMB_HEIGHT}px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surface-2);
          border-radius: var(--radius-sm);
        }
        .mermaid-examples__thumb-canvas {
          position: absolute;
          top: 50%;
          left: 50%;
          transform-origin: center center;
        }
        .mermaid-examples__thumb-canvas svg {
          display: block;
          max-width: none !important;
        }
        .mermaid-examples__label {
          font-size: var(--text-xs);
          text-align: center;
          line-height: 1.3;
        }
        .mermaid-docs-link {
          text-decoration: underline;
          white-space: nowrap;
        }
        /* Deliberately not .panes--split's even 1fr/1fr — the preview is the point of this
           tool, so it gets noticeably more width than the source editor once there's room
           for a real split. Below the same 62rem breakpoint .panes--split uses, this still
           stacks to a single column like every other split-pane tool. */
        @media (min-width: 62rem) {
          .mermaid-panes {
            grid-template-columns: 1fr 1.8fr;
          }
        }
        /* Matches .mermaid-viewer's height exactly, so the two panes line up evenly
           side by side instead of the preview dwarfing a much shorter source editor. */
        .mermaid-input {
          min-height: 32rem;
        }
        .mermaid-snippets {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--space-2);
        }
        .mermaid-snippets__btn {
          padding: 0.2rem 0.6rem;
          min-height: 1.75rem;
          font-size: var(--text-xs);
        }
        .mermaid-viewer {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 32rem;
          height: 32rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
          overflow: hidden;
          cursor: grab;
          touch-action: none;
        }
        .mermaid-viewer:active { cursor: grabbing; }
        .mermaid-viewer:fullscreen {
          height: 100%;
          width: 100%;
          background: var(--surface);
        }
        .mermaid-viewer__canvas {
          flex-shrink: 0;
          transform-origin: center center;
        }
        .mermaid-viewer__canvas svg {
          display: block;
          width: 100%;
          height: 100%;
          max-width: none !important;
        }
      `}</style>
    </div>
  );
}
