import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatJson, minifyJson, sortJsonKeys, parseJson, analyseJson, type IndentStyle } from '../lib/tools/json';
import type { RepairedJson } from '../lib/tools/jsonRepair';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';

const SAMPLE = '{"name":"ada","langs":["js","ts"],"active":true,"meta":{"id":42,"tags":null}}';
const BROKEN_SAMPLE = `{
  // trailing commas, comments and single quotes are all invalid JSON
  name: 'api-server',
  port: 8080,
  debug: True,
  hosts: ['a.dev', 'b.dev',],
}`;

type Action = 'format' | 'minify' | 'sort';

/** Runs the selected action over a source document. */
const applyAction = (source: string, action: Action, indent: IndentStyle) => {
  if (action === 'minify') return minifyJson(source);
  if (action === 'sort') return sortJsonKeys(source, indent);
  return formatJson(source, indent);
};

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<IndentStyle>(2);
  const [action, setAction] = useState<Action>('format');
  const [autoFix, setAutoFix] = useState(true);

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
            class="textarea textarea--tall"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            placeholder='Paste JSON here, e.g. {"hello":"world"}'
            value={input}
            aria-invalid={error !== null}
            aria-describedby={error ? 'json-error' : undefined}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane
          label="Result"
          value={output}
          placeholder="Formatted JSON appears here."
          describe="JSON"
          tall
        />
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
      `}</style>
    </div>
  );
}
