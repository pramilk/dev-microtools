import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface Props {
  /** 1-based, as shown to the visitor. */
  pageNumber: number;
  /** The drawn page, once ready (from `usePdfThumbnails`). */
  src: string | undefined;
  failed: boolean;
  /** Called once, when the card first comes near the viewport — the cue to draw it. */
  onVisible: () => void;
  /** Dimmed, e.g. a page left out of the output. */
  muted?: boolean;
  /** Highlighted, e.g. a page picked for the output. */
  selected?: boolean;
  /** Clockwise degrees (0/90/180/270) to turn the drawn page by — an edit not yet written to
   *  the file, shown before it is. */
  rotation?: number;
  /** An inserted blank page: shows an empty sheet instead of a drawing. */
  blank?: boolean;
  /** Shows a magnifier button on the image that calls this — to open the page full size in
   *  a `PdfPageViewer`. The click doesn't reach the card, so it never selects the page. */
  onZoom?: () => void;
  /** Controls and badges under the image (a checkbox, a "File 2" tag). */
  children?: ComponentChildren;
}

/**
 * One page thumbnail card. The image box has a fixed size from the start, so pages filling
 * in as they're drawn never shift the layout (CLS); until then it shows the page number.
 * Shared by the PDF tools that show page grids.
 */
export function PdfPageThumb({ pageNumber, src, failed, onVisible, muted = false, selected = false, rotation = 0, blank = false, onZoom, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const element = ref.current;
    // No IntersectionObserver (old browsers, test environments): just draw it.
    if (!element || typeof IntersectionObserver === 'undefined') {
      onVisibleRef.current();
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          onVisibleRef.current();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const turned = ((rotation % 360) + 360) % 360;
  // A quarter turn swaps the sheet's width and height, so its limits swap too (the frame is
  // 3:4, so 133% of its width is its height) — rotated, it then fits the frame exactly.
  const turnClass = turned % 180 === 90 ? ' pdf-thumb__sheet--quarter' : '';
  const turnStyle = turned ? { transform: `rotate(${turned}deg)` } : undefined;

  return (
    <div ref={ref} class={`pdf-thumb${muted ? ' pdf-thumb--muted' : ''}${selected ? ' pdf-thumb--selected' : ''}`}>
      <div class="pdf-thumb__frame">
        {blank ? (
          <span class={`pdf-thumb__blank${turnClass}`} style={turnStyle} role="img" aria-label="Blank page" />
        ) : src ? (
          <img class={`pdf-thumb__img${turnClass}`} style={turnStyle} src={src} alt={`Page ${pageNumber}`} decoding="async" />
        ) : (
          <span class="pdf-thumb__placeholder" title={failed ? 'This page couldn’t be drawn — it may be damaged' : undefined}>
            {failed ? '?' : pageNumber}
          </span>
        )}
        {onZoom && (
          <button
            type="button"
            class="pdf-thumb__zoom"
            aria-label={`View page ${pageNumber} full size`}
            title="View this page full size"
            draggable={false}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onZoom();
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M10.4 10.4 14 14M5 7h4M7 5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div class="pdf-thumb__caption">{children}</div>

      <style>{`
        .pdf-thumb { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; transition: opacity 0.12s ease; }
        .pdf-thumb--muted { opacity: 0.45; }
        .pdf-thumb__frame {
          position: relative; width: 100%; aspect-ratio: 3 / 4; display: flex; align-items: center; justify-content: center; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .pdf-thumb--selected .pdf-thumb__frame { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .pdf-thumb__img { max-width: 100%; max-height: 100%; display: block; box-shadow: 0 0 0 1px var(--border); transition: transform 0.15s ease; }
        .pdf-thumb__sheet--quarter { max-width: 133.333%; max-height: 75%; flex-shrink: 0; }
        .pdf-thumb__blank {
          width: 75%; aspect-ratio: 210 / 297; display: block; flex-shrink: 0; background: var(--paper);
          box-shadow: 0 0 0 1px var(--border); transition: transform 0.15s ease;
        }
        .pdf-thumb__blank.pdf-thumb__sheet--quarter { width: auto; height: 75%; max-height: none; }
        /* Always shown (touch screens have no hover), but quiet until the card is pointed at. */
        .pdf-thumb__zoom {
          position: absolute; top: var(--space-1); right: var(--space-1); width: 1.75rem; height: 1.75rem; padding: 0;
          display: inline-flex; align-items: center; justify-content: center; cursor: zoom-in;
          border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-muted);
          opacity: 0.75; transition: opacity 0.12s ease, color 0.12s ease;
        }
        .pdf-thumb:hover .pdf-thumb__zoom, .pdf-thumb__zoom:focus-visible { opacity: 1; color: var(--accent); }
        .pdf-thumb__zoom:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .pdf-thumb__placeholder { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-subtle); }
        .pdf-thumb__caption { display: flex; flex-direction: column; gap: 0.15rem; font-size: var(--text-xs); color: var(--text-muted); }
      `}</style>
    </div>
  );
}
