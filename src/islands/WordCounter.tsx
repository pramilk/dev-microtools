import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  computeStats,
  convertCase,
  findMatches,
  replaceAll,
  toHighlightSegments,
  CASE_TYPES,
  CASE_LABELS,
  type CaseType,
} from '../lib/tools/wordCounter';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { CopyButton } from './shared/CopyButton';
import { useTextFileDrop } from './shared/useTextFileDrop';
import { useCopy } from './shared/useCopy';

const SAMPLE = `The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquid jugs!

Word Counter runs entirely in your browser — nothing you type is ever uploaded. Try the case buttons below, or search for a word to see it highlighted.`;

interface ShareState {
  input: string;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

export default function WordCounter() {
  const [input, setInput] = useState('');
  // The last text the user actually typed, pasted, dropped, or replaced — as opposed to
  // `input`, which is what's currently displayed. Case buttons always convert from this,
  // not from `input`, so switching from PascalCase to Title Case (say) performs Title Case
  // on the original text rather than re-casing an already-cased result. A direct edit to
  // the textarea re-syncs the two, so typing after a case conversion "adopts" it as the new
  // base rather than being silently discarded on the next case click.
  const [baseText, setBaseText] = useState('');
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);

  const setText = (value: string) => {
    setInput(value);
    setBaseText(value);
  };

