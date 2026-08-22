import { useMemo, useState } from 'preact/hooks';
import { encodeUrl, decodeUrl, parseUrl, type UrlEncodeMode } from '../lib/tools/url';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';

type Direction = 'encode' | 'decode';

export default function UrlTool() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');
  const [mode, setMode] = useState<UrlEncodeMode>('component');

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

          {parsed.params.length > 0 && (
            <>
              <h4 class="url-parts__title">Query parameters</h4>
              <dl class="url-parts__grid">
                {parsed.params.map((param, index) => (
                  <>
                    <dt key={`k-${index}`}>{param.key}</dt>
                    <dd key={`v-${index}`}>{param.value}</dd>
                  </>
                ))}
              </dl>
            </>
          )}
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
      `}</style>
    </div>
  );
}
