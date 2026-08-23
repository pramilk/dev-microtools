import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatJson, minifyJson, sortJsonKeys, parseJson, analyseJson, type IndentStyle } from '../lib/tools/json';
import type { RepairedJson, RepairKind } from '../lib/tools/jsonRepair';
import { findTextMatches, toTextSearchSegments, searchJsonTree } from '../lib/tools/jsonSearch';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

/**
 * A short, illustrative before/after for each repair kind, so the panel can show what
 * was wrong at a glance instead of making the user parse a sentence. These are generic
 * examples, not the user's own text — showing their actual (possibly sensitive) input
 * back at them inside a "look, an error" callout would be worse, not clearer.
 */
const REPAIR_EXAMPLES: Partial<Record<RepairKind, { before: string; after: string }>> = {
  'trailing-comma': { before: '{"a": 1,}', after: '{"a": 1}' },
  'single-quotes': { before: "{'a': 1}", after: '{"a": 1}' },
  'smart-quotes': { before: '{“a”: 1}', after: '{"a": 1}' },
  'unquoted-key': { before: '{a: 1}', after: '{"a": 1}' },
  'missing-comma': { before: '{"a": 1 "b": 2}', after: '{"a": 1, "b": 2}' },
  'missing-colon': { before: '{"a" 1}', after: '{"a": 1}' },
  comments: { before: '{"a": 1} // note', after: '{"a": 1}' },
  'python-literal': { before: '{"a": True}', after: '{"a": true}' },
  'special-number': { before: '{"a": NaN}', after: '{"a": null}' },
  'number-format': { before: '{"a": +1}', after: '{"a": 1}' },
  'invalid-escape': { before: '{"a": "\\x"}', after: '{"a": "x"}' },
  'unterminated-string': { before: '{"a": "b}', after: '{"a": "b"}' },
  'unclosed-bracket': { before: '{"a": [1, 2', after: '{"a": [1, 2]}' },
  'duplicate-key': { before: '{"a": 1, "a": 2}', after: '{"a": 2}' },
  'surrounding-text': { before: 'log: {"a": 1}', after: '{"a": 1}' },
  'multiple-documents': { before: '{"a": 1} {"b": 2}', after: '[{"a": 1}, {"b": 2}]' },
};

interface ShareState {
  input: string;
  indent: IndentStyle;
  action: Action;
  view: View;
  autoFix: boolean;
}

const SAMPLE = '{"name":"ada","langs":["js","ts"],"active":true,"meta":{"id":42,"tags":null}}';
const BROKEN_SAMPLE = `{
  // trailing commas, comments and single quotes are all invalid JSON
  name: 'api-server',
  port: 8080,
  debug: True,
  hosts: ['a.dev', 'b.dev',],
}`;

type Action = 'format' | 'minify' | 'sort';
type View = 'text' | 'tree';

/** Runs the selected action over a source document. */
const applyAction = (source: string, action: Action, indent: IndentStyle) => {
  if (action === 'minify') return minifyJson(source);
  if (action === 'sort') return sortJsonKeys(source, indent);
  return formatJson(source, indent);
};

/** Wraps every case-insensitive occurrence of `query` in `text` with a <mark>. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (query.trim() === '') return <>{text}</>;
  const positions = findTextMatches(text, query);
  if (positions.length === 0) return <>{text}</>;

  const segments = toTextSearchSegments(text, positions, query.length);
  return (
    <>
      {segments.map((segment, index) =>
        segment.matchIndex === null ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <mark key={index} class="tree-highlight">
            {segment.text}
          </mark>
        )
      )}
    </>
  );
}

/**
 * One node of the JSON tree view. Objects/arrays are collapsible; scalars are leaves.
 *
 * When `keepPaths` is set (a search is active), the node forces itself open and only
 * renders children whose path is in the set — the ancestors of a match plus the matches
 * themselves — so the tree collapses down to just the relevant branches.
 */
