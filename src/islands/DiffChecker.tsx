import { useEffect, useState } from 'preact/hooks';
import { compareTexts, compareJson, type DiffMode, type DiffSummary } from '../lib/tools/diff';
import { ErrorMessage } from './shared/ErrorMessage';

type Kind = 'text' | 'json';

export default function DiffChecker() {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [kind, setKind] = useState<Kind>('text');
  const [mode, setMode] = useState<DiffMode>('line');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);

  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (left === '' && right === '') {
      setSummary(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const work =
      kind === 'json'
        ? compareJson(left, right)
        : compareTexts(left, right, mode, { ignoreCase, ignoreWhitespace });

    void work.then((result) => {
      // Discard a stale response so fast typing cannot show an outdated diff.
      if (cancelled) return;
      if (result.ok) {
        setSummary(result.value);
        setError(null);
      } else {
        setSummary(null);
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [left, right, kind, mode, ignoreCase, ignoreWhitespace]);

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Comparison type">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={kind === 'text'}
            onClick={() => setKind('text')}
            title="Compare as plain text, respecting exact formatting"
          >
            Text
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={kind === 'json'}
            onClick={() => setKind('json')}
            title="Normalises both sides so formatting differences are ignored"
          >
            JSON
          </button>
        </div>

        {kind === 'text' && (
          <div class="seg" role="group" aria-label="Granularity">
            {(['line', 'word', 'char'] as const).map((value) => (
              <button
                key={value}
                type="button"
                class="seg__btn"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                title={
                  value === 'line'
                    ? 'Treat each line as one unit — best for code and config'
                    : value === 'word'
                      ? 'Treat each word as one unit — best for prose'
                      : 'Treat each character as one unit — best for short strings'
                }
              >
                By {value}
              </button>
            ))}
          </div>
        )}

        <span class="tool-bar__spacer" />
        <button
          type="button"
          class="btn"
          onClick={() => {
            setLeft('');
            setRight('');
          }}
          disabled={left === '' && right === ''}
          title="Clear both panes and start over"
        >
          Clear both
        </button>
      </div>

      {kind === 'text' && (
        <div class="tool-bar">
          <label class="checkbox" title="Treat uppercase and lowercase letters as equivalent">
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(event) => setIgnoreCase((event.target as HTMLInputElement).checked)}
            />
            Ignore case
          </label>
          <label
            class="checkbox"
            title="Ignore leading/trailing whitespace on each line — internal spacing still counts"
          >
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={(event) => setIgnoreWhitespace((event.target as HTMLInputElement).checked)}
            />
            Ignore indentation
          </label>
        </div>
      )}

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="diff-left">
            <span>Original</span>
            <span class="field__hint">{left.split('\n').length} lines</span>
          </label>
          <textarea
            id="diff-left"
            class="textarea textarea--tall"
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste the original text…"
            value={left}
            onInput={(event) => setLeft((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <div class="field">
          <label class="field__label" for="diff-right">
            <span>Changed</span>
            <span class="field__hint">{right.split('\n').length} lines</span>
          </label>
          <textarea
            id="diff-right"
            class="textarea textarea--tall"
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste the changed text…"
            value={right}
            onInput={(event) => setRight((event.target as HTMLTextAreaElement).value)}
          />
        </div>
      </div>

      <ErrorMessage message={error} />

      {summary && (
        <>
          <p class="stats">
            <span class="stats__item diff-added">
              <strong>+{summary.added.toLocaleString()}</strong> added
            </span>
            <span class="stats__item diff-removed">
              <strong>−{summary.removed.toLocaleString()}</strong> removed
            </span>
            <span class="stats__item">
              <strong>{summary.unchanged.toLocaleString()}</strong> unchanged
            </span>
          </p>

          {summary.identical ? (
            <p class="msg msg--success">
              <span class="msg__icon" aria-hidden="true">
                ✓
              </span>
              <span>
                {kind === 'json'
                  ? 'These two documents are equivalent JSON — only the formatting differs.'
                  : 'The two texts are identical.'}
              </span>
            </p>
          ) : (
            <div class="field">
              <span class="field__label">Differences</span>
              <div class="diff-view" aria-label="Differences between the two texts">
                {summary.parts.map((part, index) => (
                  <span
                    key={index}
                    class={
                      part.type === 'added'
                        ? 'diff-part diff-part--added'
                        : part.type === 'removed'
                          ? 'diff-part diff-part--removed'
                          : 'diff-part'
                    }
                  >
                    {part.value}
                  </span>
                ))}
              </div>
              <p class="field__hint">
                <span class="diff-key diff-key--added">Green</span> is added,{' '}
                <span class="diff-key diff-key--removed">red</span> is removed.
              </p>
            </div>
          )}
        </>
      )}

      <style>{`
        .diff-added strong { color: var(--success); }
        .diff-removed strong { color: var(--danger); }
        .diff-view {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); padding: var(--space-3);
          font-family: var(--font-mono); font-size: var(--text-sm);
          white-space: pre-wrap; word-break: break-word; line-height: 1.6;
          max-height: 26rem; overflow-y: auto;
        }
        .diff-part--added {
          background: var(--success-subtle); color: var(--success);
          text-decoration: none; border-radius: 2px;
        }
        .diff-part--removed {
          background: var(--danger-subtle); color: var(--danger);
          text-decoration: line-through; border-radius: 2px;
        }
        .diff-key { padding: 0 .35em; border-radius: 2px; font-weight: 600; }
        .diff-key--added { background: var(--success-subtle); color: var(--success); }
        .diff-key--removed { background: var(--danger-subtle); color: var(--danger); }
      `}</style>
    </div>
  );
}
