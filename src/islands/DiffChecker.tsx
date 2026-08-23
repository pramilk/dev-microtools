import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  compareTexts,
  compareJson,
  toSideBySideRows,
  type DiffMode,
  type DiffSummary,
} from '../lib/tools/diff';
import { ErrorMessage } from './shared/ErrorMessage';

type Kind = 'text' | 'json';
type View = 'inline' | 'side-by-side';

const SAMPLE_JSON_LEFT = `{
  "name": "billing-service",
  "version": "1.2.0",
  "port": 8080,
  "debug": false
}`;
const SAMPLE_JSON_RIGHT = `{
  "name": "billing-service",
  "version": "1.3.0",
  "port": 8080,
  "timeout": 30,
  "debug": true
}`;

const SAMPLE_TEXT_LEFT = `Welcome to Dev Microtools.
This site offers free browser-based utilities for developers.
All processing happens locally in your browser.`;
const SAMPLE_TEXT_RIGHT = `Welcome to Dev Microtools!
This site offers free, fast browser-based utilities for developers.
All processing happens locally in your browser.
Nothing you paste is ever uploaded.`;

export default function DiffChecker() {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [kind, setKind] = useState<Kind>('text');
  const [mode, setMode] = useState<DiffMode>('line');
  const [view, setView] = useState<View>('inline');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);

  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Side-by-side pairs up lines, so it only makes sense for a line-level comparison —
  // JSON diffs are always line-level internally, text diffs only when that granularity
  // is selected. Falling back to inline otherwise avoids a toggle that renders nonsense.
  const canSideBySide = kind === 'json' || mode === 'line';
  const effectiveView = canSideBySide ? view : 'inline';

  const sideBySideRows = useMemo(
    () => (effectiveView === 'side-by-side' && summary ? toSideBySideRows(summary.parts) : []),
    [effectiveView, summary]
  );

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
            if (kind === 'json') {
              setLeft(SAMPLE_JSON_LEFT);
              setRight(SAMPLE_JSON_RIGHT);
            } else {
              setLeft(SAMPLE_TEXT_LEFT);
              setRight(SAMPLE_TEXT_RIGHT);
            }
          }}
          title={
            kind === 'json'
              ? 'Load two example JSON documents — a version bump, an added field and a changed flag — to see how the tool reports changes'
              : 'Load two example paragraphs — a changed line, an unchanged line and an added line — to see how the tool reports changes'
          }
        >
          Load sample
        </button>
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
            <span>Compare with</span>
            <span class="field__hint">{right.split('\n').length} lines</span>
          </label>
          <textarea
            id="diff-right"
            class="textarea textarea--tall"
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste the text to compare with…"
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
              <div class="field__label">
                <span>Differences</span>
                <div class="seg" role="group" aria-label="Layout">
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={effectiveView === 'inline'}
                    onClick={() => setView('inline')}
                    title="Show one merged view with removed lines struck through and added lines highlighted"
                  >
                    Inline
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={effectiveView === 'side-by-side'}
                    disabled={!canSideBySide}
                    onClick={() => setView('side-by-side')}
                    title={
                      canSideBySide
                        ? 'Show the two versions in two columns, lined up row by row'
                        : 'Only available when comparing by line — switch granularity to "By line" to use this'
                    }
                  >
                    Side by side
                  </button>
                </div>
              </div>

              {effectiveView === 'inline' ? (
                <>
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
                </>
              ) : (
                <>
                  <div class="diff-side-by-side" aria-label="Differences, shown in two aligned columns">
                    {sideBySideRows.map((row, index) => (
                      <div key={index} class={`diff-row diff-row--${row.type}`}>
                        <span class="diff-row__num">{row.leftLine ?? ''}</span>
                        <span class="diff-row__cell diff-row__cell--left">{row.left ?? ''}</span>
                        <span class="diff-row__num">{row.rightLine ?? ''}</span>
                        <span class="diff-row__cell diff-row__cell--right">{row.right ?? ''}</span>
                      </div>
                    ))}
                  </div>
                  <p class="field__hint">
                    A line only on the left was removed, a line only on the right was added, and
                    a line coloured on both sides changed.
                  </p>
                </>
              )}
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
        .diff-side-by-side {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); font-family: var(--font-mono); font-size: var(--text-sm);
          max-height: 26rem; overflow: auto;
        }
        .diff-row {
          display: grid; grid-template-columns: 2.5rem 1fr 2.5rem 1fr;
          border-bottom: 1px solid var(--border);
        }
        .diff-row:last-child { border-bottom: none; }
        .diff-row__num {
          padding: .15em .5em; text-align: right; color: var(--text-subtle);
          font-size: var(--text-xs); user-select: none; border-right: 1px solid var(--border);
        }
        .diff-row__cell {
          padding: .15em .6em; white-space: pre-wrap; word-break: break-word;
          border-right: 1px solid var(--border);
        }
        .diff-row--removed .diff-row__cell--left,
        .diff-row--changed .diff-row__cell--left {
          background: var(--danger-subtle); color: var(--danger);
        }
        .diff-row--added .diff-row__cell--right,
        .diff-row--changed .diff-row__cell--right {
          background: var(--success-subtle); color: var(--success);
        }
      `}</style>
    </div>
  );
}
