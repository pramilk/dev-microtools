import { useEffect, useRef, useState } from 'preact/hooks';
import { validateImageFile } from '../lib/tools/imageFormatConvert';
import {
  centerSquareCrop,
  buildMultiIco,
  buildFaviconHtmlSnippet,
  buildWebManifest,
  FAVICON_FILE_NAMES,
  APPLE_TOUCH_ICON_SIZE,
  ANDROID_CHROME_SIZES,
  type SquareCrop,
} from '../lib/tools/favicon';
import { FileDropzone } from './shared/FileDropzone';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { downloadUrl } from './shared/downloadUrl';
import { downloadZip } from './shared/downloadZip';

// Deliberately no ShareLinkButton — the input is a binary image uploaded from the visitor's
// disk, which can't (and shouldn't) be encoded into a shareable URL. Same reasoning as every
// other image tool (Image Cropper, Image Compressor, Image Format Converter).

interface FaviconPackage {
  ico: Blob;
  png16: Blob;
  png32: Blob;
  appleTouch: Blob;
  android192: Blob;
  android512: Blob;
  sourceWidth: number;
  sourceHeight: number;
  /** Whether the source wasn't already square, so a center-crop was applied before resizing. */
  cropped: boolean;
}

/** Draws the source bitmap's centered square crop onto an off-screen canvas at `size`x`size`
 *  and encodes it as PNG — the one primitive every generated file size shares. */
async function renderSquarePng(bitmap: ImageBitmap, crop: SquareCrop, size: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not support canvas image export.');
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not generate a PNG at this size.');
  return blob;
}

/**
 * Decodes the uploaded image and renders the full favicon set through canvas — inherently
 * DOM-bound (`createImageBitmap`, `<canvas>`), so like Image Cropper and Image Format
 * Converter, this stays in the island rather than the pure logic layer in `lib/tools`. The
 * multi-size ICO container itself is still built by the pure `buildMultiIco` in
 * `lib/tools/favicon.ts`, from the canvas-encoded PNG bytes.
 */
