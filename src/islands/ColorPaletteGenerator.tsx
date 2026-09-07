import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  generatePalette,
  sanitizePaletteName,
  exportCssVariables,
  exportTailwindConfig,
  exportScssVariables,
  exportJson,
  textOnFor,
  type Shade,
} from '../lib/tools/colorPalette';
import { parseColor, rgbToHex, NAMED_COLOR_NAMES } from '../lib/tools/color';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useCopy } from './shared/useCopy';

const PRESETS = ['#3cbcd4', '#0b6e80', '#b3261e', '#1a7f45', '#f5a524', '#6b21a8'];

type ExportFormat = 'css' | 'tailwind' | 'scss' | 'json';

interface ShareState {
  input: string;
  name: string;
}

function Swatch({ hex, textOn, topLabel, bottomLabel }: { hex: string; textOn: 'black' | 'white'; topLabel?: string; bottomLabel: string }) {
  const { state, copy } = useCopy();
  return (
    <button
      type="button"
      class="swatch"
      style={`background:${hex}; color:${textOn};`}
      onClick={() => void copy(hex)}
      title={`Copy ${hex} to clipboard`}
    >
      {topLabel && <span class="swatch__top">{topLabel}</span>}
      <span class="swatch__hex">{state === 'copied' ? 'Copied' : hex}</span>
      <span class="swatch__bottom">{bottomLabel}</span>
    </button>
  );
}

function HarmonyRow({ label, colors, hint }: { label: string; colors: string[]; hint: string }) {
  return (
    <div class="field">
      <span class="field__label" title={hint}>
        <span>{label}</span>
      </span>
      <div class="harmony-row">
        {colors.map((hex, index) => (
          <Swatch key={`${label}-${hex}-${index}`} hex={hex} textOn={textOnFor(hex)} bottomLabel={hex} />
        ))}
      </div>
    </div>
  );
}

export default function ColorPaletteGenerator() {
  const [input, setInput] = useState('#3cbcd4');
  const [name, setName] = useState('brand');
  const [format, setFormat] = useState<ExportFormat>('css');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setName(restored.value.name || 'brand');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : generatePalette(input)), [input]);
  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const swatch = useMemo(() => {
    const parsed = parseColor(input);
    return parsed.ok ? rgbToHex({ ...parsed.value, a: 1 }) : null;
  }, [input]);

  const exportCode = useMemo(() => {
    if (!value) return '';
    switch (format) {
      case 'css':
        return exportCssVariables(value.shades, name);
      case 'tailwind':
        return exportTailwindConfig(value.shades, name);
      case 'scss':
        return exportScssVariables(value.shades, name);
      case 'json':
        return exportJson(value.shades);
    }
  }, [value, format, name]);

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="field" style="flex:1 1 16rem">
          <label class="field__label" for="palette-input">
            <span>Base color</span>
            <span class="field__hint">hex, rgb() or hsl()</span>
          </label>
          <input
            id="palette-input"
            class="input"
            spellcheck={false}
            autocomplete="off"
            list="palette-color-names"
            placeholder="#3cbcd4 or a name like teal"
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLInputElement).value)}
          />
          <datalist id="palette-color-names">
            {NAMED_COLOR_NAMES.map((colorName) => (
              <option key={colorName} value={colorName} />
            ))}
          </datalist>
        </div>

        <div class="field">
          <label class="field__label" for="palette-picker">
            <span>Pick</span>
          </label>
          <input
            id="palette-picker"
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
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={(): ShareState => ({ input, name })} describe="this palette" />
      </div>

      <ErrorMessage message={error} />

      {value && (
        <>
          <div class="field">
            <span class="field__label">Shade scale</span>
            <div class="shade-row">
              {value.shades.map((shade: Shade) => (
                <Swatch
                  key={shade.step}
                  hex={shade.hex}
                  textOn={shade.textOn}
                  topLabel={shade.isClosestToBase ? 'Base' : undefined}
                  bottomLabel={String(shade.step)}
                />
              ))}
            </div>
            <p class="field__hint">Click a swatch to copy its hex value. "Base" marks the step closest to the colour you entered.</p>
          </div>

          <HarmonyRow label="Complementary" colors={value.harmonies.complementary} hint="The base colour and its opposite on the colour wheel" />
          <HarmonyRow label="Analogous" colors={value.harmonies.analogous} hint="The base colour with its two neighbours on the colour wheel" />
          <HarmonyRow label="Triadic" colors={value.harmonies.triadic} hint="Three colours evenly spaced around the colour wheel" />
          <HarmonyRow
            label="Split-complementary"
            colors={value.harmonies.splitComplementary}
            hint="The base colour plus the two neighbours of its opposite"
          />
          <HarmonyRow label="Tetradic" colors={value.harmonies.tetradic} hint="Four colours evenly spaced around the colour wheel" />

          <div class="field">
            <label class="field__label" for="palette-name">
              <span>Export</span>
            </label>
            <div class="export-controls">
              <input
                id="palette-name"
                class="input export-name"
                spellcheck={false}
                autocomplete="off"
                placeholder="brand"
                value={name}
                onInput={(event) => setName((event.target as HTMLInputElement).value)}
                title="Used as the variable/key prefix in the exported code"
              />
              <div class="seg" role="group" aria-label="Export format">
                {(
                  [
                    ['css', 'CSS'],
                    ['tailwind', 'Tailwind'],
                    ['scss', 'SCSS'],
                    ['json', 'JSON'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    class="seg__btn"
                    aria-pressed={format === key}
                    onClick={() => setFormat(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <span class="field__hint">Used as: --color-{sanitizePaletteName(name)}-500, or the "{sanitizePaletteName(name)}" key.</span>
          </div>

          <OutputPane
            label="Generated code"
            value={exportCode}
            placeholder=""
            tall
            describe="the generated palette code"
          />
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
        .shade-row, .harmony-row {
          display: flex; flex-wrap: wrap; gap: var(--space-2);
        }
        .swatch {
          flex: 1 1 5rem; min-width: 4.5rem; min-height: 4.5rem;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 0.2rem; padding: var(--space-2);
          font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600;
          cursor: pointer;
        }
        .swatch__top { font-size: 0.65rem; text-transform: uppercase; letter-spacing: .06em; opacity: 0.85; }
        .swatch__hex { font-size: var(--text-xs); }
        .swatch__bottom { font-size: 0.65rem; opacity: 0.85; }
        .export-controls { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
        .export-name { max-width: 12rem; }
      `}</style>
    </div>
  );
}
