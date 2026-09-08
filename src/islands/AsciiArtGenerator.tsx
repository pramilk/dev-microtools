import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CHARACTER_RAMPS,
  CUSTOM_RAMP_ID,
  DEFAULT_COLUMNS,
  DEFAULT_RAMP_ID,
  MAX_COLUMNS,
  MIN_COLUMNS,
  computeAsciiDimensions,
  imageToAsciiGrid,
  rampById,
  renderAsciiColorMarkup,
  renderAsciiHtmlDocument,
  renderAsciiText,
  validateCharacters,
  type AsciiGrid,
} from '../lib/tools/asciiArt';
import { validateImageFile } from '../lib/tools/imageCompress';
import { FileDropzone } from './shared/FileDropzone';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';
import { formatBytes } from './shared/formatBytes';

// Deliberately no ShareLinkButton — the input is a binary image file from the visitor's own
// disk, which can't (and shouldn't) be encoded into a URL. Same reasoning across every
// image tool on this site.

/** Plain characters, or characters tinted with the colour of the pixel underneath them. */
type ColorMode = 'mono' | 'color';

/** This site's own app icon, already served from `public/` — no new asset, and no licensing
 *  question at all. Chosen over a photograph deliberately: a bold logo on a flat background
 *  is what ASCII art is genuinely *good* at, so the first thing a visitor sees is the tool
 *  working rather than the muddy mid-tone result a detailed photo gives (which the content
 *  page's FAQ explains). It is also the tool's own headline use case — turning a project
 *  logo into a text banner. */
const SAMPLE_IMAGE_URL = '/android-chrome-512x512.png';

/** Fallback preview font size, used only until the container has been measured once. */
const FALLBACK_FONT_SIZE = 8;

/** A monospace character's advance width as a fraction of its font size — near-universal
 *  across the monospace faces the preview's font stack can resolve to, and the number that
 *  turns "how wide is the container" into "what font size fits `columns` characters". */
const MONOSPACE_ADVANCE = 0.6;

const baseName = (name: string): string => name.replace(/\.[^./]+$/, '') || 'image';

async function loadSampleImageFile(): Promise<File> {
  const response = await fetch(SAMPLE_IMAGE_URL);
  if (!response.ok) throw new Error('Could not load the sample image.');
  const blob = await response.blob();
  return new File([blob], 'logo.png', { type: 'image/png' });
}

/**
 * Downscales a decoded image to the exact character-grid size and hands back its pixels.
 *
 * Inherently DOM-bound (`<canvas>`), which is why it lives in the island rather than in
 * `lib/tools/asciiArt.ts` — that module deliberately starts from "one pixel per character"
 * and never resamples.
 *
 * The downscale runs in halving steps rather than one giant `drawImage`. Going from a
 * 4000px photo straight to 100px in a single step samples far too sparsely in some
 * browsers, dropping thin features (text, wires, whiskers) entirely; halving repeatedly
 * averages the whole image down and is what makes a full-resolution photo produce the same
 * art as a pre-shrunk one.
 */
function downscaleToPixels(bitmap: ImageBitmap, targetWidth: number, targetHeight: number): ImageData | null {
  let source: CanvasImageSource = bitmap;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;

  const drawInto = (width: number, height: number, willReadFrequently: boolean): CanvasRenderingContext2D | null => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return context;
  };

  while (sourceWidth > targetWidth * 2 && sourceHeight > targetHeight * 2) {
    const width = Math.max(targetWidth, Math.floor(sourceWidth / 2));
    const height = Math.max(targetHeight, Math.floor(sourceHeight / 2));
    const context = drawInto(width, height, false);
    if (!context) return null;
    source = context.canvas;
    sourceWidth = width;
    sourceHeight = height;
  }

  const finalContext = drawInto(targetWidth, targetHeight, true);
  if (!finalContext) return null;
  return finalContext.getImageData(0, 0, targetWidth, targetHeight);
}

interface Settings {
  columns: number;
  brightness: number;
  contrast: number;
}

const DEFAULT_SETTINGS: Settings = { columns: DEFAULT_COLUMNS, brightness: 0, contrast: 0 };

