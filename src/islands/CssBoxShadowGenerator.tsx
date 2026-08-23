import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildBoxShadowCss,
  buildBoxShadowDeclaration,
  DEFAULT_SHADOW_LAYER,
  SHADOW_PRESETS,
  type ShadowLayer,
} from '../lib/tools/boxShadow';
import { parseColor, rgbToHex } from '../lib/tools/color';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

let nextLayerId = 0;
const withId = (layer: ShadowLayer) => ({ ...layer, id: nextLayerId++ });

/** Builds an rgba() string from a hex color and a 0-100 opacity, for the swatch + opacity slider. */
function withOpacity(hex: string, opacityPercent: number): string {
  const parsed = parseColor(hex);
  if (!parsed.ok) return hex;
  const alpha = Math.round((opacityPercent / 100) * 100) / 100;
  return `rgb(${parsed.value.r} ${parsed.value.g} ${parsed.value.b} / ${alpha})`;
}

/** Reads the opaque hex and 0-100 opacity out of a layer's color string, for the swatch + slider. */
function readColorParts(color: string): { hex: string; opacityPercent: number } {
  const parsed = parseColor(color);
  if (!parsed.ok) return { hex: '#000000', opacityPercent: 100 };
  return { hex: rgbToHex({ ...parsed.value, a: 1 }), opacityPercent: Math.round(parsed.value.a * 100) };
}

const RANGE_FIELDS: { key: 'offsetX' | 'offsetY' | 'blur' | 'spread'; label: string; min: number; max: number }[] = [
  { key: 'offsetX', label: 'Offset X', min: -50, max: 50 },
  { key: 'offsetY', label: 'Offset Y', min: -50, max: 50 },
  { key: 'blur', label: 'Blur', min: 0, max: 100 },
  { key: 'spread', label: 'Spread', min: -50, max: 50 },
];

