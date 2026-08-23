import { useEffect, useMemo, useState } from 'preact/hooks';
import { encodeUrl, decodeUrl, parseUrl, buildUrl, type UrlEncodeMode } from '../lib/tools/url';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Direction = 'encode' | 'decode';
type Param = { key: string; value: string };

interface ShareState {
  input: string;
  direction: Direction;
  mode: UrlEncodeMode;
}

// Matches the worked example in url-encode-decode.mdx, in Component mode.
const SAMPLE_PLAIN = 'redirect=https://app.example.com/home?tab=1';
const SAMPLE_ENCODED = 'redirect%3Dhttps%3A%2F%2Fapp.example.com%2Fhome%3Ftab%3D1';

export default function UrlTool() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');
  const [mode, setMode] = useState<UrlEncodeMode>('component');

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setDirection(restored.value.direction);
      setMode(restored.value.mode);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => {
    if (input === '') return null;
    return direction === 'encode' ? encodeUrl(input, mode) : decodeUrl(input, mode);
  }, [input, direction, mode]);

  // The breakdown is a bonus view: only meaningful when the input parses as a URL.
  const parsed = useMemo(() => {
    const candidate = direction === 'decode' && result?.ok ? result.value : input;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate.trim())) return null;
    const outcome = parseUrl(candidate);
    return outcome.ok ? outcome.value : null;
  }, [input, direction, result]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;

  // A working copy of the query parameters, editable as rows. Kept separate from
  // `input` so editing a row never fights with whatever the user is typing in the
  // main textarea — it only re-syncs when a genuinely different URL is parsed.
  const [paramRows, setParamRows] = useState<Param[]>([]);
  useEffect(() => {
    setParamRows(parsed ? parsed.params : []);
  }, [parsed]);

  const builtUrl = parsed ? buildUrl({ ...parsed, params: paramRows }) : '';

  const updateParam = (index: number, field: 'key' | 'value', value: string) => {
    setParamRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };
  const removeParam = (index: number) => {
    setParamRows((rows) => rows.filter((_, i) => i !== index));
  };
  const addParam = () => {
    setParamRows((rows) => [...rows, { key: '', value: '' }]);
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'encode'}
            onClick={() => setDirection('encode')}
            title="Percent-encode plain text or a URL"
          >
            Encode
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decode'}
            onClick={() => setDirection('decode')}
            title="Decode a percent-encoded string back to plain text"
          >
            Decode
          </button>
        </div>

        <div class="seg" role="group" aria-label="Scope">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'component'}
            onClick={() => setMode('component')}
            title="Escapes & = ? / — use for a single query parameter value"
          >
            Component
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'full'}
            onClick={() => setMode('full')}
            title="Preserves & = ? / — use for a whole URL"
          >
            Whole URL
          </button>
        </div>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, direction, mode })} describe="this URL" />
        <button
          type="button"
          class="btn"
          onClick={() => {
            setMode('component');
            setInput(direction === 'encode' ? SAMPLE_PLAIN : SAMPLE_ENCODED);
          }}
          title="Load a small example"
        >
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            if (output === '') return;
            setInput(output);
            setDirection(direction === 'encode' ? 'decode' : 'encode');
          }}
          disabled={output === ''}
          title="Copy the result into the input and flip direction — useful for checking a round trip"
        >
          <span aria-hidden="true">⇄</span> Use result as input
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

      <p class="field__hint">
        {mode === 'component'
          ? 'Component mode escapes &, =, ? and / — correct for a single query-string value.'
          : 'Whole-URL mode leaves &, =, ? and / intact — correct for escaping a complete URL.'}
      </p>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="url-input">
            <span>{direction === 'encode' ? 'Plain text' : 'Encoded text'}</span>
            <span class="field__hint">{input.length.toLocaleString()} characters</span>
          </label>
          <textarea
            id="url-input"
            class="textarea"
            spellcheck={false}
            autocomplete="off"
            placeholder={
              direction === 'encode'
                ? 'https://example.com/search?q=hello world'
                : 'https%3A%2F%2Fexample.com'
            }
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane
          label={direction === 'encode' ? 'Encoded' : 'Decoded'}
          value={output}
          placeholder="Result appears here."
          describe="result"
        />
      </div>

      <ErrorMessage message={error} />

      {parsed && (
        <div class="url-parts">
          <h3 class="url-parts__title">URL breakdown</h3>
          <dl class="url-parts__grid">
            <dt>Scheme</dt>
            <dd>{parsed.protocol}</dd>
            <dt>Host</dt>
            <dd>{parsed.host}</dd>
            {parsed.port && (
              <>
                <dt>Port</dt>
                <dd>{parsed.port}</dd>
              </>
            )}
            <dt>Path</dt>
            <dd>{parsed.path}</dd>
            {parsed.hash && (
              <>
                <dt>Fragment</dt>
                <dd>{parsed.hash}</dd>
              </>
            )}
          </dl>

          <div class="url-parts__params-head">
            <h4 class="url-parts__title">Query parameters</h4>
            <button type="button" class="btn" onClick={addParam} title="Add a new query parameter">
              + Add parameter
            </button>
          </div>

          {paramRows.length > 0 ? (
            <div class="param-rows">
              {paramRows.map((param, index) => (
                <div class="param-row" key={index}>
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
            <p class="field__hint">No query parameters yet — add one above.</p>
          )}

          <div class="field">
            <label class="field__label" for="url-built">
              <span>URL with these parameters</span>
            </label>
            <div class="built-url">
              <output id="url-built" class="built-url__text">
                {builtUrl}
              </output>
              <CopyButton value={builtUrl} describe="URL" />
              <button
                type="button"
                class="btn"
                onClick={() => setInput(builtUrl)}
                title="Load this URL into the input above, so it can be encoded, decoded or edited further"
              >
                Use as input
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .url-parts {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .url-parts__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .url-parts__grid {
          display: grid; grid-template-columns: minmax(6rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .url-parts__grid dt {
          font-family: var(--font-mono); color: var(--text-muted); word-break: break-all;
        }
        .url-parts__grid dd {
          margin: 0; font-family: var(--font-mono); color: var(--text); word-break: break-all;
        }
        .url-parts__params-head {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        }
        .param-rows { display: flex; flex-direction: column; gap: var(--space-2); }
        .param-row {
          display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-2); align-items: center;
        }
        .built-url {
          display: flex; align-items: center; gap: var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); padding: var(--space-2) var(--space-3);
        }
        .built-url__text {
          flex: 1; font-family: var(--font-mono); font-size: var(--text-sm);
          word-break: break-all; min-width: 0;
        }
      `}</style>
    </div>
  );
}