/**
 * Turns an uploaded image into text art: the image is downscaled to one pixel per output
 * character, and each pixel's brightness picks a character from a ramp ordered light to
 * dark (`imageToAsciiGrid` in `lib/tools/asciiArt.ts`).
 *
 * No Worker here, unlike Image Upscaler: the whole conversion is one pass over at most
 * `MAX_ASCII_CELLS` cells — a few milliseconds even at the widest setting — so moving it
 * off the main thread would cost more in transfer and bundle weight than it saved.
 */
export default function AsciiArtGenerator() {
  const [file, setFile] = useState<File | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [rampId, setRampId] = useState<string>(DEFAULT_RAMP_ID);
  // Seeded from the plain-ASCII "Standard" ramp rather than from the Blocks default: the
  // custom field is where someone goes to type their own punctuation, so a row of Unicode
  // blocks is an awkward thing to have to clear out first.
  const [customCharacters, setCustomCharacters] = useState(rampById('standard')?.characters ?? ' .:-=+*#%@');
  const [invert, setInvert] = useState(false);
  // On by default: without it most photographs occupy only the middle of the ramp and come
  // out as undifferentiated mush. See `computeLevelRange`.
  const [autoLevels, setAutoLevels] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>('mono');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settledSettings, setSettledSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [grid, setGrid] = useState<AsciiGrid | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const characters = rampId === CUSTOM_RAMP_ID ? customCharacters : (rampById(rampId)?.characters ?? '');
  const characterCheck = validateCharacters(characters);
  const characterError = characterCheck.ok ? null : characterCheck.error;

  // Debounced the same way Image Upscaler debounces its quality slider: re-converting on
  // every drag tick is wasted work on a wide grid, and the 120ms settle is imperceptible.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSettings(settings), 120);
    return () => window.clearTimeout(timer);
  }, [settings]);

  // Decodes a newly chosen file and resets everything downstream of it.
  useEffect(() => {
    if (!file) {
      bitmapRef.current?.close();
      bitmapRef.current = null;
      setNaturalSize(null);
      setGrid(null);
      setLoadError(null);
      setConvertError(null);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setLoadError(validation.error);
      setNaturalSize(null);
      setGrid(null);
      return;
    }
    setLoadError(null);

    let cancelled = false;
    createImageBitmap(file)
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current?.close();
        bitmapRef.current = bitmap;
        setNaturalSize({ width: bitmap.width, height: bitmap.height });
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const target = useMemo(
    () => (naturalSize ? computeAsciiDimensions(naturalSize.width, naturalSize.height, settledSettings.columns) : null),
    [naturalSize, settledSettings.columns]
  );

  // The conversion itself: downscale to the grid size, then map pixels onto characters.
  useEffect(() => {
    const bitmap = bitmapRef.current;
    if (!bitmap || !target) return;

    if (characterError) {
      setGrid(null);
      setConvertError(null); // The ramp field shows its own error; don't say it twice.
      return;
    }

    const pixels = downscaleToPixels(bitmap, target.columns, target.rows);
    if (!pixels) {
      setGrid(null);
      setConvertError('This browser would not give the tool a 2D canvas, which it needs to read the image’s pixels.');
      return;
    }

    const result = imageToAsciiGrid(pixels.data, pixels.width, pixels.height, {
      characters,
      invert,
      autoLevels,
      brightness: settledSettings.brightness,
      contrast: settledSettings.contrast,
    });

    if (result.ok) {
      setGrid(result.value);
      setConvertError(null);
    } else {
      setGrid(null);
      setConvertError(result.error);
    }
  }, [target, characters, characterError, invert, autoLevels, settledSettings.brightness, settledSettings.contrast]);

  // Keeps the preview's font size matched to the container, so the art always fits its
  // width instead of overflowing on a phone or sitting tiny on a wide screen.
  const hasResult = grid !== null;
  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    setPreviewWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') setPreviewWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasResult]);

  const text = useMemo(() => (grid ? renderAsciiText(grid) : ''), [grid]);
  const markup = useMemo(() => (grid && colorMode === 'color' ? renderAsciiColorMarkup(grid) : ''), [grid, colorMode]);

  const fontSize = useMemo(() => {
    if (!grid || previewWidth <= 0) return FALLBACK_FONT_SIZE;
    return Math.min(16, Math.max(2, previewWidth / (grid.columns * MONOSPACE_ADVANCE)));
  }, [grid, previewWidth]);

  const loadExample = () => {
    void loadSampleImageFile().then(
      (sample) => {
        setSettings(DEFAULT_SETTINGS);
        setSettledSettings(DEFAULT_SETTINGS);
        setFile(sample);
      },
      () => setLoadError('Could not load the sample image — check your connection and try again.')
    );
  };

  const clear = () => {
    setFile(null);
    setSettings(DEFAULT_SETTINGS);
    setSettledSettings(DEFAULT_SETTINGS);
  };

  const updateSetting = (key: keyof Settings) => (event: Event) =>
    setSettings((current) => ({ ...current, [key]: Number((event.target as HTMLInputElement).value) }));

  const downloadName = file ? baseName(file.name) : 'image';

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Character set">
          {CHARACTER_RAMPS.map((ramp) => (
            <button key={ramp.id} type="button" class="seg__btn" aria-pressed={rampId === ramp.id} onClick={() => setRampId(ramp.id)} title={ramp.description}>
              {ramp.label}
            </button>
          ))}
          <button
            type="button"
            class="seg__btn"
            aria-pressed={rampId === CUSTOM_RAMP_ID}
            onClick={() => setRampId(CUSTOM_RAMP_ID)}
            title="Type your own characters, ordered from lightest to darkest"
          >
            Custom
          </button>
        </div>

        <div class="seg" role="group" aria-label="Background">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={!invert}
            onClick={() => setInvert(false)}
            title="Dark characters on a light background — for pasting into a document or a light-themed editor"
          >
            Dark on light
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={invert}
            onClick={() => setInvert(true)}
            title="Light characters on a dark background — for a terminal or a dark-themed editor"
          >
            Light on dark
          </button>
        </div>

        <div class="seg" role="group" aria-label="Colour">
          <button type="button" class="seg__btn" aria-pressed={colorMode === 'mono'} onClick={() => setColorMode('mono')} title="Plain text you can paste anywhere">
            Plain text
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={colorMode === 'color'}
            onClick={() => setColorMode('color')}
            title="Tint each character with the colour of the pixel behind it — downloadable as HTML, since plain text can’t carry colour"
          >
            Colour
          </button>
        </div>

        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Load a real public-domain photo to convert">
          Load example
        </button>
        <button type="button" class="btn" onClick={clear} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to convert to ASCII art" accept="image/*" />}

      <ErrorMessage message={loadError} />

      {rampId === CUSTOM_RAMP_ID && (
        <div class="field ascii-custom">
          <label class="field__label" for="ascii-characters">
            <span>Characters, lightest to darkest</span>
          </label>
          <input
            id="ascii-characters"
            class="input"
            type="text"
            spellcheck={false}
            autocomplete="off"
            maxLength={200}
            value={customCharacters}
            aria-invalid={characterError !== null}
            aria-describedby="ascii-characters-hint"
            title="The first character fills the lightest areas, the last one the darkest"
            onInput={(event) => setCustomCharacters((event.target as HTMLInputElement).value)}
          />
          <p class="field__hint" id="ascii-characters-hint">
            Order matters: the first character is used for the lightest parts of the image (usually a space) and the last for the darkest. More
            characters means finer tonal steps.
          </p>
          <ErrorMessage message={characterError} />
        </div>
      )}

      {file && naturalSize && target && (
        <>
          <p class="field__hint ascii-source">
            {file.name} · {naturalSize.width.toLocaleString()}×{naturalSize.height.toLocaleString()}px · {formatBytes(file.size)} →{' '}
            {target.columns.toLocaleString()}×{target.rows.toLocaleString()} characters
          </p>

          <div class="ascii-controls">
            <label class="ascii-control" title="How many characters wide the finished art is — more characters means more detail and a bigger paste.">
              <span class="field__hint">Width ({settings.columns} characters)</span>
              <input
                type="range"
                min={MIN_COLUMNS}
                max={MAX_COLUMNS}
                value={settings.columns}
                aria-label="Width in characters"
                onInput={updateSetting('columns')}
              />
            </label>
            <label class="ascii-control" title="Lightens or darkens the whole image before it is mapped onto characters.">
              <span class="field__hint">Brightness ({settings.brightness > 0 ? `+${settings.brightness}` : settings.brightness})</span>
              <input type="range" min="-100" max="100" value={settings.brightness} aria-label="Brightness" onInput={updateSetting('brightness')} />
            </label>
            <label class="ascii-control" title="Separates lights from darks. A flat photo usually needs more contrast before it reads as art.">
              <span class="field__hint">Contrast ({settings.contrast > 0 ? `+${settings.contrast}` : settings.contrast})</span>
              <input type="range" min="-100" max="100" value={settings.contrast} aria-label="Contrast" onInput={updateSetting('contrast')} />
            </label>
          </div>

          <label
            class="checkbox ascii-auto-levels"
            title="Stretches the image's actual range of tones across the whole character set. Turn it off to map the original values literally."
          >
            <input type="checkbox" checked={autoLevels} onChange={(event) => setAutoLevels((event.target as HTMLInputElement).checked)} />
            Auto levels
          </label>

          <ErrorMessage message={convertError} />

          {grid && (
            <div class="field ascii-output">
              <div class="field__label">
                <span>ASCII art</span>
                <span class="tool-bar__spacer" />
                <CopyButton value={text} describe={colorMode === 'color' ? 'the art as plain text' : 'the ASCII art'} />
                <DownloadButton value={text} filename={`${downloadName}-ascii.txt`} label="Download .txt" describe="the ASCII art" />
                {colorMode === 'color' && (
                  <DownloadButton
                    value={renderAsciiHtmlDocument(grid, { invert, title: `${downloadName} — ASCII art` })}
                    filename={`${downloadName}-ascii.html`}
                    mimeType="text/html"
                    label="Download .html"
                    describe="the coloured art"
                  />
                )}
              </div>

              <div class={`ascii-preview${invert ? ' ascii-preview--dark' : ''}`} ref={previewRef}>
                {colorMode === 'color' ? (
                  <pre
                    class="ascii-preview__art"
                    style={{ fontSize: `${fontSize}px` }}
                    role="img"
                    aria-label={`ASCII art preview, ${grid.columns} by ${grid.rows} characters, in colour`}
                    dangerouslySetInnerHTML={{ __html: markup }}
                  />
                ) : (
                  <pre
                    class="ascii-preview__art"
                    style={{ fontSize: `${fontSize}px` }}
                    role="img"
                    aria-label={`ASCII art preview, ${grid.columns} by ${grid.rows} characters`}
                  >
                    {text}
                  </pre>
                )}
              </div>

              <p class="field__hint">
                {text.length.toLocaleString()} characters over {grid.rows.toLocaleString()} lines.
                {colorMode === 'color'
                  ? ' Copy gives you the plain characters — colour survives only in the .html download, since plain text can’t carry it.'
                  : ' Paste it into a code comment, a README, a commit message, or a terminal.'}
              </p>
            </div>
          )}
        </>
      )}

      <style>{`
        .ascii-custom { margin-top: var(--space-3); }
        .ascii-source { margin-top: var(--space-3); }
        .ascii-controls {
          display: grid; gap: var(--space-3); margin-top: var(--space-3);
          grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        }
        .ascii-control { display: flex; flex-direction: column; gap: var(--space-1); }
        .ascii-auto-levels { margin-top: var(--space-3); }
        .ascii-output { margin-top: var(--space-4); }
        /* The preview deliberately pins its own colours instead of following the site theme:
           it is a what-you-get view of the chosen "dark on light" / "light on dark" mode,
           and the downloaded HTML uses exactly these two backgrounds. */
        .ascii-preview {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: #ffffff; color: #111111; padding: var(--space-3);
          overflow-x: auto;
        }
        .ascii-preview--dark { background: #000000; color: #e6e6e6; }
        .ascii-preview__art {
          margin: 0; font-family: var(--font-mono);
          /* Must stay 1.2: CHARACTER_ASPECT_RATIO assumes it when working out the row
             count, so changing it here silently squashes or stretches the art. */
          line-height: 1.2;
          letter-spacing: 0; white-space: pre; color: inherit; background: none;
        }
      `}</style>
    </div>
  );
}
