import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ASCII_TABLE, searchAsciiTable, formatAsciiEntry, formatAsciiTable, type AsciiEntry } from '../lib/tools/asciiTable';
import { snapshotKeyEvent, formatKeyEventText, SUPPRESSED_DEFAULT_KEYS, type KeyEventSnapshot } from '../lib/tools/keyEvent';
import { parseCodePointQuery, describeCodePoint, formatUnicodeCharInfo, RENDERABLE_CATEGORIES } from '../lib/tools/unicodeChar';
import { readShareStateFromLocation } from '../lib/shareLink';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useCopy } from './shared/useCopy';

interface ShareState {
  query: string;
}

const PRESETS: ReadonlyArray<{ label: string; query: string }> = [
  { label: 'A', query: '65' },
  { label: 'Tab', query: '09' },
  { label: 'Enter', query: '13' },
  { label: 'Escape', query: '27' },
  { label: 'Space', query: '32' },
  { label: '@', query: '64' },
  { label: '😀', query: '😀' },
  { label: '👍', query: '👍' },
  { label: 'é', query: 'é' },
  { label: '€', query: '€' },
  { label: '中', query: '中' },
];

const HISTORY_LIMIT = 8;

let historyKeySeq = 0;

/**
 * The keycode inspector section deliberately has no ShareLinkButton or "Load example":
 * its whole output is live browser events, the same reason BrowserFingerprintInspector
 * has neither. There is no meaningful sample input for a keypress, and nothing about a
 * captured keystroke is worth encoding into a shareable link. The tool's one Share
 * link/Load-example pair lives on the ASCII table section below, which has real,
 * shareable input state (the search query).
 */
