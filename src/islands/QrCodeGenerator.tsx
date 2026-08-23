import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  generateQrMatrix,
  matrixToSvg,
  QR_ERROR_CORRECTION_LEVELS,
  MAX_QR_TEXT_LENGTH,
  type QrMatrix,
  type QrErrorCorrectionLevel,
} from '../lib/tools/qrcode';
import { ErrorMessage } from './shared/ErrorMessage';

const LEVEL_HINTS: Record<QrErrorCorrectionLevel, string> = {
  L: 'Low — ~7% of the code can be damaged and still scan. Smallest code.',
  M: 'Medium — ~15% damage tolerance. A good default.',
  Q: 'Quartile — ~25% damage tolerance.',
  H: 'High — ~30% damage tolerance. Best if you plan to add a logo on top.',
};

const DOWNLOAD_SIZES = [256, 512, 1024] as const;

/** Rasterises the SVG markup to a PNG blob via an off-screen canvas. */
async function rasterizeToPng(svgMarkup: string, size: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render the QR code as an image.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser does not support canvas image export.');
    context.drawImage(image, 0, 0, size, size);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export a PNG from this QR code.');
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

const supportsImageClipboard = (): boolean =>
  typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;

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

function downloadSvg(svgMarkup: string, filename: string): void {
  saveBlob(new Blob([svgMarkup], { type: 'image/svg+xml' }), filename);
}

export default function QrCodeGenerator() {
  const [text, setText] = useState('https://devmicrotools.com');
  const [level, setLevel] = useState<QrErrorCorrectionLevel>('M');
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadSize, setDownloadSize] = useState<(typeof DOWNLOAD_SIZES)[number]>(512);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = (requestId.current += 1);
    setBusy(true);
    void generateQrMatrix(text, level).then((result) => {
      // Ignore a stale response if the input changed again before this one resolved.
      if (id !== requestId.current) return;
      setBusy(false);
      if (result.ok) {
        setMatrix(result.value);
        setError(null);
      } else {
        setMatrix(null);
        setError(result.error);
      }
    });
  }, [text, level]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    },
    []
  );

  const previewSvg = useMemo(() => (matrix ? matrixToSvg(matrix, { cellSize: 8 }) : ''), [matrix]);

  const handleDownloadPng = async () => {
    if (!matrix) return;
    setExportError(null);
    const cellSize = Math.max(1, Math.round(downloadSize / matrix.moduleCount));
    const svg = matrixToSvg(matrix, { cellSize });
    try {
      const blob = await rasterizeToPng(svg, cellSize * matrix.moduleCount);
      saveBlob(blob, 'qr-code.png');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export a PNG from this QR code.');
    }
  };

  const handleDownloadSvg = () => {
    if (!matrix) return;
    setExportError(null);
    downloadSvg(matrixToSvg(matrix, { cellSize: 10 }), 'qr-code.svg');
  };

  const handleCopyImage = async () => {
    if (!matrix) return;
    setExportError(null);
    if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);

    try {
      const svg = matrixToSvg(matrix, { cellSize: 10 });
      const blob = await rasterizeToPng(svg, 10 * matrix.moduleCount);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    copyResetTimer.current = setTimeout(() => setCopyState('idle'), 1600);
  };

  return (
    <div class="tool">
      <div class="field">
        <label class="field__label" for="qr-text">
          <span>Text or URL</span>
          <span class="field__hint tnum">
            {text.length}/{MAX_QR_TEXT_LENGTH}
          </span>
        </label>
        <textarea
          id="qr-text"
          class="textarea textarea--short"
          spellcheck={false}
          placeholder="https://example.com, or any text"
          value={text}
          aria-invalid={error !== null}
          onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
        />
      </div>

      <div class="tool-bar">
        <label class="checkbox" title="How much of the code can be damaged or obscured and still scan">
          <span class="field__hint">Error correction</span>
          <select
            class="select"
            style="width:auto"
            value={level}
            aria-label="Error correction level"
            onChange={(event) => setLevel((event.target as HTMLSelectElement).value as QrErrorCorrectionLevel)}
            title={LEVEL_HINTS[level]}
          >
            {QR_ERROR_CORRECTION_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="btn" onClick={() => setText('')} disabled={text === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <ErrorMessage message={error} />

      <div class="qr-preview" aria-live="polite">
        {matrix ? (
          <div class="qr-preview__image" dangerouslySetInnerHTML={{ __html: previewSvg }} />
        ) : (
          !error && <p class="field__hint">{busy ? 'Generating…' : 'Enter some text or a URL to generate a QR code.'}</p>
        )}
      </div>

      {matrix && (
        <div class="tool-bar">
          <label class="checkbox">
            <span class="field__hint">Download size</span>
            <select
              class="select"
              style="width:auto"
              value={downloadSize}
              aria-label="PNG download size in pixels"
              onChange={(event) => setDownloadSize(Number((event.target as HTMLSelectElement).value) as (typeof DOWNLOAD_SIZES)[number])}
            >
              {DOWNLOAD_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}×{size}
                </option>
              ))}
            </select>
          </label>
          <button type="button" class="btn btn--primary" onClick={() => void handleDownloadPng()} title="Save as a PNG image">
            <span aria-hidden="true">⭳</span> Download PNG
          </button>
          <button type="button" class="btn" onClick={handleDownloadSvg} title="Save as a scalable SVG image">
            <span aria-hidden="true">⭳</span> Download SVG
          </button>
          {supportsImageClipboard() && (
            <button
              type="button"
              class={`btn${copyState === 'copied' ? ' btn--copied' : ''}`}
              onClick={() => void handleCopyImage()}
              title="Copy the QR code image to your clipboard"
            >
              <span aria-hidden="true">{copyState === 'copied' ? '✓' : '⧉'}</span>{' '}
              {copyState === 'idle' ? 'Copy image' : copyState === 'copied' ? 'Copied' : 'Copy failed'}
            </button>
          )}
        </div>
      )}

      <ErrorMessage message={exportError} />

      <style>{`
        .qr-preview {
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          background: var(--surface-2); min-height: 12rem;
          display: flex; align-items: center; justify-content: center; padding: var(--space-4);
        }
        .qr-preview__image {
          width: 100%; max-width: 14rem; aspect-ratio: 1 / 1;
          background: #fff; border-radius: var(--radius-sm); padding: var(--space-2);
        }
        .qr-preview__image svg { width: 100%; height: 100%; display: block; }
      `}</style>
    </div>
  );
}