async function generateFaviconPackage(file: File): Promise<FaviconPackage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that as an image — the file may be corrupted or in a format this browser can't decode.");
  }

  try {
    const { width, height } = bitmap;
    const crop = centerSquareCrop(width, height);

    const [png16, png32, png48, appleTouch, android192, android512] = await Promise.all([
      renderSquarePng(bitmap, crop, 16),
      renderSquarePng(bitmap, crop, 32),
      renderSquarePng(bitmap, crop, 48),
      renderSquarePng(bitmap, crop, APPLE_TOUCH_ICON_SIZE),
      renderSquarePng(bitmap, crop, ANDROID_CHROME_SIZES[0]),
      renderSquarePng(bitmap, crop, ANDROID_CHROME_SIZES[1]),
    ]);

    const ico = new Blob(
      [
        buildMultiIco([
          { width: 16, height: 16, pngBytes: new Uint8Array(await png16.arrayBuffer()) },
          { width: 32, height: 32, pngBytes: new Uint8Array(await png32.arrayBuffer()) },
          { width: 48, height: 48, pngBytes: new Uint8Array(await png48.arrayBuffer()) },
        ]),
      ],
      { type: 'image/x-icon' }
    );

    return {
      ico,
      png16,
      png32,
      appleTouch,
      android192,
      android512,
      sourceWidth: width,
      sourceHeight: height,
      cropped: width !== height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Generates a modest, deterministic sample logo via canvas — a filled circle badge on a
 * gradient square — so "Load example" demonstrates a real favicon package without bundling
 * an actual logo asset, matching Image Format Converter's and Image Cropper's own
 * canvas-drawn samples.
 */
async function generateSampleImageFile(): Promise<File> {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not support canvas image export.');

  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#3cbcd4');
  gradient.addColorStop(1, '#7c5cff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.fillStyle = '#0d1117';
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#ffffff';
  context.lineWidth = size * 0.05;
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
  context.stroke();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not generate a sample image.');
  return new File([blob], 'sample-logo.png', { type: 'image/png' });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  URL.revokeObjectURL(url);
}

const HTML_SNIPPET = buildFaviconHtmlSnippet();
// name/short_name are a generic placeholder, not a fabricated app name — this tool has no
// way to know the visitor's real app name, and the hint below the manifest download says so.
const MANIFEST_JSON = buildWebManifest();

export default function FaviconGenerator() {
  const [file, setFile] = useState<File | null>(null);
  const [pkg, setPkg] = useState<FaviconPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<{ png32: string; appleTouch: string } | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!file) {
      setPkg(null);
      setError(null);
      setBusy(false);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setError(validation.error);
      setPkg(null);
      return;
    }
    setError(null);

    const seq = (seqRef.current += 1);
    setBusy(true);
    void generateFaviconPackage(file)
      .then((result) => {
        if (seqRef.current !== seq) return;
        setPkg(result);
        setBusy(false);
      })
      .catch((thrown: unknown) => {
        if (seqRef.current !== seq) return;
        setError(thrown instanceof Error ? thrown.message : 'Could not generate a favicon package from this image.');
        setPkg(null);
        setBusy(false);
      });
  }, [file]);

  // Object URLs for the two preview thumbnails — created once per finished package and
  // revoked on the next change (or unmount), the standard "clean up the old value" pattern.
  useEffect(() => {
    if (!pkg) {
      setPreviewUrls(null);
      return;
    }
    const png32Url = URL.createObjectURL(pkg.png32);
    const appleTouchUrl = URL.createObjectURL(pkg.appleTouch);
    setPreviewUrls({ png32: png32Url, appleTouch: appleTouchUrl });
    return () => {
      URL.revokeObjectURL(png32Url);
      URL.revokeObjectURL(appleTouchUrl);
    };
  }, [pkg]);

  const loadExample = () => {
    void generateSampleImageFile().then((sample) => setFile(sample));
  };

  const clearAll = () => {
    setFile(null);
  };

  const downloadAll = async () => {
    if (!pkg) return;
    setZipping(true);
    try {
      await downloadZip(
        [
          { name: FAVICON_FILE_NAMES.ico, blob: pkg.ico },
          { name: FAVICON_FILE_NAMES.png16, blob: pkg.png16 },
          { name: FAVICON_FILE_NAMES.png32, blob: pkg.png32 },
          { name: FAVICON_FILE_NAMES.appleTouch, blob: pkg.appleTouch },
          { name: FAVICON_FILE_NAMES.android192, blob: pkg.android192 },
          { name: FAVICON_FILE_NAMES.android512, blob: pkg.android512 },
          { name: FAVICON_FILE_NAMES.manifest, blob: new Blob([MANIFEST_JSON], { type: 'application/manifest+json' }) },
        ],
        'favicon-package.zip'
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <div class="tool">
      {/* No share link here: the input is an uploaded image file, not text — there's no
          practical way to carry arbitrary image bytes in a shareable URL. */}
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Generate a sample logo to try the tool with">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to generate favicons from" accept="image/*" />}

      <ErrorMessage message={error} />

      {file && busy && !pkg && (
        <p class="field__hint">
          <span class="job__spinner" aria-hidden="true" /> Generating favicon package…
        </p>
      )}

      {pkg && (
        <div class="favicon-result">
          <p class="field__hint">
            Source: {file?.name} · {pkg.sourceWidth}×{pkg.sourceHeight}px
            {pkg.cropped
              ? ' · center-cropped to a square before resizing'
              : ' · already square, no crop needed'}
            {busy && (
              <>
                {' '}
                <span class="job__spinner" aria-hidden="true" /> Updating…
              </>
            )}
          </p>

          <div class="favicon-previews" aria-label="Preview">
            {previewUrls && (
              <>
                <div class="favicon-preview">
                  <div class="favicon-preview__swatch favicon-preview__swatch--checkerboard">
                    <img src={previewUrls.png32} alt="32×32 favicon preview" width={32} height={32} />
                  </div>
                  <span class="field__hint">32×32</span>
                </div>
                <div class="favicon-preview">
                  <div class="favicon-preview__swatch favicon-preview__swatch--checkerboard favicon-preview__swatch--large">
                    <img src={previewUrls.appleTouch} alt="180×180 apple-touch-icon preview" width={90} height={90} />
                  </div>
                  <span class="field__hint">180×180</span>
                </div>
              </>
            )}
          </div>

          <div class="favicon-downloads" role="group" aria-label="Download individual files">
            <button type="button" class="btn" onClick={() => downloadBlob(pkg.ico, FAVICON_FILE_NAMES.ico)} title="16, 32 & 48px bundled into one multi-size icon file">
              <span aria-hidden="true">⭳</span> favicon.ico
            </button>
            <button type="button" class="btn" onClick={() => downloadBlob(pkg.png16, FAVICON_FILE_NAMES.png16)} title="Standalone 16×16 PNG">
              <span aria-hidden="true">⭳</span> {FAVICON_FILE_NAMES.png16}
            </button>
            <button type="button" class="btn" onClick={() => downloadBlob(pkg.png32, FAVICON_FILE_NAMES.png32)} title="Standalone 32×32 PNG">
              <span aria-hidden="true">⭳</span> {FAVICON_FILE_NAMES.png32}
            </button>
            <button type="button" class="btn" onClick={() => downloadBlob(pkg.appleTouch, FAVICON_FILE_NAMES.appleTouch)} title="180×180 PNG for iOS home-screen bookmarks">
              <span aria-hidden="true">⭳</span> {FAVICON_FILE_NAMES.appleTouch}
            </button>
            <button type="button" class="btn" onClick={() => downloadBlob(pkg.android192, FAVICON_FILE_NAMES.android192)} title="192×192 PNG for Android/PWA">
              <span aria-hidden="true">⭳</span> {FAVICON_FILE_NAMES.android192}
            </button>
            <button type="button" class="btn" onClick={() => downloadBlob(pkg.android512, FAVICON_FILE_NAMES.android512)} title="512×512 PNG for Android/PWA">
              <span aria-hidden="true">⭳</span> {FAVICON_FILE_NAMES.android512}
            </button>
          </div>

          <button type="button" class="btn btn--primary" onClick={() => void downloadAll()} disabled={zipping} title="Download every file above, plus site.webmanifest, as one .zip">
            <span aria-hidden="true">⭳</span> {zipping ? 'Zipping…' : 'Download all as .zip'}
          </button>

          <OutputPane
            label="HTML to paste into <head>"
            value={HTML_SNIPPET}
            placeholder="Upload an image to generate this snippet."
            describe="favicon HTML snippet"
          />

          <p class="field__hint">
            <code>site.webmanifest</code> is included in the zip with a generic <code>"App"</code> name — edit its{' '}
            <code>name</code> and <code>short_name</code> fields to match your actual app before deploying it.
          </p>
        </div>
      )}

      <style>{`
        .favicon-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .favicon-previews { display: flex; align-items: flex-end; gap: var(--space-5); }
        .favicon-preview { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
        .favicon-preview__swatch {
          display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          width: 2.5rem; height: 2.5rem; overflow: hidden;
        }
        .favicon-preview__swatch--large { width: 6rem; height: 6rem; }
        /* A neutral, theme-independent checker — the standard "see-through" convention every
           image editor uses, so a transparent source stays recognizable regardless of theme. */
        .favicon-preview__swatch--checkerboard {
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
        }
        .favicon-preview img { display: block; max-width: 100%; max-height: 100%; }
        .favicon-downloads { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        /* .job__spinner (shared with every other worker/canvas-backed tool) lives in
           src/styles/tool.css. */
      `}</style>
    </div>
  );
}
