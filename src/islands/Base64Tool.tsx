import { useMemo, useState } from 'preact/hooks';
import { encodeBase64, decodeBase64 } from '../lib/tools/base64';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';

type Direction = 'encode' | 'decode';

export default function Base64Tool() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');
  const [urlSafe, setUrlSafe] = useState(false);

  const result = useMemo(() => {
    if (input === '') return null;
    return direction === 'encode' ? encodeBase64(input, urlSafe) : decodeBase64(input);
  }, [input, direction, urlSafe]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;

  /** Moves the result into the input and flips direction, for round-tripping. */
  const swap = () => {
    if (output === '') return;
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
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
            title="Convert plain text into base64"
          >
            Encode
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decode'}
            onClick={() => setDirection('decode')}
            title="Convert base64 back into plain text"
          >
            Decode
          </button>
        </div>

        {direction === 'encode' && (
          <label class="checkbox">
            <input
              type="checkbox"
              checked={urlSafe}
              onChange={(event) => setUrlSafe((event.target as HTMLInputElement).checked)}
            />
            URL-safe (-_ instead of +/, no padding)
          </label>
        )}

        <span class="tool-bar__spacer" />

        <button
          type="button"
          class="btn"
          onClick={swap}
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

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="b64-input">
            <span>{direction === 'encode' ? 'Plain text' : 'Base64'}</span>
            <span class="field__hint">{input.length.toLocaleString()} characters</span>
          </label>
          <textarea
            id="b64-input"
            class="textarea"
            spellcheck={false}
            autocomplete="off"
            placeholder={
              direction === 'encode' ? 'Type or paste text to encode…' : 'Paste base64 to decode…'
            }
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane
          label={direction === 'encode' ? 'Base64' : 'Decoded text'}
          value={output}
          placeholder={
            direction === 'encode' ? 'Encoded output appears here.' : 'Decoded text appears here.'
          }
          describe={direction === 'encode' ? 'base64' : 'decoded text'}
        />
      </div>

      <ErrorMessage message={error} />

      {output !== '' && (
        <p class="stats">
          <span class="stats__item">
            <strong>{input.length.toLocaleString()}</strong> in
          </span>
          <span class="stats__item">
            <strong>{output.length.toLocaleString()}</strong> out
          </span>
          {direction === 'encode' && (
            <span class="stats__item">
              <strong>
                {input.length > 0 ? `+${Math.round((output.length / input.length - 1) * 100)}%` : '—'}
              </strong>{' '}
              size change
            </span>
          )}
        </p>
      )}
    </div>
  );
}
