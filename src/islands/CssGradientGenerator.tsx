import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildGradientCss,
  buildGradientDeclaration,
  GRADIENT_TYPES,
  GRADIENT_PRESETS,
  DEFAULT_GRADIENT_OPTIONS,
  type GradientOptions,
  type GradientPreset,
  type GradientStop,
  type GradientType,
} from '../lib/tools/gradient';
import { parseColor, rgbToHex } from '../lib/tools/color';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

const TYPE_LABELS: Record<GradientType, string> = { linear: 'Linear', radial: 'Radial', conic: 'Conic' };
const POSITION_PRESETS = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'];

let nextStopId = 0;
const withId = (stop: GradientStop) => ({ ...stop, id: nextStopId++ });

/** Normalises a stop's colour (any format `parseColor` accepts) to an opaque hex, for the swatch and the position slider's accent colour. */
function stopHex(color: string): string {
  const parsed = parseColor(color);
  return parsed.ok ? rgbToHex({ ...parsed.value, a: 1 }) : '#000000';
}

export default function CssGradientGenerator() {
  const [type, setType] = useState<GradientType>(DEFAULT_GRADIENT_OPTIONS.type);
  const [angle, setAngle] = useState(DEFAULT_GRADIENT_OPTIONS.angle);
  const [shape, setShape] = useState(DEFAULT_GRADIENT_OPTIONS.shape);
  const [position, setPosition] = useState(DEFAULT_GRADIENT_OPTIONS.position);
  const [stops, setStops] = useState(() => DEFAULT_GRADIENT_OPTIONS.stops.map(withId));

  useEffect(() => {
    void readShareStateFromLocation<GradientOptions>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setType(state.type);
      setAngle(state.angle);
      setShape(state.shape);
      setPosition(state.position);
      setStops(state.stops.map(withId));
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const options: GradientOptions = useMemo(
    () => ({ type, angle, shape, position, stops: stops.map(({ id: _id, ...stop }) => stop) }),
    [type, angle, shape, position, stops]
  );

  const cssResult = useMemo(() => buildGradientCss(options), [options]);
  const declarationResult = useMemo(() => buildGradientDeclaration(options), [options]);
  const css = cssResult.ok ? cssResult.value : '';
  const declaration = declarationResult.ok ? declarationResult.value : '';
  const error = !cssResult.ok ? cssResult.error : null;

  const updateStop = (id: number, patch: Partial<GradientStop>) =>
    setStops((prev) => prev.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)));

  const addStop = () =>
    setStops((prev) => [...prev, withId({ color: '#ffffff', position: 50 })]);

  const removeStop = (id: number) => setStops((prev) => prev.filter((stop) => stop.id !== id));

  const applyPreset = (preset: GradientPreset) => setStops(preset.stops.map(withId));

  return (
    <div class="tool">
      <div class="presets" role="group" aria-label="Gradient presets">
        {GRADIENT_PRESETS.map((preset) => {
          const previewCss = buildGradientCss({ ...DEFAULT_GRADIENT_OPTIONS, type: 'linear', angle: 90, stops: preset.stops });
          return (
            <button
              key={preset.name}
              type="button"
              class="preset-chip"
              onClick={() => applyPreset(preset)}
              title={`Use the "${preset.name}" colours as a starting point`}
            >
              <span class="preset-chip__swatch" style={previewCss.ok ? `background:${previewCss.value}` : undefined} />
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>

      <div class="tool-bar" role="group" aria-label="Gradient type">
        <div class="seg">
          {GRADIENT_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              class="seg__btn"
              aria-pressed={type === value}
              onClick={() => setType(value)}
            >
              {TYPE_LABELS[value]}
            </button>
          ))}
        </div>

        {(type === 'linear' || type === 'conic') && (
          <label class="checkbox" title="Direction the gradient rotates from">
            <span class="field__hint">Angle</span>
            <input
              type="range"
              min={0}
              max={360}
              value={angle}
              style="width:10rem;accent-color:var(--accent)"
              aria-label="Gradient angle in degrees"
              onInput={(event) => setAngle(Number((event.target as HTMLInputElement).value))}
            />
            <span class="field__hint tnum">{angle}deg</span>
          </label>
        )}

        {type === 'radial' && (
          <div class="seg" role="group" aria-label="Radial shape">
            {(['circle', 'ellipse'] as const).map((value) => (
              <button
                key={value}
                type="button"
                class="seg__btn"
                aria-pressed={shape === value}
                onClick={() => setShape(value)}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        {(type === 'radial' || type === 'conic') && (
          <label class="checkbox">
            <span class="field__hint">Position</span>
            <select
              class="select"
              style="width:auto"
              value={position}
              aria-label="Gradient origin position"
              onChange={(event) => setPosition((event.target as HTMLSelectElement).value)}
            >
              {POSITION_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div class="preview" style={css ? `background:${css}` : undefined} aria-hidden="true" />

      <div class="stops">
        {stops.map((stop, index) => {
          const hex = stopHex(stop.color);

          return (
            <div class="stop-row" key={stop.id}>
              <input
                type="color"
                class="color-picker"
                value={hex}
                aria-label={`Stop ${index + 1} colour`}
                onInput={(event) => updateStop(stop.id, { color: (event.target as HTMLInputElement).value })}
              />
              <input
                type="text"
                class="input"
                style="flex:1 1 8rem"
                spellcheck={false}
                autocomplete="off"
                value={stop.color}
                aria-label={`Stop ${index + 1} colour value`}
                onInput={(event) => updateStop(stop.id, { color: (event.target as HTMLInputElement).value })}
              />
              <input
                type="range"
                min={0}
                max={100}
                value={stop.position}
                style={`accent-color:${hex};flex:1 1 8rem`}
                aria-label={`Stop ${index + 1} position`}
                onInput={(event) => updateStop(stop.id, { position: Number((event.target as HTMLInputElement).value) })}
              />
              <span class="field__hint tnum" style="width:3.5rem;text-align:right">
                {stop.position}%
              </span>
              <button
                type="button"
                class="btn"
                disabled={stops.length <= 2}
                title={stops.length <= 2 ? 'A gradient needs at least two stops' : 'Remove this stop'}
                onClick={() => removeStop(stop.id)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          );
        })}
        <button type="button" class="btn" onClick={addStop} title="Add another colour stop">
          <span aria-hidden="true">+</span> Add stop
        </button>
      </div>

      <ErrorMessage message={error} />

      {declaration && (
        <div class="field">
          <div class="field__label">
            <span>CSS</span>
            <span class="tool-bar__group">
              <ShareLinkButton getState={() => options} describe="this gradient" />
              <CopyButton value={declaration} describe="gradient CSS" />
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
          min-height: 10rem; background-color: var(--surface-2);
        }
        .stops { display: flex; flex-direction: column; gap: var(--space-2); }
        .stop-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .color-picker {
          width: 2.4rem; height: 2.25rem; padding: 2px; cursor: pointer;
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); flex-shrink: 0;
        }
        .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .preset-chip {
          display: inline-flex; align-items: center; gap: var(--space-2);
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text);
          cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .preset-chip__swatch {
          width: 1.5rem; height: 1.5rem; border-radius: var(--radius-sm); flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
