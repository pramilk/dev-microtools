import { useState } from 'preact/hooks';
import { buildShareUrl } from '../../lib/shareLink';
import { useCopy } from './useCopy';

interface Props {
  /** Called only when the button is pressed, so it always reads the latest state. */
  getState: () => unknown;
  /** Used in the button's tooltip, e.g. "this pattern". */
  describe?: string;
}

/**
 * Copies a link that restores the tool's current input, so a result can be shared
 * without a backend — the state is compressed and encoded straight into the URL.
 */
export function ShareLinkButton({ getState, describe = 'this' }: Props) {
  const { state, copy } = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    setBusy(true);
    setError(null);
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const result = await buildShareUrl(baseUrl, getState());
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    await copy(result.value);
  };

  const label = busy
    ? 'Preparing…'
    : state === 'copied'
      ? 'Link copied'
      : state === 'failed'
        ? 'Copy failed'
        : 'Copy link';

  return (
    <>
      <button
        type="button"
        class={`btn${state === 'copied' ? ' btn--copied' : ''}`}
        onClick={() => void share()}
        disabled={busy}
        title={`Copy a link that restores ${describe}`}
      >
        <span aria-hidden="true">{state === 'copied' ? '✓' : '🔗'}</span> {label}
      </button>
      {error && (
        <p class="msg msg--warning" role="alert">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>{error}</span>
        </p>
      )}
    </>
  );
}
