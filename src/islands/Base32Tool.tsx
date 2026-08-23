import { useEffect, useMemo, useState } from 'preact/hooks';
import { encodeBase32, decodeBase32 } from '../lib/tools/base32';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Direction = 'encode' | 'decode';

interface ShareState {
  input: string;
  direction: Direction;
  padding: boolean;
}

// The RFC 4648 §10 test vector, matching the worked example in the tool's own content
// page — the encoded form uses the default padded output.
const SAMPLE_PLAIN = 'foobar';
const SAMPLE_ENCODED = 'MZXW6YTBOI======';

export default function Base32Tool() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');
  const [padding, setPadding] = useState(true);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setDirection(restored.value.direction);
      setPadding(restored.value.padding);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => {
    if (input === '') return null;
    return direction === 'encode' ? encodeBase32(input, { padding }) : decodeBase32(input);
  }, [input, direction, padding]);

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
            title="Convert plain text into base32"
          >
            Encode
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decode'}
            onClick={() => setDirection('decode')}
            title="Convert base32 back into plain text"
          >
            Decode
          </button>
        </div>

        {direction === 'encode' && (
          <label
            class="checkbox"
            title="TOTP/2FA secret keys are conventionally shown without the trailing = padding"
          >
            <input
              type="checkbox"
              checked={!padding}
              onChange={(event) => setPadding(!(event.target as HTMLInputElement).checked)}
            />
            Omit padding (=)
          </label>
        )}

        <span class="tool-bar__spacer" />

        <ShareLinkButton getState={() => ({ input, direction, padding })} describe="this text" />
        <button
          type="button"
          class="btn"
          onClick={() => setInput(direction === 'encode' ? SAMPLE_PLAIN : SAMPLE_ENCODED)}
          title="Load a small example — the RFC 4648 test vector"
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

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="b32-input">
            <span>{direction === 'encode' ? 'Plain text' : 'Base32'}</span>
            <span class="field__hint">{input.length.toLocaleString()} characters</span>
          </label>
          <textarea
            id="b32-input"
            class="textarea"
            spellcheck={false}
            autocomplete="off"
            placeholder={
              direction === 'encode'
                ? 'Type or paste text to encode…'
                : 'Paste base32 to decode, e.g. a TOTP secret key…'
            }
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane
          label={direction === 'encode' ? 'Base32' : 'Decoded text'}
          value={output}
          placeholder={direction === 'encode' ? 'Encoded output appears here.' : 'Decoded text appears here.'}
          describe={direction === 'encode' ? 'base32' : 'decoded text'}
        />
      </div>

      <ErrorMessage message={error} />
    </div>
  );
}
