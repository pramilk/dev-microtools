import { useEffect, useMemo, useState } from 'preact/hooks';
import { toSideBySideRows, toAnnotatedText, type DiffMode, type DiffSummary } from '../lib/tools/diff';
import { readShareStateFromLocation } from '../lib/shareLink';
import { consumeHandoff } from '../lib/crossToolHandoff';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';
import { useWorkerTask } from './shared/useWorkerTask';
import DiffWorker from '../workers/diff.worker?worker';
import type { DiffWorkerRequest } from '../workers/diff.worker';

type Kind = 'text' | 'json';
type View = 'inline' | 'side-by-side';

interface ShareState {
  left: string;
  right: string;
  kind: Kind;
  mode: DiffMode;
  view: View;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}

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
  const [busy, setBusy] = useState(false);

  const diffWorkerTask = useWorkerTask<DiffWorkerRequest, DiffSummary>(() => new DiffWorker());

  const leftDrop = useTextFileDrop(setLeft);
  const rightDrop = useTextFileDrop(setRight);

  // Side-by-side pairs up lines, so it only makes sense for a line-level comparison —
  // JSON diffs are always line-level internally, text diffs only when that granularity
  // is selected. Falling back to inline otherwise avoids a toggle that renders nonsense.
  const canSideBySide = kind === 'json' || mode === 'line';
  const effectiveView = canSideBySide ? view : 'inline';

  const sideBySideRows = useMemo(
    () => (effectiveView === 'side-by-side' && summary ? toSideBySideRows(summary.parts) : []),
    [effectiveView, summary]
  );

  const diffText = useMemo(() => (summary ? toAnnotatedText(summary.parts) : ''), [summary]);

  const applyRestoredState = (state: ShareState) => {
    setLeft(state.left);
    setRight(state.right);
    setKind(state.kind);
    setMode(state.mode);
    // Fall back for links made before `view` was shared, rather than restoring `undefined`.
    setView(state.view ?? 'inline');
    setIgnoreCase(state.ignoreCase);
    setIgnoreWhitespace(state.ignoreWhitespace);
  };

  // Restore state from another tool's "open this here" handoff (e.g. Duplicate Line
  // Remover's "View diff"), or from a shared link, if the page was opened with either.
  // The handoff takes priority — it's a one-shot, same-session action with no size cap,
  // so if one is present it's always the freshest, most specific thing to show.
  useEffect(() => {
    const handoff = consumeHandoff<ShareState>('diff-checker');
    if (handoff) {
      applyRestoredState(handoff);
      return;
    }

    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      applyRestoredState(restored.value);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    if (left === '' && right === '') {
      setSummary(null);
      setError(null);
      setBusy(false);
      return;
    }

    let cancelled = false;
    setBusy(true);

    const request: DiffWorkerRequest =
      kind === 'json' ? { kind: 'json', left, right } : { kind: 'text', left, right, mode, ignoreCase, ignoreWhitespace };

    diffWorkerTask.run(request).then(
      (result) => {
        // Discard a stale response so fast typing cannot show an outdated diff.
        if (cancelled) return;
        setBusy(false);
        setSummary(result);
        setError(null);
      },
      (thrown: unknown) => {
        if (cancelled) return;
        setBusy(false);
        setSummary(null);
        setError(thrown instanceof Error ? thrown.message : 'Could not compare those texts.');
      }
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <ShareLinkButton
          getState={() => ({ left, right, kind, mode, view, ignoreCase, ignoreWhitespace })}
          describe="this comparison"
        />
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
          Load example
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
            class={`textarea textarea--tall${leftDrop.isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste the original text, or drop a file here…"
            value={left}
            onInput={(event) => setLeft((event.target as HTMLTextAreaElement).value)}
            {...leftDrop.dropHandlers}
          />
        </div>

        <div class="field">
          <label class="field__label" for="diff-right">
            <span>Compare with</span>
            <span class="field__hint">{right.split('\n').length} lines</span>
          </label>
          <textarea
            id="diff-right"
            class={`textarea textarea--tall${rightDrop.isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste the text to compare with, or drop a file here…"
            value={right}
            onInput={(event) => setRight((event.target as HTMLTextAreaElement).value)}
            {...rightDrop.dropHandlers}
          />
        </div>
      </div>

      <ErrorMessage message={error} />

      {busy && (
        <p class="field__hint">
          <span class="job__spinner" aria-hidden="true" /> Comparing…
        </p>
      )}

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
                <span class="tool-bar__group">
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
                    <span
                      class="seg__tip"
                      title={
                        canSideBySide
                          ? 'Show the two versions in two columns, lined up row by row'
                          : 'Only available when comparing by line — switch granularity to "By line" to use this'
                      }
                    >
                      <button
                        type="button"
                        class="seg__btn"
                        aria-pressed={effectiveView === 'side-by-side'}
                        disabled={!canSideBySide}
                        onClick={() => setView('side-by-side')}
                      >
                        Side by side
                      </button>
                    </span>
                  </div>
                  <CopyButton value={diffText} describe="the differences ([-removed-] / {+added+})" />
                  <DownloadButton
                    value={diffText}
                    filename="diff.txt"
                    describe="the differences ([-removed-] / {+added+})"
                  />
                </span>
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
