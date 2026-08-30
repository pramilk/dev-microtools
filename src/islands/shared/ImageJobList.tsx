import type { ComponentChildren } from 'preact';
import { formatBytes } from './formatBytes';
import { SavingsBadge } from './SavingsBadge';

export interface ImageJobRowProps {
  /** React/Preact list key — not rendered. */
  key: string;
  selected: boolean;
  onSelect: () => void;
  thumbUrl: string;
  checkerboard: boolean;
  /** A per-row control overlaid on the thumbnail — e.g. Image Compressor's per-image "keep original format" lock. Omit for tools with nothing to overlay. */
  thumbOverlay?: ComponentChildren;
  fileName: string;
  /** The name shown and used for the accessible row label — usually the *output* filename, which can differ from `fileName` once a format conversion is picked. */
  displayName: string;
  hasResult: boolean;
  sizeBeforeBytes?: number;
  sizeAfterBytes?: number;
  busy: boolean;
  /** Shown next to the spinner only while busy and no prior result exists yet to keep showing instead. */
  busyLabel: string;
  errorFlag: boolean;
  /** Tooltip for a warning triangle (e.g. "transparency lost") — omit to show no warning. */
  warningTitle?: string;
  onDownload?: () => void;
  downloadTitle?: string;
  onRemove: () => void;
}

/**
 * One row in a batch image tool's job list: thumbnail, name/size, live status (busy/error/
 * warning/savings), and download/remove actions. Selecting a row is how every batch image
 * tool (Image Compressor, Image Format Converter) picks which job's full detail panel shows
 * below the list.
 */
function ImageJobRow(props: ImageJobRowProps) {
  const {
    selected,
    onSelect,
    thumbUrl,
    checkerboard,
    thumbOverlay,
    fileName,
    displayName,
    hasResult,
    sizeBeforeBytes,
    sizeAfterBytes,
    busy,
    busyLabel,
    errorFlag,
    warningTitle,
    onDownload,
    downloadTitle,
    onRemove,
  } = props;
  const hasSizes = hasResult && sizeBeforeBytes !== undefined && sizeAfterBytes !== undefined;

  return (
    <li class={`job${selected ? ' job--selected' : ''}`}>
      <span class="job__thumb-group">
        <img src={thumbUrl} alt="" class={`job__thumb${checkerboard ? ' job__thumb--checkerboard' : ''}`} />
        {thumbOverlay}
      </span>
      <button type="button" class="job__select" aria-pressed={selected} onClick={onSelect} title={`View ${fileName}`}>
        <span class="job__info">
          <span class="job__name">{displayName}</span>
          {hasSizes && (
            <span class="job__size field__hint">
              {formatBytes(sizeBeforeBytes!)} → {formatBytes(sizeAfterBytes!)}
            </span>
          )}
        </span>
        {/* Keeps showing the last result while a re-run happens in the background (status
            flips back to busy on every settings change) — hiding these every tick made the
            row, the totals banner, and the rest of the page jump as items shifted in and out.
            The spinner is what actually signals "this is stale, working on it". */}
        {busy && <span class="job__spinner" aria-hidden="true" />}
        {busy && !hasResult && <span class="field__hint">{busyLabel}</span>}
        {errorFlag && <span class="job__error-flag">Error</span>}
        {warningTitle && (
          <span class="job__warning-flag" aria-hidden="true" title={warningTitle}>
            ⚠
          </span>
        )}
        {hasSizes && <SavingsBadge beforeBytes={sizeBeforeBytes!} afterBytes={sizeAfterBytes!} />}
      </button>
      <span class="job__actions">
        {hasResult && onDownload && (
          <button type="button" class="btn" onClick={onDownload} title={downloadTitle}>
            <span aria-hidden="true">⭳</span> Download
          </button>
        )}
        <button type="button" class="btn" onClick={onRemove} title={`Remove ${fileName}`} aria-label={`Remove ${fileName}`}>
          ✕
        </button>
      </span>
    </li>
  );
}

/** Compact, clickable gallery — select a row to view its full comparison below, rather than stacking a full preview under every single image. */
export function ImageJobList({ items }: { items: ImageJobRowProps[] }) {
  return (
    <>
      <ul class="job-list">
        {items.map((item) => (
          <ImageJobRow {...item} />
        ))}
      </ul>
      <style>{`
        .job-list { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .job {
          display: flex; align-items: center; gap: var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
          padding: var(--space-2);
        }
        .job--selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .job__select {
          display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0;
          background: none; border: none; padding: 0; margin: 0; text-align: left; cursor: pointer; color: inherit; font: inherit;
        }
        /* Sits outside .job__select (a <button>) rather than inside it — nested interactive
           controls (a button inside a button) aren't valid HTML. */
        .job__thumb-group { position: relative; flex-shrink: 0; display: inline-flex; }
        .job__thumb { width: 2.5rem; height: 2.5rem; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); }
        .job__thumb--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
        }
        .job__lock {
          position: absolute; bottom: -0.35rem; right: -0.35rem; display: flex; align-items: center; justify-content: center;
          width: 1.15rem; height: 1.15rem; font-size: 0.65rem; line-height: 1;
          background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          padding: 0; cursor: pointer; box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
        }
        .job__lock[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-subtle); }
        .job__info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .job__name { font-family: var(--font-mono); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .job__size { font-size: var(--text-xs); }
        .job__actions { display: flex; gap: var(--space-2); flex-shrink: 0; }
        .job__error-flag { font-size: var(--text-sm); font-weight: 600; color: var(--danger); }
        .job__warning-flag { color: var(--warning); font-size: var(--text-base); line-height: 1; cursor: help; }
        .job__spinner {
          display: inline-block; width: 0.9rem; height: 0.9rem; flex-shrink: 0;
          border: 2px solid var(--border-strong); border-top-color: var(--accent);
          border-radius: 50%; animation: image-job-spin 0.6s linear infinite; vertical-align: -0.15em;
        }
        @media (prefers-reduced-motion: reduce) {
          .job__spinner { animation-duration: 1.5s; }
        }
        @keyframes image-job-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