export default function CssBoxShadowGenerator() {
  const [layers, setLayers] = useState(() => [withId(DEFAULT_SHADOW_LAYER)]);

  useEffect(() => {
    void readShareStateFromLocation<ShadowLayer[]>().then((restored) => {
      if (!restored?.ok) return;
      setLayers(restored.value.map(withId));
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const plainLayers = useMemo(() => layers.map(({ id: _id, ...layer }) => layer), [layers]);
  const cssResult = useMemo(() => buildBoxShadowCss(plainLayers), [plainLayers]);
  const declarationResult = useMemo(() => buildBoxShadowDeclaration(plainLayers), [plainLayers]);
  const css = cssResult.ok ? cssResult.value : '';
  const declaration = declarationResult.ok ? declarationResult.value : '';
  const error = !cssResult.ok ? cssResult.error : null;

  const updateLayer = (id: number, patch: Partial<ShadowLayer>) =>
    setLayers((prev) => prev.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));

  const addLayer = () => setLayers((prev) => [...prev, withId({ ...DEFAULT_SHADOW_LAYER })]);
  const removeLayer = (id: number) => setLayers((prev) => prev.filter((layer) => layer.id !== id));

  const applyPreset = (preset: (typeof SHADOW_PRESETS)[number]) => {
    setLayers(preset.layers.map(withId));
  };

  return (
    <div class="tool">
      <div class="preview" aria-hidden="true">
        <div class="preview__box" style={css ? `box-shadow:${css}` : undefined} />
      </div>

      <div class="presets" role="group" aria-label="Shadow presets">
        {SHADOW_PRESETS.map((preset) => {
          const previewCss = buildBoxShadowCss(preset.layers);
          return (
            <button
              key={preset.name}
              type="button"
              class="preset-chip"
              onClick={() => applyPreset(preset)}
              title={`Use the "${preset.name}" preset as a starting point`}
            >
              <span class="preset-chip__swatch" style={previewCss.ok ? `box-shadow:${previewCss.value}` : undefined} />
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>

      <div class="layers">
        {layers.map((layer, index) => {
          const { hex, opacityPercent } = readColorParts(layer.color);

          return (
            <div class="layer" key={layer.id}>
              <div class="layer__header">
                <span class="field__hint">Layer {index + 1}</span>
                <label class="checkbox">
                  <input
                    type="checkbox"
                    checked={layer.inset}
                    onChange={() => updateLayer(layer.id, { inset: !layer.inset })}
                  />
                  <span>Inset</span>
                </label>
                <span class="tool-bar__spacer" />
                <button
                  type="button"
                  class="btn"
                  disabled={layers.length <= 1}
                  title={layers.length <= 1 ? 'At least one shadow layer is required' : 'Remove this layer'}
                  onClick={() => removeLayer(layer.id)}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>

              <div class="layer__grid">
                {RANGE_FIELDS.map(({ key, label, min, max }) => (
                  <label class="field" key={key}>
                    <span class="field__label" style="min-height:auto">
                      <span>{label}</span>
                      <span class="field__hint tnum">{layer[key]}px</span>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={layer[key]}
                      style={`width:100%;accent-color:${hex}`}
                      aria-label={`Layer ${index + 1} ${label}`}
                      onInput={(event) => updateLayer(layer.id, { [key]: Number((event.target as HTMLInputElement).value) })}
                    />
                  </label>
                ))}
              </div>

              <div class="color-row">
                <div class="color-row__pair">
                  <label class="field" style="flex:0 0 auto">
                    <span class="field__hint">Color</span>
                    <input
                      type="color"
                      class="color-picker"
                      value={hex}
                      aria-label={`Layer ${index + 1} color swatch`}
                      onInput={(event) =>
                        updateLayer(layer.id, { color: withOpacity((event.target as HTMLInputElement).value, opacityPercent) })
                      }
                    />
                  </label>
                  <label class="field" style="flex:1 1 12rem">
                    <span class="field__hint">Color value</span>
                    <input
                      type="text"
                      class="input"
                      spellcheck={false}
                      autocomplete="off"
                      value={layer.color}
                      aria-label={`Layer ${index + 1} color value`}
                      onInput={(event) => updateLayer(layer.id, { color: (event.target as HTMLInputElement).value })}
                    />
                  </label>
                </div>
                <label class="field" style="flex:1 1 8rem">
                  <span class="field__label" style="min-height:auto">
                    <span>Opacity</span>
                    <span class="field__hint tnum">{opacityPercent}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={opacityPercent}
                    style={`width:100%;accent-color:${hex}`}
                    aria-label={`Layer ${index + 1} opacity`}
                    onInput={(event) =>
                      updateLayer(layer.id, { color: withOpacity(hex, Number((event.target as HTMLInputElement).value)) })
                    }
                  />
                </label>
              </div>
            </div>
          );
        })}
        <button type="button" class="btn" onClick={addLayer} title="Add another shadow layer">
          <span aria-hidden="true">+</span> Add layer
        </button>
      </div>

      <ErrorMessage message={error} />

      {declaration && (
        <div class="field">
          <div class="field__label">
            <span>CSS</span>
            <span class="tool-bar__group">
              <ShareLinkButton getState={() => plainLayers} describe="this shadow" />
              <CopyButton value={declaration} describe="box-shadow CSS" />
            </span>
          </div>
          <pre class="output" tabIndex={0}>
            {declaration}
          </pre>
        </div>
      )}

      <style>{`
        .preview {
          border-radius: var(--radius-lg); border: 1px solid var(--border);
          min-height: 12rem; background: var(--surface-2);
          display: flex; align-items: center; justify-content: center; padding: var(--space-6);
        }
        .preview__box {
          width: 7rem; height: 7rem; border-radius: var(--radius);
          /* Fixed light background regardless of site theme — most shadow colors are
             dark and semi-transparent, so they only read clearly against a light card,
             the same convention every box-shadow tool uses (and how these shadows will
             actually be used in most real designs). */
          background: #f4f5f7;
        }
        .layers { display: flex; flex-direction: column; gap: var(--space-3); }
        .layer {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-3);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .layer__header { display: flex; align-items: center; gap: var(--space-3); }
        .layer__grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
          gap: var(--space-3);
        }
        .layer__grid .input { width: 100%; }
        .color-row { display: flex; align-items: flex-end; gap: var(--space-3); flex-wrap: wrap; }
        .color-row__pair { display: flex; align-items: flex-end; gap: var(--space-2); flex: 1 1 16rem; }
        .color-picker {
          width: 2.4rem; height: 2.25rem; padding: 2px; cursor: pointer;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface);
        }
        .presets {
          display: flex; flex-wrap: wrap; gap: var(--space-2);
        }
        .preset-chip {
          display: inline-flex; align-items: center; gap: var(--space-2);
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text);
          cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .preset-chip__swatch {
          width: 1.5rem; height: 1.5rem; border-radius: var(--radius-sm);
          background: #f4f5f7; flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
