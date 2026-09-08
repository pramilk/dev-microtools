import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  renderTextBanner,
  validateFillChar,
  FILL_PRESETS,
  CUSTOM_FILL_ID,
  DEFAULT_FILL_ID,
  DEFAULT_TEXT_BANNER_OPTIONS,
  MIN_SCALE,
  MAX_SCALE,
  MIN_LETTER_SPACING,
  MAX_LETTER_SPACING,
  MAX_LINE_LENGTH,
  MAX_LINES,
} from '../lib/tools/textBanner';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

const SAMPLE = 'HELLO WORLD';

// Seeded to something other than any preset's own character, the same reasoning as ASCII
// Art Generator's custom-ramp field: this is where a visitor types their own choice, so it
// shouldn't open already showing one of the one-click options.
const DEFAULT_CUSTOM_FILL_CHAR = '$';

interface ShareState {
  text: string;
  fillId: string;
  customFillChar: string;
  scale: number;
  letterSpacing: number;
}

export default function TextBannerGenerator() {
  const [text, setText] = useState('');
  const [fillId, setFillId] = useState<string>(DEFAULT_FILL_ID);
  const [customFillChar, setCustomFillChar] = useState(DEFAULT_CUSTOM_FILL_CHAR);
  const [scale, setScale] = useState(DEFAULT_TEXT_BANNER_OPTIONS.scale);
  const [letterSpacing, setLetterSpacing] = useState(DEFAULT_TEXT_BANNER_OPTIONS.letterSpacing);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setText(state.text);
      setFillId(state.fillId);
      setCustomFillChar(state.customFillChar);
      setScale(state.scale);
      setLetterSpacing(state.letterSpacing);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const fillChar =
    fillId === CUSTOM_FILL_ID ? customFillChar : (FILL_PRESETS.find((preset) => preset.id === fillId)?.char ?? FILL_PRESETS[0]!.char);
  const fillCheck = validateFillChar(fillChar);

  const result = useMemo(() => {
    if (!fillCheck.ok) return null;
    return renderTextBanner(text, { fillChar, scale, letterSpacing });
  }, [text, fillChar, fillCheck.ok, scale, letterSpacing]);

  const output = result?.ok ? result.value.output : '';
  const unsupportedCharacters = result?.ok ? result.value.unsupportedCharacters : [];
  const error = !fillCheck.ok ? fillCheck.error : result && !result.ok ? result.error : null;

  const loadExample = () => setText(SAMPLE);
  const clear = () => setText('');

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Actions">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ text, fillId, customFillChar, scale, letterSpacing })} describe="this banner" />
        <button type="button" class="btn" onClick={loadExample} title="Load example text">
          Load example
        </button>
        <button type="button" class="btn" onClick={clear} disabled={text === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="tb-input">
          <span>Text</span>
          <span class="field__hint">
            Up to {MAX_LINES} lines, {MAX_LINE_LENGTH} characters each — one banner per line
          </span>
        </label>
        <textarea
          id="tb-input"
          class="textarea textarea--short"
          spellcheck={false}
          placeholder="Type or paste text here…"
          maxLength={(MAX_LINE_LENGTH + 1) * MAX_LINES}
          value={text}
          onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
        />
      </div>

      <div class="tb-controls">
        <div class="tb-control">
          <span class="field__hint">Fill character</span>
          <div class="seg" role="group" aria-label="Fill character">
            {FILL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                class="seg__btn"
                aria-pressed={fillId === preset.id}
                onClick={() => setFillId(preset.id)}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              class="seg__btn"
              aria-pressed={fillId === CUSTOM_FILL_ID}
              onClick={() => setFillId(CUSTOM_FILL_ID)}
              title="Type your own single fill character"
            >
              Custom
            </button>
          </div>
        </div>

        {fillId === CUSTOM_FILL_ID && (
          <div class="tb-control">
            <span class="field__hint" id="tb-custom-fill-label">
              Character
            </span>
            <input
              class="input"
              style="width:4rem"
              type="text"
              spellcheck={false}
              autocomplete="off"
              maxLength={4}
              value={customFillChar}
              aria-labelledby="tb-custom-fill-label"
              title="Exactly one character, used for every ink cell"
              onInput={(event) => setCustomFillChar((event.target as HTMLInputElement).value)}
            />
          </div>
        )}

        <label class="tb-control" title="How large each letter is — every font cell repeats this many times in both directions">
          <span class="field__hint">Size ({scale}x)</span>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            value={scale}
            aria-label="Size"
            onInput={(event) => setScale(Number((event.target as HTMLInputElement).value))}
          />
        </label>

        <label class="tb-control" title="Blank columns inserted between letters">
          <span class="field__hint">Letter spacing ({letterSpacing})</span>
          <input
            type="range"
            min={MIN_LETTER_SPACING}
            max={MAX_LETTER_SPACING}
            value={letterSpacing}
            aria-label="Letter spacing"
            onInput={(event) => setLetterSpacing(Number((event.target as HTMLInputElement).value))}
          />
        </label>
      </div>

      <ErrorMessage message={error} />

      {unsupportedCharacters.length > 0 && (
        <p class="msg msg--warning" role="alert">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>
            {unsupportedCharacters.length === 1 ? 'This character isn’t' : 'These characters aren’t'} in the built-in font, so{' '}
            {unsupportedCharacters.length === 1 ? 'it was' : 'they were'} rendered as a blank space:{' '}
            {unsupportedCharacters.map((char) => `"${char}"`).join(', ')}.
          </span>
        </p>
      )}

      <OutputPane
        label="Banner"
        value={output}
        placeholder="Your text banner appears here."
        tall
        describe="the text banner"
        actions={<DownloadButton value={output} filename="text-banner.txt" describe="the text banner" />}
      />

      <style>{`
        .tb-controls {
          display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-end;
          margin-top: var(--space-3);
        }
        .tb-control { display: flex; flex-direction: column; gap: var(--space-1); cursor: default; }
        .tb-control input[type="range"] { cursor: pointer; }
      `}</style>
    </div>
  );
}
