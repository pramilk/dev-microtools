import type { ComponentChildren } from 'preact';

interface Props {
  /** A blob: URL of the PDF to show. */
  url: string;
  /** Visible heading above the viewer. */
  heading: string;
  /** Accessible name for the frame — should say which document it is. */
  frameTitle: string;
  /** Optional controls shown beside the heading (e.g. a document switcher). */
  controls?: ComponentChildren;
}

/** `#view=FitH` asks Chromium's and Firefox's built-in viewers to fit the page width, so the
 *  preview opens readable instead of at an arbitrary zoom. Viewers that don't understand the
 *  fragment ignore it. */
const viewerSrc = (url: string): string => `${url}#view=FitH`;

/**
 * A whole-document preview in the browser's own PDF viewer: scrolling, zoom and page
 * navigation for free, with no PDF-rendering library shipped. Shared by every PDF tool.
 *
 * Needs the page's CSP to allow `frame-src blob:` and `object-src blob:` — see the per-tool
 * blocks in `public/_headers`. Most phone browsers can't display a PDF inside a page at all,
 * hence the always-visible "Open in new tab" escape hatch.
 */
export function PdfPreview({ url, heading, frameTitle, controls }: Props) {
  return (
    <div class="pdf-preview">
      <div class="pdf-preview__bar">
        <span class="field__label">{heading}</span>
        {controls}
        <span class="tool-bar__spacer" />
        <a class="field__hint" href={url} target="_blank" rel="noopener" title="Open this PDF in your browser's full PDF viewer">
          Open in new tab ↗
        </a>
      </div>
      {/* Keyed on the URL so switching documents reloads the frame instead of keeping the
          old one's scroll state. */}
      <iframe key={url} class="pdf-preview__frame" src={viewerSrc(url)} title={frameTitle} />
      <p class="field__hint">Blank preview? Some browsers (most phones) can't display PDFs inside a page — use “Open in new tab” instead.</p>

      <style>{`
        .pdf-preview { margin-top: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
        .pdf-preview__bar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        .pdf-preview .field__hint { margin: 0; }
        /* Fixed height reserved up front, so the frame loading its content never shifts the
           page (CLS); the document scrolls inside it. */
        .pdf-preview__frame {
          width: 100%; height: 75vh; min-height: 28rem; max-height: 60rem;
          border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-2);
        }
      `}</style>
    </div>
  );
}
