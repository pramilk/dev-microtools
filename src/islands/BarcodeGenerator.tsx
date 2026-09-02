import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  generateBarcode,
  barcodeToSvg,
  barcodeSvgDimensions,
  BARCODE_SYMBOLOGIES,
  type BarcodeSymbology,
} from '../lib/tools/barcode';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';

const SYMBOLOGY_LABELS: Record<BarcodeSymbology, string> = {
  code128b: 'Code 128',
  code39: 'Code 39',
  ean13: 'EAN-13',
  upca: 'UPC-A',
};

const SYMBOLOGY_HINTS: Record<BarcodeSymbology, string> = {
  code128b: 'Any printable ASCII text (letters, digits, punctuation) — the most versatile 1D symbology.',
  code39: 'Digits, uppercase letters, space, and - . $ / + % — widely supported, no computed checksum required.',
  ean13: '12 digits (check digit computed automatically) or 13 digits (including the check digit) — retail products.',
  upca: '11 digits (check digit computed automatically) or 12 digits (including the check digit) — US/Canada retail.',
};

const PLACEHOLDERS: Record<BarcodeSymbology, string> = {
  code128b: 'HELLO-123',
  code39: 'CODE39',
  ean13: '5901234123457',
  upca: '036000291452',
};

// Genuine, correctly-checksummed samples — EAN-13's is the canonical worked example used
// across barcode references; UPC-A's is a real, well-known retail UPC (Wrigley's Extra gum).
const EXAMPLES: Record<BarcodeSymbology, string> = {
  code128b: 'HELLO-123',
  code39: 'CODE39',
  ean13: '5901234123457',
  upca: '036000291452',
};

const MODULE_WIDTH = 2;
const BAR_HEIGHT = 90;

interface ShareState {
  symbology: BarcodeSymbology;
  value: string;
  code39Checksum: boolean;
}

/** Rasterises the SVG markup to a PNG blob via an off-screen canvas. */
async function rasterizeToPng(svgMarkup: string, width: number, height: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render the barcode as an image.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser does not support canvas image export.');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export a PNG from this barcode.');
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function BarcodeGenerator() {
  const [symbology, setSymbology] = useState<BarcodeSymbology>('code128b');
  const [value, setValue] = useState('HELLO-123');
  const [code39Checksum, setCode39Checksum] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    void readShareStateFromLocation<Partial<ShareState>>().then((restored) => {
      if (!restored?.ok) return;
      const v = restored.value;
      setSymbology(v.symbology ?? 'code128b');
      setValue(v.value ?? '');
      setCode39Checksum(v.code39Checksum ?? false);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(
    () => (value.trim() === '' ? null : generateBarcode(symbology, value, { code39Checksum })),
    [symbology, value, code39Checksum]
  );
  const pattern = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const previewSvg = useMemo(
    () => (pattern ? barcodeToSvg(pattern, { moduleWidth: MODULE_WIDTH, barHeight: BAR_HEIGHT }) : ''),
    [pattern]
  );
  const downloadSvg = useMemo(
    () => (pattern ? barcodeToSvg(pattern, { moduleWidth: 3, barHeight: 120 }) : ''),
    [pattern]
  );

  const loadExample = () => {
    setValue(EXAMPLES[symbology]);
  };

  const handleSymbologyChange = (next: BarcodeSymbology) => {
    setSymbology(next);
    // Switching symbology with the previous value still in the field almost always shows an
    // error (a Code 39 value isn't valid EAN-13 digits, etc.) — swap in that symbology's own
    // example instead, so switching modes always shows a working barcode immediately.
    setValue(EXAMPLES[next]);
  };

  const handleDownloadPng = async () => {
    if (!pattern) return;
    setExportError(null);
    const options = { moduleWidth: 3, barHeight: 120 };
    const svg = barcodeToSvg(pattern, options);
    const { width, height } = barcodeSvgDimensions(pattern, options);
    const id = (requestId.current += 1);
    try {
      const blob = await rasterizeToPng(svg, width, height);
      if (id !== requestId.current) return;
      saveBlob(blob, `${symbology}-barcode.png`);
    } catch (pngError) {
      if (id !== requestId.current) return;
      setExportError(pngError instanceof Error ? pngError.message : 'Could not export a PNG from this barcode.');
    }
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Barcode symbology">
          {BARCODE_SYMBOLOGIES.map((sym) => (
            <button
              key={sym}
              type="button"
              class="seg__btn"
              aria-pressed={symbology === sym}
              onClick={() => handleSymbologyChange(sym)}
              title={SYMBOLOGY_HINTS[sym]}
            >
              {SYMBOLOGY_LABELS[sym]}
            </button>
          ))}
        </div>
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ symbology, value, code39Checksum })} describe="this barcode" />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a sample so you can see the tool work">
          Load example
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="barcode-value">
          <span>Value</span>
          <span class="field__hint">{SYMBOLOGY_HINTS[symbology]}</span>
        </label>
        <input
          id="barcode-value"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder={PLACEHOLDERS[symbology]}
          value={value}
          aria-invalid={error !== null}
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        />
        {symbology === 'code39' && (
          <label class="checkbox" title="Adds an optional mod-43 check character before the stop delimiter — not required by the base Code 39 standard, but some readers expect it">
            <input
              type="checkbox"
              checked={code39Checksum}
              onChange={(event) => setCode39Checksum((event.target as HTMLInputElement).checked)}
            />
            Add optional mod-43 checksum
          </label>
        )}
      </div>

      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={() => setValue('')} disabled={value === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <ErrorMessage message={error} />

      <div class="barcode-preview" aria-live="polite">
        {pattern ? (
          <div class="barcode-preview__image" dangerouslySetInnerHTML={{ __html: previewSvg }} />
        ) : (
          !error && <p class="field__hint">Enter a value above to generate a {SYMBOLOGY_LABELS[symbology]} barcode.</p>
        )}
      </div>

      {pattern && (
        <div class="tool-bar">
          <button type="button" class="btn btn--primary" onClick={() => void handleDownloadPng()} title="Save as a PNG image">
            <span aria-hidden="true">⭳</span> Download PNG
          </button>
          <DownloadButton
            value={downloadSvg}
            filename={`${symbology}-barcode.svg`}
            mimeType="image/svg+xml"
            label="Download SVG"
            describe="this barcode"
          />
          <CopyButton value={downloadSvg} label="Copy SVG" describe="the barcode SVG markup" />
        </div>
      )}

      <ErrorMessage message={exportError} />

      <style>{`
        .barcode-preview {
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          min-height: 10rem; background: #fff;
          display: flex; align-items: center; justify-content: center; padding: var(--space-4);
        }
        .barcode-preview__image { width: 100%; max-width: 26rem; }
        .barcode-preview__image svg { width: 100%; height: auto; display: block; }
      `}</style>
    </div>
  );
}
