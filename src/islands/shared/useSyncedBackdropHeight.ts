import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/**
 * Keeps one or more highlight-backdrop layers the exact height of the real `<textarea>`
 * they sit behind, in the shared "highlighted textarea" technique (a transparent-text
 * backdrop `<div>` stacked in the same CSS grid cell as a transparent-background
 * `<textarea>`, so `<mark>` highlights can render behind editable text).
 *
 * A plain `<textarea>` lets the user drag its own native resize handle, which sets an
 * inline height on the textarea element alone — its backdrop siblings have no resize
 * handle of their own and are never included in that resize, so without this they keep
 * growing to their full, unclipped content height and spill out below the now-shorter
 * textarea. A `ResizeObserver` on the textarea re-applies its live height to every
 * backdrop on any change — a native resize, a window resize, or content-driven growth.
 */
export function useSyncedBackdropHeight(
  textareaRef: RefObject<HTMLTextAreaElement>,
  backdropRefs: readonly RefObject<HTMLElement>[]
) {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const sync = () => {
      const height = `${textarea.offsetHeight}px`;
      for (const ref of backdropRefs) {
        if (ref.current) ref.current.style.height = height;
      }
    };

    sync();
    // Every real browser this site supports ships ResizeObserver; the guard exists only
    // for test environments (jsdom) that don't implement it, so tests still get one
    // correct initial sync without crashing on a missing constructor.
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(sync);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);
}