function JsonTreeNode({
  label,
  value,
  path,
  collapsed,
  toggle,
  search,
  keepPaths,
}: {
  label: string | null;
  value: unknown;
  path: string;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  search: string;
  keepPaths: Set<string> | null;
}) {
  const isContainer = value !== null && typeof value === 'object';

  if (!isContainer) {
    const kind = value === null ? 'null' : typeof value;
    return (
      <div class="tree-row">
        {label !== null && (
          <span class="tree-key">
            <Highlighted text={label} query={search} />:{' '}
          </span>
        )}
        <span class={`tree-scalar tree-scalar--${kind}`}>
          <Highlighted text={JSON.stringify(value)} query={search} />
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const allEntries: [string, unknown][] = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const entries = keepPaths
    ? allEntries.filter(([key]) => keepPaths.has(`${path}/${key}`))
    : allEntries;
  const isCollapsed = keepPaths ? false : collapsed.has(path);
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <div class="tree-node">
      <button
        type="button"
        class="tree-toggle"
        onClick={() => toggle(path)}
        aria-expanded={!isCollapsed}
      >
        <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
        {label !== null && (
          <span class="tree-key">
            <Highlighted text={label} query={search} />:{' '}
          </span>
        )}
        <span class="tree-summary">{summary}</span>
      </button>
      {!isCollapsed && (
        <div class="tree-children">
          {entries.length === 0 && <p class="tree-empty">(empty)</p>}
          {entries.map(([key, item]) => (
            <JsonTreeNode
              key={key}
              label={isArray ? null : key}
              value={item}
              path={`${path}/${key}`}
              collapsed={collapsed}
              toggle={toggle}
              search={search}
              keepPaths={keepPaths}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<IndentStyle>(2);
  const [action, setAction] = useState<Action>('format');
  const [autoFix, setAutoFix] = useState(true);
  const [view, setView] = useState<View>('text');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const activeMarkRef = useRef<HTMLElement | null>(null);
  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setIndent(restored.value.indent);
      setAction(restored.value.action);
      // Fall back for links made before these were shared, rather than restoring `undefined`.
      setView(restored.value.view ?? 'text');
      setAutoFix(restored.value.autoFix ?? true);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);
  const toggleCollapsed = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** The result of running the action over exactly what the user typed. */
  const rawResult = useMemo(() => {
    if (input.trim() === '') return null;
    return applyAction(input, action, indent);
  }, [input, indent, action]);

  const [repair, setRepair] = useState<RepairedJson | null>(null);

  /*
   * When the input will not parse, work out whether it can be salvaged.
   *
   * The repair parser is loaded on demand: most visits format JSON that is already
   * valid, and those should not pay for code they never run.
   */
  useEffect(() => {
    if (input.trim() === '' || rawResult === null || rawResult.ok) {
      setRepair(null);
      return;
    }

    let cancelled = false;
    void import('../lib/tools/jsonRepair')
      .then(({ repairJson }) => {
        // Discard a stale result if the input changed while the module was loading.
        if (cancelled) return;
        const attempt = repairJson(input);
        setRepair(attempt.ok ? attempt.value : null);
      })
      .catch(() => {
        // A failed module load must not leave a stale repair offer on screen.
        if (!cancelled) setRepair(null);
      });

    return () => {
      cancelled = true;
    };
  }, [input, rawResult]);

  const inputIsBroken = rawResult !== null && !rawResult.ok;

  /*
   * With auto-fix on, a broken document is repaired before formatting so the output
   * pane is useful immediately. The original input is deliberately left untouched —
   * rewriting what someone typed as they type is disorienting, and the repair notes
   * below make it explicit that the output is not a faithful copy of the input.
   */
  const usingRepair = autoFix && inputIsBroken && repair !== null;

  const result = useMemo(() => {
    if (!usingRepair || !repair) return rawResult;
    return applyAction(repair.json, action, indent);
  }, [usingRepair, repair, rawResult, action, indent]);

  const applyRepair = () => {
    if (!repair) return;
    // Write the repair back into the input, formatted the way the user has it set,
    // so it becomes ordinary editable input rather than a one-off preview.
    const formatted = formatJson(repair.json, indent);
    setInput(formatted.ok ? formatted.value : repair.json);
  };

  const stats = useMemo(() => {
    const source = usingRepair && repair ? repair.json : input;
    if (source.trim() === '') return null;
    const parsed = parseJson(source);
    return parsed.ok ? analyseJson(parsed.value) : null;
  }, [input, usingRepair, repair]);

  // A separate parse for the tree view: it renders the actual value, not the
  // formatted string, so it can collapse/expand independently of Beautify/Minify/Sort.
  // `undefined` means "nothing to show" — JSON.parse can legitimately produce `null`.
  const treeValue = useMemo(() => {
    const source = usingRepair && repair ? repair.json : input;
    if (source.trim() === '') return undefined;
    const parsed = parseJson(source);
    return parsed.ok ? parsed.value : undefined;
  }, [input, usingRepair, repair]);

  const output = result?.ok ? result.value : '';
  // Once auto-fix has produced a usable result, the parse error is no longer the
  // headline — the repair panel explains what happened instead.
  const error = !usingRepair && result && !result.ok ? result.error : null;

  // Search over the text view: every match position, then the current one clamped
  // into range so a stale index (from a search made against longer output) never
  // points past the end of a shorter one.
  const textMatches = useMemo(
    () => (search.trim() === '' ? [] : findTextMatches(output, search)),
    [output, search]
  );
  const clampedActiveMatch =
    textMatches.length === 0
      ? 0
      : ((activeMatch % textMatches.length) + textMatches.length) % textMatches.length;
  const textSegments = useMemo(
    () => (textMatches.length > 0 ? toTextSearchSegments(output, textMatches, search.length) : null),
    [output, textMatches, search]
  );

  // Search over the tree view: which paths to keep visible, and how many nodes matched.
  const treeSearch = useMemo(
    () => (search.trim() !== '' && treeValue !== undefined ? searchJsonTree(treeValue, search) : null),
    [search, treeValue]
  );

  // A fresh search always starts at its first match.
  useEffect(() => {
    setActiveMatch(0);
  }, [search]);

  useEffect(() => {
    // Guarded: jsdom (unit tests) has no scrollIntoView implementation.
    activeMarkRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [clampedActiveMatch, textSegments]);

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Action">
          {(
            [
              ['format', 'Beautify', 'Pretty-print with indentation so the structure is easy to read'],
              ['minify', 'Minify', 'Collapse to a single line with no extra whitespace'],
              ['sort', 'Sort keys', 'Alphabetise object keys, so two documents compare cleanly'],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              class="seg__btn"
              aria-pressed={action === value}
              onClick={() => setAction(value)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>

        <label
          class="checkbox"
          title={
            action === 'minify'
              ? 'Minify strips all whitespace, so indentation does not apply'
              : 'Choose the indentation width used when beautifying or sorting'
          }
        >
          <span class="field__hint">Indent</span>
          <select
            class="select"
            value={String(indent)}
            disabled={action === 'minify'}
            onChange={(event) => {
              const next = (event.target as HTMLSelectElement).value;
              setIndent(next === 'tab' ? 'tab' : (Number(next) as 2 | 4));
            }}
            aria-label="Indentation"
          >
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tabs</option>
          </select>
        </label>

        <label class="checkbox" title="Repair invalid JSON automatically instead of only showing an error">
          <input
            type="checkbox"
            checked={autoFix}
            onChange={(event) => setAutoFix((event.target as HTMLInputElement).checked)}
          />
          Auto-fix
        </label>

        <span class="tool-bar__spacer" />

        <ShareLinkButton
          getState={() => ({ input, indent, action, view, autoFix })}
          describe="this document"
        />

        <button
          type="button"
          class="btn"
          onClick={() => setInput(SAMPLE)}
          title="Load a small example document to try the tool"
        >
          Load sample
        </button>
        <button
          type="button"
          class="btn"
          title="Load an example with common JSON mistakes, to try the repair feature"
          onClick={() => setInput(BROKEN_SAMPLE)}
        >
          Load broken sample
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => setInput('')}
          disabled={input === ''}
          title="Clear the input and start over"
        >
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="json-input">
            <span>JSON input</span>
            <span class="field__hint">{input.length.toLocaleString()} characters</span>
          </label>
          <textarea
            id="json-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            placeholder='Paste JSON here, or drop a .json file, e.g. {"hello":"world"}'
            value={input}
            aria-invalid={error !== null}
            aria-describedby={error ? 'json-error' : undefined}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            {...dropHandlers}
          />
        </div>

        <div class="field">
          <div class="field__label">
            <span>Result</span>
            <span class="tool-bar__group">
              <div class="seg" role="group" aria-label="Result view">
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={view === 'text'}
                  onClick={() => setView('text')}
                  title="Show the formatted JSON as text"
                >
                  Text
                </button>
                <span
                  class="seg__tip"
                  title={
                    treeValue === undefined
                      ? 'Valid JSON is needed to show the tree view'
                      : 'Browse the document as a collapsible tree — useful for large or deeply nested JSON'
                  }
                >
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={view === 'tree'}
                    disabled={treeValue === undefined}
                    onClick={() => setView('tree')}
                  >
                    Tree
                  </button>
                </span>
              </div>
              <CopyButton value={output} describe="JSON" />
              <DownloadButton value={output} filename="data.json" mimeType="application/json" describe="JSON" />
            </span>
          </div>

          {(output !== '' || treeValue !== undefined) && (
            <div class="result-search" role="search">
              <input
                type="text"
                class="result-search__input"
                placeholder="Search result"
                value={search}
                onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || view !== 'text' || textMatches.length === 0) return;
                  event.preventDefault();
                  setActiveMatch((current) => current + (event.shiftKey ? -1 : 1));
                }}
                aria-label="Search formatted result"
              />
              {search.trim() !== '' && (
                <span class="result-search__status" aria-live="polite">
                  {view === 'text'
                    ? textMatches.length === 0
                      ? 'No matches'
                      : `${clampedActiveMatch + 1} of ${textMatches.length}`
                    : treeSearch && treeSearch.matchCount > 0
                      ? `${treeSearch.matchCount} match${treeSearch.matchCount === 1 ? '' : 'es'}`
                      : 'No matches'}
                </span>
              )}
              {view === 'text' && textMatches.length > 1 && (
                <span class="result-search__nav">
                  <button
                    type="button"
                    class="result-search__btn"
                    onClick={() => setActiveMatch((current) => current - 1)}
                    aria-label="Previous match"
                    title="Previous match"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    class="result-search__btn"
                    onClick={() => setActiveMatch((current) => current + 1)}
                    aria-label="Next match"
                    title="Next match"
                  >
                    ›
                  </button>
                </span>
              )}
              {search !== '' && (
                <button
                  type="button"
                  class="result-search__clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          )}

          {view === 'tree' && treeValue !== undefined ? (
            treeSearch && treeSearch.matchCount === 0 ? (
              <p class="output output--tall output--empty">No matches for &ldquo;{search}&rdquo;.</p>
            ) : (
              <div class="tree-view output output--tall" aria-label="JSON as a collapsible tree">
                <JsonTreeNode
                  label={null}
                  value={treeValue}
                  path="$"
                  collapsed={collapsedPaths}
                  toggle={toggleCollapsed}
                  search={search}
                  keepPaths={treeSearch?.keepPaths ?? null}
                />
              </div>
            )
          ) : (
            <pre class={`output output--tall${output === '' ? ' output--empty' : ''}`} tabIndex={0}>
              {output === ''
                ? 'Formatted JSON appears here.'
                : (textSegments ?? [{ text: output, matchIndex: null }]).map((segment, index) =>
                    segment.matchIndex === null ? (
                      <span key={index}>{segment.text}</span>
                    ) : (
                      <mark
                        key={index}
                        class={
                          segment.matchIndex === clampedActiveMatch
                            ? 'result-mark result-mark--active'
                            : 'result-mark'
                        }
                        ref={
                          segment.matchIndex === clampedActiveMatch
                            ? (el: HTMLElement | null) => {
                                activeMarkRef.current = el;
                              }
                            : undefined
                        }
                      >
                        {segment.text}
                      </mark>
                    )
                  )}
            </pre>
          )}
        </div>
      </div>

      <div id="json-error">
        <ErrorMessage message={error} />
      </div>

      {repair && (
        <div class={`repair${usingRepair ? ' repair--applied' : ''}`} role="status">
          <div class="repair__head">
            <span class="repair__title">
              <span aria-hidden="true">{usingRepair ? '✓' : '🔧'}</span>{' '}
              {usingRepair
                ? 'The output above was repaired automatically'
                : 'This looks fixable'}
            </span>
            <button
              type="button"
              class={usingRepair ? 'btn' : 'btn btn--primary'}
              onClick={applyRepair}
              title="Replace the input with the repaired JSON"
            >
              {usingRepair ? 'Apply to input' : 'Fix it'}
            </button>
          </div>
          <p class="repair__intro">
            {usingRepair
              ? 'Your input is still shown unchanged on the left. These changes were made to produce the output:'
              : 'Applying the fix would make these changes:'}
          </p>
          <ul class="repair__grid">
            {repair.notes.map((note) => {
              const example = REPAIR_EXAMPLES[note.kind];
              return (
                <li key={note.kind} class="repair__card">
                  {example && (
                    <p class="repair__example">
                      <code class="repair__before">{example.before}</code>
                      <span class="repair__arrow" aria-hidden="true">
                        →
                      </span>
                      <code class="repair__after">{example.after}</code>
                    </p>
                  )}
                  <p class="repair__desc">
                    {note.description}
                    {note.count > 1 && <span class="repair__count"> ×{note.count}</span>}
                  </p>
                </li>
              );
            })}
            {repair.notes.length === 0 && (
              <li class="repair__card">
                <p class="repair__desc">Rebuilt the structure as valid JSON.</p>
              </li>
            )}
          </ul>
          <p class="repair__caveat">
            Check the result before relying on it — a repair is a best guess at what you
            meant, not a guarantee.
          </p>
        </div>
      )}

      {autoFix && inputIsBroken && repair === null && (
        <p class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>Auto-fix could not salvage this input — the error above explains why.</span>
        </p>
      )}

      {stats && (
        <p class="stats">
          <span class="stats__item">
            <strong>{stats.keys.toLocaleString()}</strong> keys
          </span>
          <span class="stats__item">
            <strong>{stats.depth}</strong> levels deep
          </span>
          <span class="stats__item">
            <strong>{stats.nodes.toLocaleString()}</strong> nodes
          </span>
          {output !== '' && (
            <span class="stats__item">
              <strong>{output.length.toLocaleString()}</strong> characters out
            </span>
          )}
        </p>
      )}

      <style>{`
        .repair {
          border: 1px solid var(--warning-border);
          background: var(--warning-subtle);
          border-radius: var(--radius);
          padding: var(--space-3) var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }
        .repair__head {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-3); flex-wrap: wrap;
        }
        .repair__title {
          font-weight: 650; font-size: var(--text-sm); color: var(--warning);
        }
        .repair__intro { margin: 0; font-size: var(--text-sm); color: var(--text); }
        .repair__grid {
          margin: 0; padding: 0; list-style: none;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: var(--space-2);
        }
        .repair__card {
          background: var(--surface-2); border-radius: var(--radius);
          padding: var(--space-2) var(--space-3);
          display: flex; flex-direction: column; gap: var(--space-1);
        }
        .repair__example {
          margin: 0; display: flex; align-items: baseline; gap: var(--space-1);
          flex-wrap: wrap; font-family: var(--font-mono); font-size: var(--text-xs);
        }
        .repair__before { color: var(--danger); text-decoration: line-through; }
        .repair__after { color: var(--success); }
        .repair__arrow { color: var(--text-subtle); }
        .repair__desc {
          margin: 0; font-size: var(--text-sm); color: var(--text);
        }
        .repair__count {
          font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted);
        }
        .repair__caveat { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
        .result-search {
          display: flex; align-items: center; gap: var(--space-2);
          margin-bottom: var(--space-2);
        }
        .result-search__input {
          flex: 1; min-width: 6rem;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); color: var(--text);
          font: inherit; font-size: var(--text-sm); padding: .3rem .6rem;
        }
        .result-search__status {
          font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap;
        }
        .result-search__nav { display: flex; gap: .2rem; }
        .result-search__btn, .result-search__clear {
          border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          background: var(--surface); color: var(--text); cursor: pointer;
          font-size: var(--text-sm); line-height: 1; padding: .2rem .5rem;
        }
        .result-search__btn:hover, .result-search__clear:hover { background: var(--surface-2); }
        .result-mark {
          background: var(--accent-subtle); color: var(--text); font-weight: 650;
          border-radius: 2px; padding: 0 2px; box-shadow: inset 0 0 0 1px var(--accent);
        }
        .result-mark--active { background: var(--accent); color: var(--accent-contrast); }
        .tree-highlight {
          background: var(--accent-subtle); color: var(--text); font-weight: 650;
          border-radius: 2px; padding: 0 2px; box-shadow: inset 0 0 0 1px var(--accent);
        }
        .tree-view { overflow: auto; font-family: var(--font-mono); font-size: var(--text-sm); }
        .tree-node { display: flex; flex-direction: column; }
        .tree-toggle {
          display: flex; align-items: center; gap: .35em; background: none; border: none;
          cursor: pointer; font: inherit; color: var(--text); padding: .1rem 0; text-align: left;
        }
        .tree-toggle:hover { color: var(--accent); }
        .tree-summary { color: var(--text-subtle); }
        .tree-children {
          margin-left: .55em; padding-left: .75em; border-left: 1px dashed var(--border);
        }
        .tree-empty { margin: 0; color: var(--text-subtle); font-style: italic; padding-left: 1.2em; }
        .tree-row { padding: .1rem 0; }
        .tree-key { color: var(--accent); font-weight: 600; }
        .tree-scalar--string { color: var(--success); }
        .tree-scalar--number { color: var(--warning); }
        .tree-scalar--boolean { color: var(--accent); }
        .tree-scalar--null { color: var(--text-subtle); font-style: italic; }
      `}</style>
    </div>
  );
}
