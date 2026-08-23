import { useMemo, useState } from 'preact/hooks';
import {
  convertColor,
  parseColor,
  rgbToHex,
  nearestAccessibleShade,
  NAMED_COLOR_NAMES,
} from '../lib/tools/color';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';

const PRESETS = ['#3cbcd4', '#0b6e80', '#b3261e', '#1a7f45', '#f5a524', '#6b21a8'];

/** WCAG thresholds, so the contrast numbers mean something actionable. */
function contrastVerdict(ratio: number): { label: string; tone: 'success' | 'warning' | 'error' } {
  if (ratio >= 7) return { label: 'AAA', tone: 'success' };
  if (ratio >= 4.5) return { label: 'AA', tone: 'success' };
  if (ratio >= 3) return { label: 'AA large text only', tone: 'warning' };
  return { label: 'Fails WCAG', tone: 'error' };
}

export default function ColorConverter() {
  const [input, setInput] = useState('#3cbcd4');

  const result = useMemo(() => (input.trim() === '' ? null : convertColor(input)), [input]);
  const swatch = useMemo(() => {
    const parsed = parseColor(input);
    return parsed.ok ? rgbToHex({ ...parsed.value, a: 1 }) : null;
  }, [input]);

  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const white = value ? contrastVerdict(value.contrastWhite) : null;
  const black = value ? contrastVerdict(value.contrastBlack) : null;

  const parsedRgb = useMemo(() => {
    const parsed = parseColor(input);
    return parsed.ok ? parsed.value : null;
  }, [input]);

  // Only worth suggesting a fix once AA (4.5:1) actually fails — anything at or
  // above that is already a legible choice.
  const whiteSuggestion = useMemo(
    () =>
      parsedRgb && value && value.contrastWhite < 4.5
        ? nearestAccessibleShade(parsedRgb, 'white')
        : null,
    [parsedRgb, value]
  );
  const blackSuggestion = useMemo(
    () =>
      parsedRgb && value && value.contrastBlack < 4.5
        ? nearestAccessibleShade(parsedRgb, 'black')
        : null,
    [parsedRgb, value]
  );

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="field" style="flex:1 1 16rem">
          <label class="field__label" for="color-input">
            <span>Color</span>
            <span class="field__hint">hex, rgb() or hsl()</span>
          </label>
          <input
            id="color-input"
            class="input"
            spellcheck={false}
            autocomplete="off"
            list="color-names"
            placeholder="#3cbcd4 or a name like teal"
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLInputElement).value)}
          />
          <datalist id="color-names">
            {NAMED_COLOR_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div class="field">
          <label class="field__label" for="color-picker">
            <span>Pick</span>
          </label>
          <input
            id="color-picker"
            type="color"
            class="color-picker"
            value={swatch ?? '#000000'}
            aria-label="Choose a colour visually"
            onInput={(event) => setInput((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <div class="tool-bar" role="group" aria-label="Preset colours">
        <span class="field__hint">Presets</span>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            class="preset"
            style={`background:${preset}`}
            aria-label={`Use ${preset}`}
            title={preset}
            onClick={() => setInput(preset)}
          />
        ))}
      </div>

      <ErrorMessage message={error} />

      {value && (
        <>
          <div class="preview" style={`background:${value.hex}`} aria-hidden="true">
            <span class="preview__chip preview__chip--light">Aa on white</span>
            <span class="preview__chip preview__chip--dark">Aa on black</span>
          </div>

          <dl class="color-grid">
            {(
              [
                ['HEX', value.hex],
                ['RGB', value.rgb],
                ['HSL', value.hsl],
                ['OKLCH', value.oklch],
              ] as const
            ).map(([label, formatted]) => (
              <>
                <dt key={`k-${label}`}>{label}</dt>
                <dd key={`v-${label}`}>
                  <code>{formatted}</code>
                  <CopyButton value={formatted} describe={`${label} value`} />
                </dd>
              </>
            ))}
          </dl>

          <div class="contrast">
            <h3 class="contrast__title">Contrast</h3>
            <p class="contrast__row">
              <span>Against white</span>
              <strong class="tnum">{value.contrastWhite.toFixed(2)}:1</strong>
              <span class={`badge badge--${white!.tone}`}>{white!.label}</span>
            </p>
            {whiteSuggestion && (
              <p class="contrast__suggestion">
                Try{' '}
                <button type="button" class="swatch-btn" onClick={() => setInput(rgbToHex(whiteSuggestion))}>
                  <span class="swatch-btn__chip" style={`background:${rgbToHex(whiteSuggestion)}`} aria-hidden="true" />
                  <code>{rgbToHex(whiteSuggestion)}</code>
                </button>{' '}
                instead — the closest shade of this colour that reaches 4.5:1 on white.
              </p>
            )}
            <p class="contrast__row">
              <span>Against black</span>
              <strong class="tnum">{value.contrastBlack.toFixed(2)}:1</strong>
              <span class={`badge badge--${black!.tone}`}>{black!.label}</span>
            </p>
            {blackSuggestion && (
              <p class="contrast__suggestion">
                Try{' '}
                <button type="button" class="swatch-btn" onClick={() => setInput(rgbToHex(blackSuggestion))}>
                  <span class="swatch-btn__chip" style={`background:${rgbToHex(blackSuggestion)}`} aria-hidden="true" />
                  <code>{rgbToHex(blackSuggestion)}</code>
                </button>{' '}
                instead — the closest shade of this colour that reaches 4.5:1 on black.
              </p>
            )}
            <p class="field__hint">
              WCAG asks for 4.5:1 for normal body text and 3:1 for large text.
            </p>
          </div>
        </>
      )}

      <style>{`
        .color-picker {
          width: 3rem; height: 2.4rem; padding: 2px; cursor: pointer;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface);
        }
        .preset {
          width: 1.75rem; height: 1.75rem; border-radius: var(--radius-sm); cursor: pointer;
          border: 1px solid var(--border-strong);
        }
        .preview {
          border-radius: var(--radius-lg); border: 1px solid var(--border);
          min-height: 6rem; display: flex; align-items: center; justify-content: center;
          gap: var(--space-4); flex-wrap: wrap;
        }
        .preview__chip {
          padding: .35rem .75rem; border-radius: var(--radius);
          font-size: var(--text-sm); font-weight: 600;
        }
        .preview__chip--light { background: #fff; color: #000; }
        .preview__chip--dark  { background: #000; color: #fff; }
        .color-grid {
          display: grid; grid-template-columns: minmax(4rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .color-grid dt {
          font-family: var(--font-mono); color: var(--text-muted);
          font-size: var(--text-xs); letter-spacing: .06em;
        }
        .color-grid dd {
          margin: 0; display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-3); min-width: 0;
        }
        .color-grid code { word-break: break-all; }
        .contrast {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-2);
        }
        .contrast__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .contrast__row {
          display: flex; align-items: center; gap: var(--space-3);
          font-size: var(--text-sm); margin: 0;
        }
        .contrast__row > span:first-child { min-width: 8rem; color: var(--text-muted); }
        .badge {
          font-size: var(--text-xs); font-weight: 600; padding: .1em .6em;
          border-radius: 99px; border: 1px solid;
        }
        .badge--success {
          color: var(--success); background: var(--success-subtle); border-color: var(--success-border);
        }
        .badge--warning {
          color: var(--warning); background: var(--warning-subtle); border-color: var(--warning-border);
        }
        .badge--error {
          color: var(--danger); background: var(--danger-subtle); border-color: var(--danger-border);
        }
        .contrast__suggestion {
          margin: 0; font-size: var(--text-xs); color: var(--text-muted);
          display: flex; align-items: center; gap: .3em; flex-wrap: wrap;
        }
        .swatch-btn {
          display: inline-flex; align-items: center; gap: .4em;
          border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          background: var(--surface); padding: .1em .5em; cursor: pointer;
          font: inherit; font-size: var(--text-xs); color: var(--text);
        }
        .swatch-btn:hover { background: var(--surface-2); }
        .swatch-btn__chip {
          width: .9em; height: .9em; border-radius: 3px; border: 1px solid var(--border-strong);
        }
      `}</style>
    </div>
  );
}
