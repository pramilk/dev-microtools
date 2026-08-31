import { useEffect, useMemo, useState } from 'preact/hooks';
import { generateSlug, DEFAULT_SLUG_OPTIONS, MAX_SLUG_LENGTH, type SlugOptions } from '../lib/tools/slug';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';

const SAMPLE = '10 Best JavaScript Frameworks to Learn in 2026!';

interface ShareState {
  input: string;
  options: SlugOptions;
}

export default function SlugGenerator() {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<SlugOptions>(DEFAULT_SLUG_OPTIONS);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setOptions(restored.value.options);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : generateSlug(input, options)), [input, options]);
  const slug = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, options })} describe="this text and its settings" />
        <button type="button" class="btn" onClick={() => setInput(SAMPLE)} title="Load example text">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="slug-input">
          <span>Text</span>
          <span class="field__hint">A title, heading or filename to convert into a slug</span>
        </label>
        <input
          id="slug-input"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder="10 Best JavaScript Frameworks to Learn in 2026!"
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <span class="field__label">Options</span>
        <div class="tool-bar">
          <div class="seg" role="group" aria-label="Separator" title="Character used to join words">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.separator === '-'}
              onClick={() => setOptions((prev) => ({ ...prev, separator: '-' }))}
            >
              Hyphen (-)
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={options.separator === '_'}
              onClick={() => setOptions((prev) => ({ ...prev, separator: '_' }))}
            >
              Underscore (_)
            </button>
          </div>
          <label class="checkbox" title="Turn off to keep the original letter casing">
            <input
              type="checkbox"
              checked={options.lowercase}
              onChange={() => setOptions((prev) => ({ ...prev, lowercase: !prev.lowercase }))}
            />
            <span>Lowercase</span>
          </label>
          <label class="checkbox" title={`Cut the slug to this many characters without splitting a word (0 = no limit, max ${MAX_SLUG_LENGTH})`}>
            <span class="field__hint">Max length</span>
            <input
              type="number"
              class="input"
              style="width:6rem"
              min={0}
              max={MAX_SLUG_LENGTH}
              placeholder="none"
              value={options.maxLength === 0 ? '' : options.maxLength}
              aria-label="Max length (0 for no limit)"
              onInput={(event) => {
                const raw = (event.target as HTMLInputElement).value;
                setOptions((prev) => ({ ...prev, maxLength: raw === '' ? 0 : Number(raw) }));
              }}
            />
          </label>
        </div>
      </div>

      <ErrorMessage message={error} />

      <OutputPane label="Slug" value={slug} placeholder="A URL-friendly slug appears here." describe="the slug" />
    </div>
  );
}
