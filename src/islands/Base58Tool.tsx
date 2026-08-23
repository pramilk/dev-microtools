import { useEffect, useMemo, useState } from 'preact/hooks';
import { encodeBase58, decodeBase58 } from '../lib/tools/base58';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Direction = 'encode' | 'decode';

interface ShareState {
  input: string;
  direction: Direction;
}

// The official Bitcoin base58_encode_decode.json test vector, matching the worked
// example in the tool's own content page.
const SAMPLE_PLAIN = 'hello world';
const SAMPLE_ENCODED = 'StV1DL6CwTryKyV';

export default function Base58Tool() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setDirection(restored.value.direction);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => {
    if (input === '') return null;
    return direction === 'encode' ? encodeBase58(input) : decodeBase58(input);
  }, [input, direction]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;

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
            title="Convert plain text into Base58"
          >
            Encode
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decode'}
            onClick={() => setDirection('decode')}
            title="Convert Base58 back into plain text"
          >
            Decode
          </button>
        </div>

        <span class="tool-bar__spacer" />

        <ShareLinkButton getState={() => ({ input, direction })} describe="this text" />
        <button
          type="button"
          class="btn"
          onClick={() => setInput(direction === 'encode' ? SAMPLE_PLAIN : SAMPLE_ENCODED)}
          title="Load a small example — an official Base58 test vector"
        >
          Load example
        </button>
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
          <label class="field__label" for="b58-input">
            <span>{direction === 'encode' ? 'Plain text' : 'Base58'}</span>
            <span class="field__hint">{input.length.toLocaleString()} characters</span>
          </label>
          <textarea
            id="b58-input"
            class="textarea"
            spellcheck={false}
            autocomplete="off"
            placeholder={
              direction === 'encode'
                ? 'Type or paste text to encode…'
                : 'Paste Base58 to decode… (never 0, O, I or l)'
            }
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane
          label={direction === 'encode' ? 'Base58' : 'Decoded text'}
          value={output}
          placeholder={direction === 'encode' ? 'Encoded output appears here.' : 'Decoded text appears here.'}
          describe={direction === 'encode' ? 'Base58' : 'decoded text'}
        />
      </div>

      <ErrorMessage message={error} />
    </div>
  );
}
