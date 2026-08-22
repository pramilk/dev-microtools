import { useMemo, useState } from 'preact/hooks';
import { formatJson, minifyJson, sortJsonKeys, parseJson, analyseJson, type IndentStyle } from '../lib/tools/json';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';

const SAMPLE = '{"name":"ada","langs":["js","ts"],"active":true,"meta":{"id":42,"tags":null}}';

type Action = 'format' | 'minify' | 'sort';

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<IndentStyle>(2);
  const [action, setAction] = useState<Action>('format');

  const result = useMemo(() => {
    if (input.trim() === '') return null;
    if (action === 'minify') return minifyJson(input);
    if (action === 'sort') return sortJsonKeys(input, indent);
    return formatJson(input, indent);
  }, [input, indent, action]);

  const stats = useMemo(() => {
    if (input.trim() === '') return null;
    const parsed = parseJson(input);
    return parsed.ok ? analyseJson(parsed.value) : null;
  }, [input]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Action">
          {(
            [
              ['format', 'Beautify'],
              ['minify', 'Minify'],
              ['sort', 'Sort keys'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              class="seg__btn"
              aria-pressed={action === value}
              onClick={() => setAction(value)}
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
          >
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tabs</option>
          </select>
        </label>

        <span class="tool-bar__spacer" />

        <button type="button" class="btn" onClick={() => setInput(SAMPLE)}>
          Load sample
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''}>
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
    </div>
  );
}
