import { useEffect, useRef, useState } from 'preact/hooks';
import {
  optimizeSvg,
  MIN_SVG_PRECISION,
  MAX_SVG_PRECISION,
  DEFAULT_SVG_PRECISION,
  MIN_TRANSFORM_PRECISION,
  MAX_TRANSFORM_PRECISION,
  DEFAULT_TRANSFORM_PRECISION,
} from '../lib/tools/svgOptimize';
import { readShareStateFromLocation } from '../lib/shareLink';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

// Kept identical to `example.input` in src/content/tools/svg-optimizer.mdx, so the
// written example on the content page and the "Load example" button never drift apart.
const SAMPLE =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!-- Generator: Example Design Tool -->\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 100 100" xml:space="preserve">\n' +
  '  <desc>Created with Example Design Tool</desc>\n' +
  '  <g id="Layer_1">\n' +
  '    <g id="badge">\n' +
  '      <defs>\n' +
  '        <linearGradient id="ribbonGrad" x1="0" y1="0" x2="1" y2="0">\n' +
  '          <stop offset="0" stop-color="#3cbcd4" />\n' +
  '          <stop offset="1" stop-color="#7c5cff" />\n' +
  '        </linearGradient>\n' +
  '        <circle id="spark" cx="0" cy="0" r="6.123456789" fill="#ffd166" />\n' +
  '      </defs>\n' +
  '      <circle cx="50.000000" cy="50.000000" r="46.123456789" fill="#3cbcd4" />\n' +
  '      <circle cx="50.000000" cy="50.000000" r="38.987654321" fill="#ffffff" />\n' +
  '      <rect x="20.123456" y="80.123456" width="59.876543" height="10.123456" rx="5.123456" fill="url(#ribbonGrad)" />\n' +
  '      <path d="M32.123456,52.234567 L44.345678,64.456789 L69.567890,36.678901" fill="none" stroke="#3cbcd4" stroke-width="8.123456" stroke-linecap="round" stroke-linejoin="round" />\n' +
  '      <use href="#spark" transform="translate(80.123456,20.234567) scale(2.449999999)" />\n' +
  '      <use href="#spark" transform="translate(18.234567,22.123456) scale(2.449999999)" />\n' +
  '      <use href="#spark" transform="translate(50.123456,7.234567) scale(2.449999999)" />\n' +
  '    </g>\n' +
  '  </g>\n' +
  '</svg>\n';

interface ShareState {
  input: string;
  precision: number;
  transformPrecision: number;
  multipass: boolean;
  keepDescription: boolean;
  prefixIds: boolean;
}

