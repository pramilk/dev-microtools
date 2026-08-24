import { useRef, useState } from 'preact/hooks';

interface Props {
  beforeUrl: string;
  afterUrl: string;
  /** Pixel dimensions of the compared images, when known — used to size the stage at the right aspect ratio. Omit for a fixed-height box (e.g. vector content with no fixed pixel size), which still displays correctly via `object-fit: contain`. */
  width?: number;
  height?: number;
  beforeLabel?: string;
  afterLabel?: string;
}

/**
 * Before/after comparison. Dragging directly on the image is the primary, most intuitive
 * interaction; the underlying `<input type="range">` stays fully wired for keyboard and
 * screen-reader use but is visually hidden (`sr-only`) rather than duplicated on screen,
 * since dragging on the image is the interaction most people reach for.
 */
export function CompareSlider({ beforeUrl, afterUrl, width, height, beforeLabel = 'Original', afterLabel = 'Compressed' }: Props) {
  const [split, setSplit] = useState(50);
  const stageRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(100, Math.max(0, Math.round(percent))));
  };

  return (
    <div class="compare">
      <div
        class="compare__stage"
        ref={stageRef}
        style={width && height ? `aspect-ratio:${width}/${height}` : 'height:16rem'}
        onPointerDown={(event) => {
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          updateFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          updateFromClientX(event.clientX);
        }}
      >
        <img src={beforeUrl} alt={beforeLabel} class="compare__img" draggable={false} />
        {/* Clipped from the right, so this ("after") image is what's revealed on the LEFT
            as split grows — the unclipped "before" image underneath shows through on the
            right. The two badges below are positioned to match that, not by before/after. */}
        <div class="compare__after" style={`clip-path: inset(0 ${100 - split}% 0 0)`}>
          <img src={afterUrl} alt={afterLabel} class="compare__img" draggable={false} />
        </div>
        <div class="compare__divider" style={`left:${split}%`} aria-hidden="true">
          <span class="compare__handle" />
        </div>
        <span class="compare__badge compare__badge--left" aria-hidden="true">
          {afterLabel}
        </span>
        <span class="compare__badge compare__badge--right" aria-hidden="true">
          {beforeLabel}
        </span>
      </div>
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
        .compare__stage {
          position: relative; width: 100%; max-height: 22rem; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2);
          cursor: ew-resize; touch-action: none; user-select: none;
        }
        .compare__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
        .compare__after { position: absolute; inset: 0; }
        .compare__divider {
          position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent-contrast);
          box-shadow: 0 0 0 1px var(--accent); transform: translateX(-1px); pointer-events: none;
          display: flex; align-items: center; justify-content: center;
        }
        .compare__handle {
          position: relative; flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 999px; background: var(--accent);
          border: 2px solid var(--accent-contrast); box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
        }
        .compare__handle::before, .compare__handle::after {
          content: ''; position: absolute; top: 50%; width: 0; height: 0;
          border-top: 4px solid transparent; border-bottom: 4px solid transparent;
        }
        .compare__handle::before { border-right: 5px solid var(--accent-contrast); left: 0.45rem; transform: translateY(-50%); }
        .compare__handle::after { border-left: 5px solid var(--accent-contrast); right: 0.45rem; transform: translateY(-50%); }

        /* Fixed to the stage's own corners (not the moving divider) so it's always clear
           which side is which, no matter where the slider is dragged. Hardcoded dark/light
           colors rather than theme tokens — these sit on top of arbitrary photo/SVG content,
           not page background, so they need to stay readable regardless of theme or image. */
        .compare__badge {
          position: absolute; top: var(--space-2); z-index: 1; pointer-events: none;
          background: rgb(0 0 0 / 0.65); color: #fff; font-size: var(--text-xs); font-weight: 600;
          padding: 0.15rem 0.5rem; border-radius: var(--radius-sm); letter-spacing: 0.02em;
        }
        .compare__badge--left { left: var(--space-2); }
        .compare__badge--right { right: var(--space-2); }
      `}</style>
    </div>
  );
}
