import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  /** "Page 3 of 12", shown as the dialog's heading. */
  title: string;
  /** Identifies the page shown — a change loads the new one. */
  pageKey: string;
  /** Draws the page large (from `usePdfThumbnails`'s `renderLarge`). */
  load: () => Promise<Blob>;
  /** Clockwise degrees (0/90/180/270) to turn the page by, as its thumbnail is. */
  rotation?: number;
  onClose: () => void;
  /** Omitted at the first/last page. */
  onPrevious?: () => void;
  onNext?: () => void;
}

/**
 * Shows one PDF page at full size in a modal dialog — the "zoom" for the page grids in the PDF
 * tools, since a thumbnail is too small to read. Drawn on demand (only the page being looked
 * at), from the same pdf.js document as the thumbnails, so nothing is uploaded. ← and → step
 * through the pages, Esc closes, and focus returns to whatever opened it.
 */
export function PdfPageViewer({ title, pageKey, load, rotation = 0, onClose, onPrevious, onNext }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // jsdom (and very old browsers) have no showModal: open it as a plain dialog instead.
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setSrc(null);
    setError(null);
    loadRef
      .current()
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch((thrown: unknown) => {
        if (!cancelled) setError(`This page couldn’t be drawn${thrown instanceof Error && thrown.message ? ` (${thrown.message})` : ''}.`);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pageKey]);

  const turned = ((rotation % 360) + 360) % 360;

  return (
    <dialog
      ref={dialogRef}
      class="pdf-viewer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialogRef.current) onCloseRef.current();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && onPrevious) {
          event.preventDefault();
          onPrevious();
        } else if (event.key === 'ArrowRight' && onNext) {
          event.preventDefault();
          onNext();
        }
      }}
    >
      <div class="pdf-viewer__bar">
        <p class="pdf-viewer__title">{title}</p>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={onPrevious} disabled={!onPrevious} title="Previous page (←)">
          <span aria-hidden="true">←</span> Previous
        </button>
        <button type="button" class="btn" onClick={onNext} disabled={!onNext} title="Next page (→)">
          Next <span aria-hidden="true">→</span>
        </button>
        <button type="button" class="btn" onClick={onClose} title="Close (Esc)" autofocus>
          Close
        </button>
      </div>
      <div class="pdf-viewer__stage">
        {error ? (
          <p class="field__hint">{error}</p>
        ) : src ? (
          <img class={`pdf-viewer__img${turned % 180 === 90 ? ' pdf-viewer__img--quarter' : ''}`} style={turned ? { transform: `rotate(${turned}deg)` } : undefined} src={src} alt={title} />
        ) : (
          <p class="field__hint" role="status">
            <span class="job__spinner" aria-hidden="true" /> Drawing the page…
          </p>
        )}
      </div>

      <style>{`
        .pdf-viewer {
          --viewer-w: min(92vw, 56rem); --viewer-h: min(78vh, 72rem);
          width: var(--viewer-w); max-width: none; max-height: none; padding: 0; overflow: hidden;
          border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface); color: var(--text);
        }
        .pdf-viewer::backdrop { background: rgb(0 0 0 / 0.6); }
        .pdf-viewer__bar {
          display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2);
          padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border);
        }
        .pdf-viewer__title { margin: 0; font-weight: 600; font-size: var(--text-sm); }
        .pdf-viewer__stage {
          height: var(--viewer-h); display: flex; align-items: center; justify-content: center; overflow: hidden;
          background: var(--surface-2); padding: var(--space-3);
        }
        .pdf-viewer__img { max-width: 100%; max-height: 100%; display: block; box-shadow: 0 0 0 1px var(--border); }
        /* Turned a quarter, the image's width and height swap, so their limits do too. */
        .pdf-viewer__img--quarter { max-width: calc(var(--viewer-h) - 2 * var(--space-3)); max-height: calc(var(--viewer-w) - 2 * var(--space-3)); flex-shrink: 0; }
      `}</style>
    </dialog>
  );
}
