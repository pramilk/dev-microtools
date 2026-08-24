import { compressionSavings } from './compressionStats';

interface Props {
  beforeBytes: number;
  afterBytes: number;
  large?: boolean;
}

/**
 * The size reduction is the entire reason to use a compression tool, so it gets a bold,
 * colored pill rather than quiet muted text like every other secondary stat on a tool page.
 */
export function SavingsBadge({ beforeBytes, afterBytes, large = false }: Props) {
  const savings = compressionSavings(beforeBytes, afterBytes);
  const tone = savings.direction === 'smaller' ? 'success' : savings.direction === 'larger' ? 'warning' : 'neutral';
  const text = savings.direction === 'same' ? 'No change' : `${savings.percent}% ${savings.direction}`;

  return (
    <>
      <span class={`savings-badge savings-badge--${tone}${large ? ' savings-badge--lg' : ''}`}>{text}</span>
      <style>{`
        .savings-badge {
          display: inline-flex; align-items: center; font-weight: 700; line-height: 1.4;
          border-radius: 999px; padding: 0.1em 0.75em; font-size: var(--text-sm); white-space: nowrap;
          background: var(--success-subtle); color: var(--success); border: 1px solid var(--success-border);
        }
        .savings-badge--warning { background: var(--warning-subtle); color: var(--warning); border-color: var(--warning-border); }
        .savings-badge--neutral { background: var(--surface-2); color: var(--text-muted); border-color: var(--border); }
        .savings-badge--lg { font-size: var(--text-xl); padding: 0.15em 0.9em; }
      `}</style>
    </>
  );
}
