import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseUrl, rebuildUrl, type QueryParam, type ParsedUrl } from '../lib/tools/urlParser';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface Field {
  label: string;
  value: string;
}

function breakdownFields(parsed: ParsedUrl): Field[] {
  const fields: Field[] = [
    { label: 'Scheme', value: parsed.protocol.replace(/:$/, '') },
  ];
  if (parsed.username) fields.push({ label: 'Username', value: parsed.username });
  if (parsed.password) fields.push({ label: 'Password', value: parsed.password });
  fields.push({ label: 'Host', value: parsed.hostname });
  if (parsed.port) fields.push({ label: 'Port', value: parsed.port });
  fields.push({ label: 'Origin', value: parsed.origin });
  fields.push({ label: 'Path', value: parsed.pathname });
  if (parsed.search) fields.push({ label: 'Query string', value: parsed.search });
  if (parsed.hash) fields.push({ label: 'Fragment', value: parsed.hash });
  return fields;
}

function breakdownText(fields: Field[]): string {
  return fields.map((field) => `${field.label}: ${field.value}`).join('\n');
}

// Matches the worked example in url-parser.mdx — exercises every breakdown field
// (credentials, port, a repeated query key, a fragment) in one paste.
const SAMPLE_URL = 'https://user:pass@sub.example.com:8080/some/path?a=1&b=2&a=3#section';

interface ShareState {
  input: string;
}

export default function UrlParser() {
  const [input, setInput] = useState('');

  // Restore state from a shared link, if the page was opened with one. Only the raw
  // URL is shared, not any live query-param edits — those re-derive from the restored
  // URL the same way they do for a freshly typed one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const parseResult = useMemo(() => {
    if (input.trim() === '') return null;
    return parseUrl(input);
  }, [input]);

  const error = parseResult && !parseResult.ok ? parseResult.error : null;
  const parsed = parseResult?.ok ? parseResult.value : null;

  // A working copy of the query parameters, editable as rows. Only resyncs when a
  // genuinely different URL is parsed — parsed is memoized on `input`, so it keeps
  // the same reference while only paramRows (not input) changes.
  const [paramRows, setParamRows] = useState<QueryParam[]>([]);
  useEffect(() => {
    setParamRows(parsed ? parsed.queryParams : []);
  }, [parsed]);

  const rebuilt = parsed ? rebuildUrl(parsed.href, paramRows) : null;
  const resultUrl = rebuilt?.ok ? rebuilt.value : '';

  const updateParam = (index: number, field: 'key' | 'value', value: string) => {
    setParamRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };
  const removeParam = (index: number) => {
    setParamRows((rows) => rows.filter((_, i) => i !== index));
  };
  const addParam = () => {
    setParamRows((rows) => [...rows, { key: '', value: '' }]);
  };

  const fields = parsed ? breakdownFields(parsed) : [];

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input })} describe="this URL" />
        <button
          type="button"
          class="btn"
          onClick={() => setInput(SAMPLE_URL)}
          title="Load a sample URL with credentials, a port, a repeated query key and a fragment"
        >
          Load example
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

      <div class="field">
        <label class="field__label" for="url-parser-input">
          <span>URL</span>
        </label>
        <input
          id="url-parser-input"
          class="input"
          type="text"
          spellcheck={false}
          autocomplete="off"
          placeholder="https://user:pass@sub.example.com:8080/some/path?a=1&b=2#section"
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLInputElement).value)}
        />
      </div>

      <ErrorMessage message={error} />

      {parsed && (
        <div class="url-parser-breakdown">
          <div class="url-parser-breakdown__head">
            <h3 class="url-parser-breakdown__title">URL breakdown</h3>
            <CopyButton value={breakdownText(fields)} label="Copy breakdown" describe="URL breakdown" />
          </div>
          <dl class="url-parser-breakdown__grid">
            {fields.map((field) => (
              <>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </>
            ))}
          </dl>

          <div class="url-parser-params-head">
            <h4 class="url-parser-breakdown__title">Query parameters</h4>
            <button type="button" class="btn" onClick={addParam} title="Add a new query parameter">
              + Add parameter
            </button>
          </div>

          {paramRows.length > 0 ? (
            <div class="url-parser-param-rows">
              {paramRows.map((param, index) => (
                <div class="url-parser-param-row" key={index}>
                  <input
                    class="input"
                    placeholder="key"
                    aria-label={`Parameter ${index + 1} key`}
                    value={param.key}
                    onInput={(event) => updateParam(index, 'key', (event.target as HTMLInputElement).value)}
                  />
                  <input
                    class="input"
                    placeholder="value"
                    aria-label={`Parameter ${index + 1} value`}
                    value={param.value}
                    onInput={(event) => updateParam(index, 'value', (event.target as HTMLInputElement).value)}
                  />
                  <button
                    type="button"
                    class="btn"
                    onClick={() => removeParam(index)}
                    title="Remove this parameter"
                    aria-label={`Remove parameter ${index + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p class="field__hint">No query parameters — add one above.</p>
          )}

          <OutputPane
            label="Result URL"
            value={resultUrl}
            placeholder="Rebuilt URL appears here."
            describe="rebuilt URL"
          />
        </div>
      )}

      <style>{`
        .url-parser-breakdown {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .url-parser-breakdown__head {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        }
        .url-parser-breakdown__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .url-parser-breakdown__grid {
          display: grid; grid-template-columns: minmax(6rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .url-parser-breakdown__grid dt {
          font-family: var(--font-mono); color: var(--text-muted); word-break: break-all;
        }
        .url-parser-breakdown__grid dd {
          margin: 0; font-family: var(--font-mono); color: var(--text); word-break: break-all;
        }
        .url-parser-params-head {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        }
        .url-parser-param-rows { display: flex; flex-direction: column; gap: var(--space-2); }
        .url-parser-param-row {
          display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-2); align-items: center;
        }
      `}</style>
    </div>
  );
}