  const { isDragActive, dropHandlers } = useTextFileDrop(setText);
  const { state: reportCopyState, copy: copyReport } = useCopy();
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setText(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const stats = useMemo(() => computeStats(input), [input]);

  const matches = useMemo(
    () => (showFindReplace ? findMatches(input, findQuery, caseSensitive) : []),
    [showFindReplace, input, findQuery, caseSensitive]
  );

  // Computed unconditionally (not just while a search is active) so the highlight overlay
  // behind the textarea always mirrors the full text — with no active matches this is just
  // one unmatched segment covering everything, which keeps the overlay's height in sync
  // with the real textarea at all times, not just while searching.
  const segments = useMemo(() => toHighlightSegments(input, matches), [input, matches]);

  const applyCase = (type: CaseType) => setInput(convertCase(baseText, type));

  const handleReplaceAll = () => {
    setText(replaceAll(input, findQuery, replaceQuery, caseSensitive));
  };

  const buildReport = () =>
    [
      `Words: ${stats.words.toLocaleString()}`,
      `Characters: ${stats.characters.toLocaleString()}`,
      `Characters (no spaces): ${stats.charactersNoSpaces.toLocaleString()}`,
      `Sentences: ${stats.sentences.toLocaleString()}`,
      `Paragraphs: ${stats.paragraphs.toLocaleString()}`,
      `Lines: ${stats.lines.toLocaleString()}`,
      `Unique words: ${stats.uniqueWords.toLocaleString()}`,
      `Average word length: ${stats.avgWordLength.toFixed(1)} characters`,
      `Average sentence length: ${stats.avgSentenceLength.toFixed(1)} words`,
      `Estimated syllables: ${stats.syllables.toLocaleString()}`,
      `Reading time: ${formatDuration(stats.readingTimeSeconds)}`,
      `Speaking time: ${formatDuration(stats.speakingTimeSeconds)}`,
    ].join('\n');

  const clearAll = () => {
    setText('');
    setFindQuery('');
    setReplaceQuery('');
  };

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input })} describe="this text" />
        <button type="button" class="btn" onClick={() => setText(SAMPLE)} title="Load example text">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="wc-input">
          <span>Text</span>
          <span class="field__hint">{stats.words.toLocaleString()} words</span>
        </label>
        {/* A find/replace match highlight rendered *inside* the same box the user is
            already editing, rather than a second read-only copy of the text below it.
            A <textarea> can't render inline <mark> highlights itself, so this overlays a
            matching backdrop <div> (identical font/padding/border via the same .textarea
            class) behind a textarea with a transparent background — both share one CSS
            grid cell so they stay pixel-aligned, including when the user drags the resize
            handle, and scroll position is kept in sync on every scroll event. */}
        <div class="wc-editor">
          <div class="wc-editor__backdrop textarea textarea--tall" aria-hidden="true" ref={backdropRef}>
            {segments.map((segment, index) =>
              segment.isMatch ? (
                <mark key={index} class="highlight__match">
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </div>
          <textarea
            id="wc-input"
            class={`wc-editor__textarea textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            placeholder="Paste or type text here, or drop a .txt file…"
            value={input}
            onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
            onScroll={(event) => {
              const backdrop = backdropRef.current;
              if (!backdrop) return;
              const el = event.target as HTMLTextAreaElement;
              backdrop.scrollTop = el.scrollTop;
              backdrop.scrollLeft = el.scrollLeft;
            }}
            {...dropHandlers}
          />
        </div>
      </div>

      <div class="field">
        <span class="field__label">
          <span>Stats</span>
          <span class="tool-bar__group">
            <CopyButton value={input} label="Copy text" describe="the text" />
            <button
              type="button"
              class={`btn${reportCopyState === 'copied' ? ' btn--copied' : ''}`}
              onClick={() => void copyReport(buildReport())}
              disabled={input === ''}
              title="Copy a plain-text summary of the stats below"
            >
              <span aria-hidden="true">{reportCopyState === 'copied' ? '✓' : '⧉'}</span>{' '}
              {reportCopyState === 'copied' ? 'Report copied' : 'Copy report'}
            </button>
          </span>
        </span>
        <div class="wc-stats" data-testid="wc-stats">
          <div class="wc-stat"><strong>{stats.words.toLocaleString()}</strong> <span class="wc-stat__label">words</span></div>
          <div class="wc-stat"><strong>{stats.characters.toLocaleString()}</strong> <span class="wc-stat__label">characters</span></div>
          <div class="wc-stat"><strong>{stats.charactersNoSpaces.toLocaleString()}</strong> <span class="wc-stat__label">without spaces</span></div>
          <div class="wc-stat"><strong>{stats.sentences.toLocaleString()}</strong> <span class="wc-stat__label">sentences</span></div>
          <div class="wc-stat"><strong>{stats.paragraphs.toLocaleString()}</strong> <span class="wc-stat__label">paragraphs</span></div>
          <div class="wc-stat"><strong>{stats.lines.toLocaleString()}</strong> <span class="wc-stat__label">lines</span></div>
          <div class="wc-stat"><strong>{stats.uniqueWords.toLocaleString()}</strong> <span class="wc-stat__label">unique words</span></div>
          <div class="wc-stat"><strong>{stats.avgWordLength.toFixed(1)}</strong> <span class="wc-stat__label">avg. word length</span></div>
          <div class="wc-stat"><strong>{stats.avgSentenceLength.toFixed(1)}</strong> <span class="wc-stat__label">avg. sentence length</span></div>
          <div class="wc-stat"><strong>{stats.syllables.toLocaleString()}</strong> <span class="wc-stat__label">syllables (est.)</span></div>
          <div class="wc-stat"><strong>{formatDuration(stats.readingTimeSeconds)}</strong> <span class="wc-stat__label">reading time</span></div>
          <div class="wc-stat"><strong>{formatDuration(stats.speakingTimeSeconds)}</strong> <span class="wc-stat__label">speaking time</span></div>
        </div>
      </div>

      {stats.topWords.length > 0 && (
        <details class="wc-top-words-details">
          <summary>
            Most frequent words <span class="field__hint">(top {stats.topWords.length}, case-insensitive)</span>
          </summary>
          <ul class="wc-top-words">
            {stats.topWords.map((tw) => (
              <li key={tw.word}>
                <span class="wc-top-words__word">{tw.word}</span>
                <span class="wc-top-words__count">{tw.count}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div class="field">
        <span class="field__label">
          <span>Change case</span>
          <span class="field__hint">Transforms the text above in place</span>
        </span>
        <div class="tool-bar" role="group" aria-label="Case conversion">
          {CASE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              class="btn"
              onClick={() => applyCase(type)}
              disabled={baseText === ''}
              title={`Convert the text above to ${CASE_LABELS[type]}`}
            >
              {CASE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      <label class="checkbox" title="Find and replace exact text, with matches highlighted below">
        <input
          type="checkbox"
          checked={showFindReplace}
          onChange={(event) => setShowFindReplace((event.target as HTMLInputElement).checked)}
        />
        Find & replace
      </label>

      {showFindReplace && (
        <>
          <div class="panes panes--split">
            <div class="field">
              <label class="field__label" for="wc-find">
                <span>Find</span>
                <span class="field__hint">
                  {findQuery !== '' ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : ''}
                </span>
              </label>
              <input
                id="wc-find"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder="Text to find"
                value={findQuery}
                onInput={(event) => setFindQuery((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field__label" for="wc-replace">
                <span>Replace with</span>
              </label>
              <input
                id="wc-replace"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder="Replacement text"
                value={replaceQuery}
                onInput={(event) => setReplaceQuery((event.target as HTMLInputElement).value)}
              />
            </div>
          </div>

          <div class="tool-bar" role="group" aria-label="Find and replace options">
            <label class="checkbox">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive((event.target as HTMLInputElement).checked)}
              />
              Case-sensitive
            </label>
            <span class="tool-bar__spacer" />
            <button
              type="button"
              class="btn btn--primary"
              onClick={handleReplaceAll}
              disabled={findQuery === '' || matches.length === 0}
              title="Replace every match in the text above"
            >
              Replace all
            </button>
          </div>
        </>
      )}

      <style>{`
        /* A dedicated card grid rather than the shared .stats/.stats__item classes used
           elsewhere for small inline annotations (e.g. Base64's "128 in / 172 out") — with
           12 numbers to show, this tool's stats ARE the main output, so each gets its own
           tile instead of competing for space in one wrapping text row. */
        .wc-stats {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
          gap: var(--space-3);
        }
        .wc-stat {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          padding: var(--space-3);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface-2);
        }
        .wc-stat strong {
          font-size: var(--text-2xl);
          line-height: 1.15;
          font-weight: 700;
          color: var(--text);
          font-variant-numeric: tabular-nums;
        }
        .wc-stat__label {
          font-size: var(--text-sm);
          color: var(--text-muted);
        }
        .wc-top-words-details summary {
          cursor: pointer;
          font-weight: 600;
          color: var(--text);
          font-size: var(--text-sm);
          padding: var(--space-1) 0;
        }
        .wc-top-words-details summary:hover {
          color: var(--accent);
        }
        .wc-top-words-details[open] summary {
          margin-bottom: var(--space-2);
        }
        .wc-top-words {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-wrap: wrap; gap: var(--space-2);
        }
        .wc-top-words li {
          display: inline-flex; align-items: center; gap: .4em;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--surface-2); padding: .2em .6em; font-size: var(--text-sm);
        }
        .wc-top-words__word { font-family: var(--font-mono); color: var(--text); }
        .wc-top-words__count { color: var(--text-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }

        /* Both children share one grid cell so they stay pixel-aligned at any size,
           including while the user drags the textarea's native resize handle. */
        .wc-editor {
          display: grid;
        }
        .wc-editor > * {
          grid-area: 1 / 1 / 2 / 2;
        }
        .wc-editor__backdrop {
          margin: 0;
          color: transparent;
          overflow: auto;
          pointer-events: none;
          white-space: pre-wrap;
          word-break: break-word;
          resize: none;
        }
        .wc-editor__textarea {
          background: transparent;
          position: relative;
        }
        .wc-editor__textarea.textarea--drag-active {
          background: var(--accent-subtle);
        }
        /* Renders inside the transparent backdrop, behind the real (opaque) text the
           topmost textarea draws — so only the highlight background/underline should be
           visible here, not a second, doubled-up copy of the letters themselves. */
        .highlight__match {
          background: var(--accent-subtle); color: transparent;
          border-bottom: 2px solid var(--accent); border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
