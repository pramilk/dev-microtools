import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const MIN_ZOOM = 0.33;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
/** Height cap for the stage's "fit" size (zoom 100%) — kept as one constant so the inline
 *  width formula and the scroll wrapper's own max-height can never drift apart. */
const MAX_STAGE_HEIGHT_REM = 22;
/** Base stage height for content with no known pixel dimensions (e.g. an SVG, rendered at
 *  whatever size the viewport gives it) — zoom scales this directly instead of the
 *  width-from-aspect-ratio formula used when a real width/height is known. */
const FALLBACK_STAGE_HEIGHT_REM = 16;

interface Props {
  beforeUrl: string;
  afterUrl: string;
  /** Pixel dimensions of the compared images, when known — used to size the stage at the right aspect ratio. Omit for a fixed-height box (e.g. vector content with no fixed pixel size), which still displays correctly via `object-fit: contain`. */
  width?: number;
  height?: number;
  beforeLabel?: string;
  afterLabel?: string;
  /** Shows a checkerboard pattern behind both images instead of a solid fill, so a
   *  transparent area (e.g. a PNG with alpha) reads as "see-through" rather than as
   *  whatever the theme's surface color happens to be. */
  transparent?: boolean;
}

/**
 * Before/after comparison. Dragging directly on the image is the primary, most intuitive
 * interaction; the underlying `<input type="range">` stays fully wired for keyboard and
 * screen-reader use but is visually hidden (`sr-only`) rather than duplicated on screen,
 * since dragging on the image is the interaction most people reach for.
 */
