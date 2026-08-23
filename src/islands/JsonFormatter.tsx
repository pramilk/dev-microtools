import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatJson, minifyJson, sortJsonKeys, parseJson, analyseJson, type IndentStyle } from '../lib/tools/json';
import type { RepairedJson } from '../lib/tools/jsonRepair';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

interface ShareState {
  input: string;
  indent: IndentStyle;
  action: Action;
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

/** One node of the JSON tree view. Objects/arrays are collapsible; scalars are leaves. */
function JsonTreeNode({
  label,
  value,
  path,
  collapsed,
  toggle,
}: {
  label: string | null;
  value: unknown;
  path: string;
  collapsed: Set<string>;
  toggle: (path: string) => void;
}) {
  const isContainer = value !== null && typeof value === 'object';

  if (!isContainer) {
    const kind = value === null ? 'null' : typeof value;
    return (
      <div class="tree-row">
        {label !== null && <span class="tree-key">{label}: </span>}
        <span class={`tree-scalar tree-scalar--${kind}`}>{JSON.stringify(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const isCollapsed = collapsed.has(path);
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
        {label !== null && <span class="tree-key">{label}: </span>}
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
  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setIndent(restored.value.indent);
      setAction(restored.value.action);
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

        <label class="checkbox">
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
            title="Choose the indentation width used when beautifying or sorting"
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

        <ShareLinkButton getState={() => ({ input, indent, action })} describe="this document" />

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
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={view === 'tree'}
                  disabled={treeValue === undefined}
                  onClick={() => setView('tree')}
                  title={
                    treeValue === undefined
                      ? 'Valid JSON is needed to show the tree view'
                      : 'Browse the document as a collapsible tree — useful for large or deeply nested JSON'
                  }
                >
                  Tree
                </button>
              </div>
              <CopyButton value={output} describe="JSON" />
              <DownloadButton value={output} filename="data.json" mimeType="application/json" describe="JSON" />
            </span>
          </div>

          {view === 'tree' && treeValue !== undefined ? (
            <div class="tree-view output output--tall" aria-label="JSON as a collapsible tree">
              <JsonTreeNode
                label={null}
                value={treeValue}
                path="$"
                collapsed={collapsedPaths}
                toggle={toggleCollapsed}
              />
            </div>
          ) : (
            <pre class={`output output--tall${output === '' ? ' output--empty' : ''}`} tabIndex={0}>
              {output === '' ? 'Formatted JSON appears here.' : output}
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
          <ul class="repair__list">
            {repair.notes.map((note) => (
              <li key={note.kind}>
                {note.description}
                {note.count > 1 && <span class="repair__count"> ×{note.count}</span>}
              </li>
            ))}
            {repair.notes.length === 0 && <li>Rebuilt the structure as valid JSON.</li>}
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
        .repair__list {
          margin: 0; padding-left: var(--space-5);
          display: flex; flex-direction: column; gap: var(--space-1);
          font-size: var(--text-sm); color: var(--text);
        }
        .repair__count {
          font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted);
        }
        .repair__caveat { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
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
