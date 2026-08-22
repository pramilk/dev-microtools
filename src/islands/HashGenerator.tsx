import { useEffect, useState } from 'preact/hooks';
import { hashAll, digestsMatch, type HashAlgorithm } from '../lib/tools/hash';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';

interface Digest {
  algorithm: HashAlgorithm;
  digest: string;
}

/** MD5 and SHA-1 are broken for security use; the UI has to say so. */
const INSECURE: Partial<Record<HashAlgorithm, string>> = {
  MD5: 'Broken — collisions are trivial. Use only for checksums, never for passwords or signatures.',
  'SHA-1': 'Deprecated — practical collisions exist. Do not use for new security work.',
};

export default function HashGenerator() {
  const [input, setInput] = useState('');
  const [digests, setDigests] = useState<Digest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [compareTo, setCompareTo] = useState('');

  useEffect(() => {
    if (input === '') {
      setDigests([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setBusy(true);

    void hashAll(input).then((result) => {
      // Guard against an out-of-order response overwriting newer input.
      if (cancelled) return;
      setBusy(false);
      if (result.ok) {
        setDigests(result.value);
        setError(null);
      } else {
        setDigests([]);
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [input]);

  const trimmedCompare = compareTo.trim();
  const matched = trimmedCompare
    ? digests.find((entry) => digestsMatch(entry.digest, trimmedCompare))
    : undefined;

  return (
    <div class="tool">
      <div class="field">
        <label class="field__label" for="hash-input">
          <span>Text to hash</span>
          <span class="field__hint">{input.length.toLocaleString()} characters</span>
        </label>
        <textarea
          id="hash-input"
          class="textarea textarea--short"
          spellcheck={false}
          autocomplete="off"
          placeholder="Type or paste the text you want to hash…"
          value={input}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
        />
      </div>

      <div class="tool-bar">
        <button
          type="button"
          class="btn"
          onClick={() => setInput('')}
          disabled={input === ''}
          title="Clear the input and start over"
        >
          Clear
        </button>
        {busy && <span class="field__hint">Hashing…</span>}
      </div>

      <ErrorMessage message={error} />

      {digests.length > 0 && (
        <div class="hash-list">
          {digests.map(({ algorithm, digest }) => (
            <div
              key={algorithm}
              class={`hash-row${matched?.algorithm === algorithm ? ' hash-row--matched' : ''}`}
            >
              <div class="hash-row__head">
                <span class="hash-row__name">{algorithm}</span>
                {INSECURE[algorithm] && (
                  <span class="hash-row__warn" title={INSECURE[algorithm]}>
                    insecure
                  </span>
                )}
                <span class="tool-bar__spacer" />
                <CopyButton value={digest} describe={`${algorithm} digest`} />
              </div>
              <code class="hash-row__digest">{digest}</code>
              {INSECURE[algorithm] && <p class="hash-row__note">{INSECURE[algorithm]}</p>}
            </div>
          ))}
        </div>
      )}

      {digests.length > 0 && (
        <div class="field">
          <label class="field__label" for="hash-compare">
            <span>Compare against a known digest</span>
            <span class="field__hint">Checks all algorithms at once</span>
          </label>
          <input
            id="hash-compare"
            class="input"
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste a checksum to verify it matches…"
            value={compareTo}
            onInput={(event) => setCompareTo((event.target as HTMLInputElement).value)}
          />
          {trimmedCompare !== '' &&
            (matched ? (
              <p class="msg msg--success">
                <span class="msg__icon" aria-hidden="true">
                  ✓
                </span>
                <span>Match — this is the {matched.algorithm} digest of your input.</span>
              </p>
            ) : (
              <p class="msg msg--warning">
                <span class="msg__icon" aria-hidden="true">
                  !
                </span>
                <span>No match against any algorithm above.</span>
              </p>
            ))}
        </div>
      )}

      <style>{`
        .hash-list { display: flex; flex-direction: column; gap: var(--space-3); }
        .hash-row {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface);
          padding: var(--space-3);
          display: flex; flex-direction: column; gap: var(--space-2);
        }
        .hash-row--matched { border-color: var(--success-border); background: var(--success-subtle); }
        .hash-row__head { display: flex; align-items: center; gap: var(--space-2); }
        .hash-row__name {
          font-family: var(--font-mono); font-weight: 650; font-size: var(--text-sm);
        }
        .hash-row__warn {
          font-size: var(--text-xs); font-weight: 600; text-transform: uppercase;
          letter-spacing: .06em; color: var(--warning);
          background: var(--warning-subtle); border: 1px solid var(--warning-border);
          border-radius: 99px; padding: 0 .5em;
        }
        .hash-row__digest {
          font-family: var(--font-mono); font-size: var(--text-sm);
          word-break: break-all; color: var(--text); line-height: 1.5;
        }
        .hash-row__note { font-size: var(--text-xs); color: var(--text-muted); margin: 0; }
      `}</style>
    </div>
  );
}