export function CompareSlider({
  beforeUrl,
  afterUrl,
  width,
  height,
  beforeLabel = 'Original',
  afterLabel = 'Compressed',
  transparent = false,
}: Props) {
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  // Whether the zoomed content actually overflows the visible box — as opposed to just
  // "zoom > 1", which can still fit with no scrollbar at all on a wide viewport with a
  // small image. Drives both the grab cursor and whether a drag pans instead of moving
  // the split, so dragging never "does nothing" when there's nothing to pan into.
  const [canPan, setCanPan] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Holds the pointer's start position and the container's scroll offset at that moment,
  // so a pan-drag can compute the new scroll position from the pointer's total movement
  // rather than accumulating per-event deltas (which drifts if an event is missed).
  const panOriginRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  // A fresh comparison (new before/after pair) starts unzoomed — carrying over a zoom
  // level from whatever was previously being inspected would be a confusing surprise.
  useEffect(() => {
    setZoom(1);
  }, [beforeUrl, afterUrl]);

  // Re-measures after every zoom change (and once the images have their real dimensions),
  // rather than assuming zoom > 1 implies overflow.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    setCanPan(scroller.scrollWidth > scroller.clientWidth || scroller.scrollHeight > scroller.clientHeight);
  }, [zoom, width, height]);

  const updateFromClientX = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(100, Math.max(0, Math.round(percent))));
  };

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));

  // Ctrl/Cmd+scroll to zoom, matching the map/design-tool convention — gated on the
  // modifier so plain scrolling still pans a zoomed-in image instead of fighting it. A
  // trackpad pinch gesture is also reported as a wheel event with ctrlKey set, so this
  // covers both without extra handling.
  const onWheelZoom = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const step = 0.1;
    setZoom((z) => {
      const next = z + (event.deltaY < 0 ? step : -step);
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +next.toFixed(2)));
    });
  };

  return (
    <div class="compare">
      {/* One bordered panel holding the label/zoom header and the image together, so
          neither reads as a caption floating above the preview — both are part of the same
          box. Labels ordered to match the drag geometry, not before/after: the "before"
          image is what's revealed on the left as the split grows, so its label sits on the
          left too. */}
      <div class="compare__panel">
        {/* On-image captions, positioned against the full panel — not the (usually
            narrower, centered) image stage below — so they sit at the panel's extreme
            edges regardless of how wide the image itself renders. Ordered to match the
            drag geometry, not before/after: the "before" image is what's revealed on the
            left as the split grows, so its label sits on the left too. */}
        <span class="compare__label compare__label--before" aria-hidden="true">
          {beforeLabel}
        </span>
        {/* The "after" label and the zoom toolbar stacked as one top-right column, so the
            zoom buttons read as belonging to that corner instead of floating separately. */}
        <div class="compare__after-group">
          <span class="compare__label" aria-hidden="true">
            {afterLabel}
          </span>
          <div class="compare__zoom">
            <button
              type="button"
              class="compare__zoom-btn"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              title={`Zoom in to see detail (${Math.round(zoom * 100)}%) — Ctrl/⌘+scroll also zooms; drag the corner to resize`}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              class="compare__zoom-btn"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              title={`Zoom out (${Math.round(zoom * 100)}%)`}
              aria-label="Zoom out"
            >
              −
            </button>
          </div>
        </div>
        <div class="compare__scroll" ref={scrollRef} onWheel={onWheelZoom}>
          <div
            class={`compare__stage${transparent ? ' compare__stage--checkerboard' : ''}${canPan ? ' compare__stage--zoomed' : ''}${isPanning ? ' compare__stage--panning' : ''}`}
            ref={stageRef}
            style={
              width && height
                ? `aspect-ratio:${width}/${height}; width:calc(min(100%, ${MAX_STAGE_HEIGHT_REM}rem * ${width} / ${height}) * ${zoom})`
                : `height:calc(${FALLBACK_STAGE_HEIGHT_REM}rem * ${zoom}); width:100%`
            }
            onPointerDown={(event) => {
              (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
              // A plain drag only pans when the zoomed content actually overflows the
              // visible box — otherwise there's nothing to pan into, and the drag should
              // do what it always does: move the compare split. The split itself stays
              // reachable by grabbing the round handle directly (see below) even while
              // panning is active, since the handle stops this handler from firing at all.
              if (canPan && scrollRef.current) {
                panOriginRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  scrollLeft: scrollRef.current.scrollLeft,
                  scrollTop: scrollRef.current.scrollTop,
                };
                setIsPanning(true);
                return;
              }
              updateFromClientX(event.clientX);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              if (panOriginRef.current && scrollRef.current) {
                const origin = panOriginRef.current;
                scrollRef.current.scrollLeft = origin.scrollLeft - (event.clientX - origin.x);
                scrollRef.current.scrollTop = origin.scrollTop - (event.clientY - origin.y);
                return;
              }
              updateFromClientX(event.clientX);
            }}
            onPointerUp={() => {
              panOriginRef.current = null;
              setIsPanning(false);
            }}
          >
            {/* Each side is its own clipped layer sitting directly on the stage's checkerboard
                background — not one full-bleed image with the other stacked on top of it.
                Stacking them would mean a transparent area of the top layer reveals whatever
                opaque pixels the *other* image has underneath (e.g. a JPEG's solid fill)
                instead of the checkerboard, which reads as "the transparency got removed"
                even when it didn't. Complementary clip-paths keep the two from ever
                overlapping, so each one's own transparency shows the checkerboard correctly. */}
            <div class="compare__before" style={`clip-path: inset(0 ${100 - split}% 0 0)`}>
              <img src={beforeUrl} alt={beforeLabel} class="compare__img" draggable={false} />
            </div>
            <div class="compare__after" style={`clip-path: inset(0 0 0 ${split}%)`}>
              <img src={afterUrl} alt={afterLabel} class="compare__img" draggable={false} />
            </div>
            {/* Grabbing anywhere along the line always moves the split, even while the rest
                of the image is busy panning — not just the small round handle. It's a wide
                invisible strip (the visible line is a thin ::before centered inside it) so
                there's a real target to grab, not just the 2px line itself. stopPropagation
                keeps the stage's own pan/split handler above from also firing. */}
            <div
              class="compare__divider"
              style={`left:${split}%`}
              aria-hidden="true"
              onPointerDown={(event) => {
                event.stopPropagation();
                (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
                updateFromClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.buttons !== 1) return;
                updateFromClientX(event.clientX);
              }}
            >
              <span class="compare__handle" />
            </div>
          </div>
        </div>
      </div>
      <p class="compare__hint field__hint">
        Tip: hold Ctrl (⌘ on Mac) and scroll, or use the +/− buttons, to zoom in for a closer look. Once zoomed in, drag the image to pan around, or drag the round handle to move the comparison line.
      </p>
      <input
        type="range"
        min="0"
        max="100"
        value={split}
        class="compare__range sr-only"
        aria-label={`Slide to compare the ${beforeLabel.toLowerCase()} and ${afterLabel.toLowerCase()} image`}
        onInput={(event) => setSplit(Number((event.target as HTMLInputElement).value))}
      />

      <style>{`
        /* flex:1 + min-width:0 only matter when this sits inside a flex row (.compare-panel,
           beside the quality/dimension controls) — a flex item with no explicit basis
           shrinks toward the content-based min-width of its width:100% child, which for an
           absolutely-positioned image collapses to almost nothing. Harmless outside a flex
           parent, where flex has no effect and this is just a block element. */
        .compare { margin-top: var(--space-3); flex: 1; min-width: 0; }
        /* One shared border/radius around the whole panel (labels + image), rather than on
           the stage alone, so the on-image captions can anchor to the panel's own extreme
           edges instead of the (usually narrower, centered) image beneath them. */
        .compare__panel { position: relative; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
        /* max-height stays generous (well above the ${MAX_STAGE_HEIGHT_REM}rem "fit" size
           baked into the width formula above) so the default view is exactly the fitted
           size with no wasted space, while resize:vertical lets a user who wants more room
           — a tall image, or a closer look while zoomed — drag the corner handle for it. */
        .compare__scroll { max-height: 50rem; min-height: 8rem; overflow: auto; resize: vertical; }
        .compare__hint { margin: var(--space-2) 0 0; }
        .compare__stage {
          position: relative; overflow: hidden; margin: 0 auto; background: var(--surface-2);
          cursor: ew-resize; touch-action: none; user-select: none;
        }
        .compare__stage--zoomed { cursor: grab; }
        .compare__stage--panning { cursor: grabbing; }
        /* A neutral, theme-independent checker — the same "see-through" convention every
           image editor uses, so it stays recognizable regardless of the site's own theme. */
        .compare__stage--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }
        .compare__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
        .compare__before, .compare__after { position: absolute; inset: 0; }
        /* A wide (1rem) invisible strip centered on the split, so the whole line — not just
           the small round handle — is a real target to grab. The visible thin line is drawn
           by ::before, centered inside this wider hit area. */
        .compare__divider {
          position: absolute; top: 0; bottom: 0; width: 1rem; transform: translateX(-50%);
          display: flex; align-items: center; justify-content: center;
          cursor: ew-resize; touch-action: none;
        }
        .compare__divider::before {
          content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 2px;
          background: var(--accent-contrast); box-shadow: 0 0 0 1px var(--accent);
          transform: translateX(-1px); pointer-events: none;
        }
        .compare__handle {
          position: relative; flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 999px; background: var(--accent);
          border: 2px solid var(--accent-contrast); box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
          pointer-events: none; /* clicks fall through to .compare__divider, which now covers the whole line */
        }
        .compare__handle::before, .compare__handle::after {
          content: ''; position: absolute; top: 50%; width: 0; height: 0;
          border-top: 4px solid transparent; border-bottom: 4px solid transparent;
        }
        .compare__handle::before { border-right: 5px solid var(--accent-contrast); left: 0.45rem; transform: translateY(-50%); }
        .compare__handle::after { border-left: 5px solid var(--accent-contrast); right: 0.45rem; transform: translateY(-50%); }

        /* On-image caption — decorative and non-interactive (aria-hidden, pointer-events:
           none) so it never intercepts the stage's own drag-to-compare gesture. A dark,
           semi-opaque badge (theme-independent, like the crop mask elsewhere) rather than
           the accent color, since this sits on top of arbitrary image content and needs to
           stay legible against both light and dark pictures. */
        .compare__label {
          position: absolute; top: var(--space-2); z-index: 2; pointer-events: none;
          font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.02em;
          padding: 0.3rem 0.6rem; border-radius: var(--radius-sm);
          background: rgb(0 0 0 / 0.55); color: #fff;
        }
        .compare__label--before { left: var(--space-2); }
        .compare__after-group { position: absolute; top: var(--space-2); right: var(--space-2); z-index: 2; display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); }
        .compare__after-group .compare__label { position: static; }
        /* Stacked vertically under the "after" label rather than side-by-side, so the
           toolbar reads as one compact column tucked into that corner. */
        .compare__zoom { display: flex; flex-direction: column; gap: var(--space-1); }
        .compare__zoom-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.75rem; height: 1.75rem; padding: 0; border-radius: var(--radius-sm);
          border: none; background: rgb(0 0 0 / 0.55);
          color: #fff; font-size: var(--text-base); line-height: 1; cursor: pointer;
        }
        .compare__zoom-btn:hover:not(:disabled) { background: rgb(0 0 0 / 0.7); }
        .compare__zoom-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
