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
  /** Controls and badges under the image (a checkbox, a "File 2" tag). */
  children?: ComponentChildren;
}

/**
 * One page thumbnail card. The image box has a fixed size from the start, so pages filling
 * in as they're drawn never shift the layout (CLS); until then it shows the page number.
 * Shared by the PDF tools that show page grids.
 */
export function PdfPageThumb({ pageNumber, src, failed, onVisible, muted = false, selected = false, children }: Props) {
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

  return (
    <div ref={ref} class={`pdf-thumb${muted ? ' pdf-thumb--muted' : ''}${selected ? ' pdf-thumb--selected' : ''}`}>
      <div class="pdf-thumb__frame">
        {src ? (
          <img class="pdf-thumb__img" src={src} alt={`Page ${pageNumber}`} decoding="async" />
        ) : (
          <span class="pdf-thumb__placeholder" title={failed ? 'This page couldn’t be drawn — it may be damaged' : undefined}>
            {failed ? '?' : pageNumber}
          </span>
        )}
      </div>
      <div class="pdf-thumb__caption">{children}</div>

      <style>{`
        .pdf-thumb { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; transition: opacity 0.12s ease; }
        .pdf-thumb--muted { opacity: 0.45; }
        .pdf-thumb__frame {
          width: 100%; aspect-ratio: 3 / 4; display: flex; align-items: center; justify-content: center; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .pdf-thumb--selected .pdf-thumb__frame { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .pdf-thumb__img { max-width: 100%; max-height: 100%; display: block; box-shadow: 0 0 0 1px var(--border); }
        .pdf-thumb__placeholder { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-subtle); }
        .pdf-thumb__caption { display: flex; flex-direction: column; gap: 0.15rem; font-size: var(--text-xs); color: var(--text-muted); }
      `}</style>
    </div>
  );
}
