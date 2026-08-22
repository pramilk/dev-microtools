import { useCopy } from './useCopy';

interface Props {
  /** Text to place on the clipboard. Empty disables the button. */
  value: string;
  label?: string;
  /** Announced to screen readers so the confirmation is not visual-only. */
  describe?: string;
}

const LABELS: Record<string, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Copy failed',
};

/** The single copy control used by every tool, so the behaviour never varies. */
export function CopyButton({ value, label, describe = 'result' }: Props) {
  const { state, copy } = useCopy();
  const disabled = value === '';

  const text = state === 'idle' ? (label ?? LABELS.idle) : LABELS[state];

  return (
    <>
      <button
        type="button"
        class={`btn${state === 'copied' ? ' btn--copied' : ''}`}
        onClick={() => void copy(value)}
        disabled={disabled}
        title={disabled ? 'Nothing to copy yet' : `Copy ${describe} to clipboard`}
      >
        <span aria-hidden="true">{state === 'copied' ? '✓' : '⧉'}</span>
        {text}
      </button>
      <span role="status" aria-live="polite" class="sr-only">
        {state === 'copied' ? `${describe} copied to clipboard` : ''}
        {state === 'failed' ? 'Copy failed. Select the text and copy manually.' : ''}
      </span>
    </>
  );
}