export default function AsciiTableKeycodeInspector() {
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<KeyEventSnapshot | null>(null);
  const [keyHistory, setKeyHistory] = useState<Array<{ id: number; snapshot: KeyEventSnapshot }>>([]);
  const [capturing, setCapturing] = useState(false);
  const { state: rowCopyState, copy: copyRow } = useCopy();
  const [copiedDec, setCopiedDec] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setQuery(restored.value.query);
      history.replaceState(null, '', window.location.pathname);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const results = useMemo(() => searchAsciiTable(query), [query]);
  const unicodeCodePoint = useMemo(() => parseCodePointQuery(query), [query]);
  const unicodeInfo = useMemo(() => (unicodeCodePoint === null ? null : describeCodePoint(unicodeCodePoint)), [unicodeCodePoint]);
  const asciiName = unicodeInfo && unicodeInfo.codePoint <= 127 ? ASCII_TABLE[unicodeInfo.codePoint]!.name : null;
  // A resolved code point past 127 can never be a row in the (0-127) table below, so
  // showing "0 of 128 characters" / "No character matches" next to a card that already
  // says exactly that is pure noise — the table is hidden rather than left to contradict
  // the card right above it.
  const showAsciiTable = !(unicodeInfo && unicodeInfo.codePoint > 127);

  const handleRowCopy = (entry: AsciiEntry) => {
    void copyRow(formatAsciiEntry(entry));
    setCopiedDec(entry.dec);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (SUPPRESSED_DEFAULT_KEYS.has(event.key)) event.preventDefault();
    if (event.key === 'Escape') {
      boxRef.current?.blur();
      return;
    }

    const snapshot = snapshotKeyEvent({
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      location: event.location,
      repeat: event.repeat,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });

    historyKeySeq += 1;
    setCurrent(snapshot);
    setKeyHistory((prev) => [{ id: historyKeySeq, snapshot }, ...prev].slice(0, HISTORY_LIMIT));
  };

  return (
    <div class="tool">
      <section class="atk-section" aria-labelledby="atk-keycode-heading">
        <h3 id="atk-keycode-heading" class="atk-section__title">
          Keycode inspector
        </h3>
        <p class="field__hint">
          Click the box below, then press any key to see exactly what a browser's keyboard event reports for it.
          Nothing here is sent anywhere — it's read directly from the browser's own KeyboardEvent.
        </p>

        <div
          ref={boxRef}
          class={`atk-capture${capturing ? ' atk-capture--active' : ''}`}
          tabIndex={0}
          role="textbox"
          aria-label="Key capture area — press any key"
          aria-readonly="true"
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={handleKeyDown}
        >
          {current ? (
            <div class="atk-current">
              <span class="atk-current__key">{current.key === ' ' ? 'Space' : current.key || '(none)'}</span>
              <dl class="atk-current__grid">
                <dt>event.key</dt>
                <dd>
                  <code>{JSON.stringify(current.key)}</code>
                </dd>
                <dt>event.code</dt>
                <dd>
                  <code>{current.code}</code>
                </dd>
                <dt>keyCode</dt>
                <dd>
                  <code>{current.keyCode}</code>
                </dd>
                <dt>which</dt>
                <dd>
                  <code>{current.which}</code>
                </dd>
                <dt>location</dt>
                <dd>
                  <code>
                    {current.location} ({current.locationLabel})
                  </code>
                </dd>
                <dt>modifiers</dt>
                <dd>
                  <code>{current.modifierText}</code>
                </dd>
                <dt>repeat</dt>
                <dd>
                  <code>{String(current.repeat)}</code>
                </dd>
              </dl>
            </div>
          ) : (
            <p class="atk-capture__placeholder">{capturing ? 'Listening — press any key…' : 'Click here, then press any key'}</p>
          )}
        </div>
        <p class="field__hint">
          Press Escape or click outside the box to leave it. Some browser or OS shortcuts (Ctrl+T, F11, ...) can't be
          captured or blocked by any web page.
        </p>

        {current && (
          <div class="tool-bar">
            <button type="button" class="btn" onClick={() => { setKeyHistory([]); setCurrent(null); }} title="Clear the captured key and history below">
              Clear history
            </button>
            <span class="tool-bar__spacer" />
            <CopyButton value={formatKeyEventText(current)} describe="this key event" />
          </div>
        )}

        {keyHistory.length > 0 && (
          <div class="atk-history-wrap">
            <table class="atk-table">
              <caption class="sr-only">Recently captured key events, most recent first</caption>
              <thead>
                <tr>
                  <th scope="col">key</th>
                  <th scope="col">code</th>
                  <th scope="col">keyCode</th>
                  <th scope="col">modifiers</th>
                </tr>
              </thead>
              <tbody>
                {keyHistory.map(({ id, snapshot }) => (
                  <tr key={id}>
                    <td>
                      <code>{JSON.stringify(snapshot.key)}</code>
                    </td>
                    <td>
                      <code>{snapshot.code}</code>
                    </td>
                    <td>
                      <code>{snapshot.keyCode}</code>
                    </td>
                    <td>{snapshot.modifierText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section class="atk-section" aria-labelledby="atk-table-heading">
        <h3 id="atk-table-heading" class="atk-section__title">
          ASCII table &amp; Unicode lookup
        </h3>
        <p class="field__hint">
          The table below covers standard ASCII (0-127) with full names. Paste or type any other Unicode character —
          an emoji, an accented letter, a symbol from another script — and its code point, UTF-8/UTF-16 bytes,
          category and script appear above the table. Only ASCII characters get a name; see the FAQ for why.
        </p>

        <div class="presets" role="group" aria-label="Common characters">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" class="preset-chip" onClick={() => setQuery(preset.query)} title={`Look up "${preset.label}"`}>
              {preset.label}
            </button>
          ))}
        </div>

        <div class="field">
          <label class="field__label" for="atk-search">
            <span>Search</span>
            <span class="field__hint">Character, name, or code — try 65, 0x41, U+0041, "tab", or paste any Unicode character</span>
          </label>
          <input
            id="atk-search"
            class="input"
            spellcheck={false}
            autocomplete="off"
            placeholder="A, 65, 0x41, tab, 😀…"
            value={query}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
        </div>

        <div class="tool-bar">
          <button type="button" class="btn" onClick={() => setQuery('')} disabled={query === ''} title="Clear the search">
            Clear
          </button>
          <span class="tool-bar__spacer" />
          <CopyButton value={formatAsciiTable(results)} label="Copy table" describe="the filtered ASCII table" />
          <ShareLinkButton getState={() => ({ query })} describe="this search" />
        </div>

        {unicodeInfo && (
          <div class="atk-unicode-card">
            <span class="atk-unicode-card__glyph" aria-hidden={!RENDERABLE_CATEGORIES.has(unicodeInfo.category)}>
              {RENDERABLE_CATEGORIES.has(unicodeInfo.category) ? unicodeInfo.char : `(${unicodeInfo.categoryLabel.toLowerCase()})`}
            </span>
            <dl class="atk-unicode-card__grid">
              <div class="atk-unicode-card__field">
                <dt>Code point</dt>
                <dd>
                  <code>
                    U+{unicodeInfo.hex} ({unicodeInfo.codePoint})
                  </code>
                </dd>
              </div>
              <div class="atk-unicode-card__field">
                <dt>Name</dt>
                <dd>{asciiName ?? <span title="Only ASCII (0-127) characters have a name shown here — see the FAQ.">not shown for non-ASCII</span>}</dd>
              </div>
              <div class="atk-unicode-card__field">
                <dt>Category</dt>
                <dd>
                  <code>{unicodeInfo.category}</code> ({unicodeInfo.categoryLabel})
                </dd>
              </div>
              <div class="atk-unicode-card__field">
                <dt>Script</dt>
                <dd>{unicodeInfo.script ?? 'unknown'}</dd>
              </div>
              <div class="atk-unicode-card__field">
                <dt>UTF-8</dt>
                <dd>
                  <code>{unicodeInfo.utf8Bytes.join(' ')}</code>
                </dd>
              </div>
              <div class="atk-unicode-card__field">
                <dt>UTF-16</dt>
                <dd>
                  <code>{unicodeInfo.utf16Units.join(' ')}</code>
                </dd>
              </div>
            </dl>
            <div class="atk-unicode-card__copy">
              <CopyButton value={formatUnicodeCharInfo(unicodeInfo)} describe="this character's Unicode details" />
            </div>
          </div>
        )}

        {showAsciiTable ? (
          <>
            <p class="field__hint" role="status">
              {results.length} of 128 characters
            </p>

            <div class="atk-table-wrap">
              <table class="atk-table">
                <thead>
                  <tr>
                    <th scope="col">Dec</th>
                    <th scope="col">Hex</th>
                    <th scope="col">Oct</th>
                    <th scope="col">Bin</th>
                    <th scope="col">Char</th>
                    <th scope="col">Name</th>
                    <th scope="col">
                      <span class="sr-only">Copy</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((entry) => (
                    <tr key={entry.dec}>
                      <td class="tnum">{entry.dec}</td>
                      <td>
                        <code>{entry.hex}</code>
                      </td>
                      <td>
                        <code>{entry.oct}</code>
                      </td>
                      <td>
                        <code>{entry.bin}</code>
                      </td>
                      <td>
                        <code>{entry.category === 'control' ? entry.abbr : entry.char}</code>
                      </td>
                      <td>{entry.name}</td>
                      <td>
                        <button
                          type="button"
                          class="atk-row-copy"
                          onClick={() => handleRowCopy(entry)}
                          title={`Copy ${entry.name}'s details`}
                        >
                          {rowCopyState === 'copied' && copiedDec === entry.dec ? '✓' : '⧉'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={7} class="atk-table__empty">
                        No character matches "{query}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p class="field__hint">Not part of the ASCII table (0-127) — see the Unicode details above.</p>
        )}
      </section>

      <style>{`
        .atk-section {
          display: flex; flex-direction: column; gap: var(--space-3);
          padding-bottom: var(--space-5); margin-bottom: var(--space-5);
          border-bottom: 1px solid var(--border);
        }
        .atk-section:last-of-type { padding-bottom: 0; margin-bottom: 0; border-bottom: none; }
        .atk-section__title { font-size: var(--text-lg); font-weight: 650; margin: 0; }

        .atk-capture {
          border: 1px dashed var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-5); min-height: 6.5rem;
          display: flex; align-items: center; justify-content: center; text-align: center;
          cursor: text; outline-offset: 2px;
        }
        .atk-capture--active { border-color: var(--accent); border-style: solid; background: var(--accent-subtle); }
        .atk-capture__placeholder { margin: 0; color: var(--text-subtle); font-size: var(--text-sm); }

        .atk-current { display: flex; flex-direction: column; gap: var(--space-3); align-items: center; width: 100%; }
        .atk-current__key {
          font-family: var(--font-mono); font-size: var(--text-2xl); font-weight: 650;
          background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius);
          padding: 0.2em 0.6em; min-width: 2.5em;
        }
        .atk-current__grid {
          display: grid; grid-template-columns: minmax(6rem, auto) 1fr;
          gap: var(--space-1) var(--space-4); margin: 0; text-align: left; font-size: var(--text-sm);
        }
        .atk-current__grid dt { color: var(--text-muted); font-size: var(--text-xs); letter-spacing: .06em; align-self: center; }
        .atk-current__grid dd { margin: 0; align-self: center; }

        .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .preset-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text);
          cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }

        .atk-unicode-card {
          display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4);
          border: 1px solid var(--accent-border); border-radius: var(--radius);
          background: var(--accent-subtle); padding: var(--space-4);
        }
        .atk-unicode-card__glyph {
          font-family: var(--font-mono); font-size: var(--text-2xl); font-weight: 650;
          background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius);
          padding: 0.2em 0.5em; min-width: 2em; text-align: center; flex-shrink: 0;
        }
        .atk-unicode-card__grid {
          display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5);
          margin: 0; font-size: var(--text-sm); flex: 1 1 20rem;
        }
        .atk-unicode-card__field { display: flex; flex-direction: column; gap: 0.15em; min-width: 8rem; }
        .atk-unicode-card__field dt { margin: 0; color: var(--text-muted); font-size: var(--text-xs); letter-spacing: .06em; }
        .atk-unicode-card__field dd { margin: 0; }
        .atk-unicode-card__copy { flex-shrink: 0; }

        .atk-table-wrap, .atk-history-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
        .atk-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
        .atk-table th, .atk-table td { padding: 0.45rem var(--space-3); text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .atk-table th { background: var(--surface-2); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
        .atk-table tbody tr:last-child td { border-bottom: none; }
        .atk-table td.tnum { font-variant-numeric: tabular-nums; }
        .atk-table__empty { color: var(--text-subtle); white-space: normal; text-align: center; }

        .atk-row-copy {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); width: 1.8rem; height: 1.8rem; line-height: 1;
          cursor: pointer; color: var(--text-muted);
        }
        .atk-row-copy:hover { background: var(--surface-2); color: var(--text); }
      `}</style>
    </div>
  );
}