/** Renders SVG markup safely for preview: an `<img src>` never executes embedded scripts or event handlers, unlike inline markup or an `<object>`/`<iframe>`. */
function svgPreviewUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export default function SvgOptimizer() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [precision, setPrecision] = useState(DEFAULT_SVG_PRECISION);
  const [transformPrecision, setTransformPrecision] = useState(DEFAULT_TRANSFORM_PRECISION);
  const [multipass, setMultipass] = useState(true);
  const [keepDescription, setKeepDescription] = useState(false);
  const [prefixIds, setPrefixIds] = useState(false);
  const requestId = useRef(0);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setPrecision(restored.value.precision ?? DEFAULT_SVG_PRECISION);
      setTransformPrecision(restored.value.transformPrecision ?? DEFAULT_TRANSFORM_PRECISION);
      setMultipass(restored.value.multipass ?? true);
      setKeepDescription(restored.value.keepDescription ?? false);
      setPrefixIds(restored.value.prefixIds ?? false);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    const id = (requestId.current += 1);

    if (input.trim() === '') {
      setOutput('');
      setError(null);
      return;
    }

    void optimizeSvg(input, { precision, transformPrecision, multipass, keepDescription, prefixIds }).then((result) => {
      // Ignore a stale response if the input or options changed again before this one resolved.
      if (id !== requestId.current) return;
      if (result.ok) {
        setOutput(result.value);
        setError(null);
      } else {
        setOutput('');
        setError(result.error);
      }
    });
  }, [input, precision, transformPrecision, multipass, keepDescription, prefixIds]);

  const originalBytes = new TextEncoder().encode(input).length;
  const optimizedBytes = new TextEncoder().encode(output).length;

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={() => ({ input, precision, transformPrecision, multipass, keepDescription, prefixIds })}
          describe="this SVG"
        />
        <button
          type="button"
          class="btn"
          onClick={() => {
            setInput(SAMPLE);
            setPrecision(DEFAULT_SVG_PRECISION);
            setTransformPrecision(DEFAULT_TRANSFORM_PRECISION);
            setMultipass(true);
            setKeepDescription(false);
            setPrefixIds(false);
          }}
          title="Load a small example"
        >
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        {/* Drop handlers sit on the whole pane, not just the <textarea> — landing a real
            OS drag-and-drop a few pixels outside a small text box (on the label, the
            padding, etc.) is easy to do and otherwise falls through to the browser's
            default "open this file" behavior instead of reaching our handler. */}
        <div class="field" {...dropHandlers}>
          <label class="field__label" for="svg-input">
            <span>SVG markup</span>
          </label>
          <textarea
            id="svg-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste SVG markup here, or drop a .svg file"
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane
          label="Optimized SVG"
          value={output}
          placeholder="Optimized markup appears here."
          tall
          describe="the optimized SVG"
          actions={<DownloadButton value={output} filename="optimized.svg" mimeType="image/svg+xml" describe="the optimized SVG" />}
        />
      </div>

      {output !== '' && (
        <p class="stat-row" data-testid="svg-optimize-stats">
          <SavingsBadge beforeBytes={originalBytes} afterBytes={optimizedBytes} large />
          <span class="field__hint">
            {formatBytes(originalBytes)} → {formatBytes(optimizedBytes)}
          </span>
        </p>
      )}

      <ErrorMessage message={error} />

      {output !== '' && (
        <div class="field">
          <span class="field__label">Preview</span>

          {/* Sits directly above the sliders and image it tunes, not stacked below the
              (much shorter) sliders inside their narrow column — that left the toggles
              hanging well past the image's bottom edge, looking disconnected from it. */}
          <div class="compare-panel__toggles">
            <label
              class="checkbox"
              title="Repeats optimization passes until a pass makes no further change, instead of stopping after one — finds at least as much savings as a single pass, at the cost of more CPU time."
            >
              <input type="checkbox" checked={multipass} onChange={(event) => setMultipass((event.target as HTMLInputElement).checked)} />
              <span>Multipass</span>
            </label>
            <label class="checkbox" title="Keeps any <desc> element instead of letting the default preset strip it — real content for screen readers, at the cost of a few more bytes.">
              <input
                type="checkbox"
                checked={keepDescription}
                onChange={(event) => setKeepDescription((event.target as HTMLInputElement).checked)}
              />
              <span>Keep &lt;desc&gt;</span>
            </label>
            <label class="checkbox" title="Prefixes every id (and class name) with a value derived from the file, so pasting several optimized SVGs into one page never collides ids across them.">
              <input type="checkbox" checked={prefixIds} onChange={(event) => setPrefixIds((event.target as HTMLInputElement).checked)} />
              <span>Prefix IDs</span>
            </label>
          </div>

          <div class="compare-panel">
            <div class="compare-panel__sliders">
              <label
                class="control control--vertical"
                title="SVGO's floatPrecision — decimal places kept in coordinates and other numbers. Lower shrinks the file further at the cost of exactness; higher preserves the shape more faithfully."
              >
                <span class="field__hint">Precision ({precision})</span>
                <input
                  type="range"
                  class="range--vertical"
                  min={MIN_SVG_PRECISION}
                  max={MAX_SVG_PRECISION}
                  value={precision}
                  aria-label={`Numeric precision, ${precision} decimal places`}
                  onInput={(event) => setPrecision(Number((event.target as HTMLInputElement).value))}
                />
                <span class="control__hint">Rec: 2–4</span>
              </label>
              <label
                class="control control--vertical"
                title="Decimal places kept when re-writing a rotate/skew/scale transform on an element that keeps one explicitly (like a <use>) instead of baking it into path coordinates. Most SVGs have none of these, and even when present the rounding is sub-degree/sub-pixel — this rarely changes how anything looks, only shaves a little more off elements that use it."
              >
                <span class="field__hint">Transform ({transformPrecision})</span>
                <input
                  type="range"
                  class="range--vertical"
                  min={MIN_TRANSFORM_PRECISION}
                  max={MAX_TRANSFORM_PRECISION}
                  value={transformPrecision}
                  aria-label={`Transform precision, ${transformPrecision} decimal places`}
                  onInput={(event) => setTransformPrecision(Number((event.target as HTMLInputElement).value))}
                />
                <span class="control__hint">Rec: 4–6</span>
              </label>
            </div>
            <CompareSlider beforeUrl={svgPreviewUrl(input)} afterUrl={svgPreviewUrl(output)} beforeLabel="Original" afterLabel="Optimized" />
          </div>
        </div>
      )}

      <style>{`
        .stat-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: var(--space-3) 0; }

        /* Puts every tuning control (the multipass/desc/id toggles, then the two precision
           sliders) directly above and beside the preview they affect, so adjusting one and
           seeing the compare result is one glance — nothing is tucked behind a separate
           collapsible section, and nothing is stacked so far below the (much shorter)
           sliders that it ends up hanging past the image's own bottom edge. */
        .compare-panel__toggles { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); margin-bottom: var(--space-3); }
        .compare-panel { display: flex; align-items: flex-start; gap: var(--space-4); }
        .control { display: flex; flex-direction: column; gap: var(--space-1); }
        /* Vertical orientation keeps the two sliders (Precision, Transform) to a slim,
           side-by-side pair instead of two full-width horizontal bars. */
        .compare-panel__sliders { display: flex; align-items: flex-start; gap: var(--space-4); flex-shrink: 0; }
        .control--vertical { align-items: center; text-align: center; gap: var(--space-2); }
        .range--vertical {
          writing-mode: vertical-lr; direction: rtl;
          width: 1.5rem; height: 12rem; padding: var(--space-2) 0;
        }
        @media (max-width: 40rem) {
          .compare-panel { flex-direction: column; }
          .compare-panel__sliders { width: 100%; justify-content: center; }
          .range--vertical { height: 6rem; }
        }
      `}</style>
    </div>
  );
}
