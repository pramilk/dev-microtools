import { formatBytes } from './formatBytes';
import { SavingsBadge } from './SavingsBadge';

interface Props {
  totalBeforeBytes: number;
  totalAfterBytes: number;
  count: number;
  zipping: boolean;
  onDownloadAll: () => void;
  downloadAllTitle: string;
}

/** The prominent "N images, X → Y total, download them all as a zip" banner shown once at least one job in a batch has finished — identical across every batch image tool bar the wording of `downloadAllTitle`. */
export function BatchSavingsBanner({ totalBeforeBytes, totalAfterBytes, count, zipping, onDownloadAll, downloadAllTitle }: Props) {
  return (
    <div class="savings-banner" data-testid="total-savings">
      <SavingsBadge beforeBytes={totalBeforeBytes} afterBytes={totalAfterBytes} large />
      <span class="field__hint">
        {formatBytes(totalBeforeBytes)} → {formatBytes(totalAfterBytes)} across {count} image{count === 1 ? '' : 's'}
      </span>
      <span class="tool-bar__spacer" />
      <button type="button" class="btn btn--primary" onClick={onDownloadAll} disabled={zipping} title={downloadAllTitle}>
        <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : `Download all (${count})`}
      </button>
      <style>{`
        .savings-banner {
          display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
          margin: var(--space-4) 0 0; padding: var(--space-3); border-radius: var(--radius-lg);
          background: var(--surface); border: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
