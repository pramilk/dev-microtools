import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  parseBase64Image,
  encodeImageToBase64,
  buildImgTagSnippet,
  buildCssBackgroundSnippet,
} from '../lib/tools/imageBase64';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { FileDropzone } from './shared/FileDropzone';
import { formatBytes } from './shared/formatBytes';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Direction = 'encode' | 'decode';

interface ShareState {
  input: string;
}

/** A genuine 48×48 PNG smiley (transparent background) — small, but actually visible and a bit more fun than a plain swatch. */
const SAMPLE_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA8UlEQVR4nO3WwQ3DMAxD0QzRs/cfpHu5QG8NepBEUrRbC/DR8X9IguS6zpxZZ+bzMSPL3fkx0ejlMGi4DcIOb4Wo46WIrngJojueinDFUxDueAjhjoYR7mAI4I6FEdELjjHeqxqU3S+JryKq+ymA++HZCGT/bwM6HgHGfgpgGl5iOsC1DsC9SgDkhY2u6BnlO9AFkD1CyruQuTb0DigQtI/Z9gAHwvIvdD94u79RNELyH8RCZBc9PguoQipnhAFVRARSvW4qHgGoVhqwEqIUvwoCincjKPEuBDW+GyGJ70JI45WQtnA2xBb+bbaMPvPv8wIKArBdC6W1EQAAAABJRU5ErkJggg==';

/** Guesses a file extension for the "Download" button from a decoded image's mime type. */
const extensionFor = (mimeType: string): string => (mimeType === 'image/svg+xml' ? 'svg' : (mimeType.split('/')[1] ?? 'bin'));

/** Saves decoded image bytes as a file. Unlike the shared `DownloadButton`, the source here is raw bytes, not text. */
function DownloadImageButton({ bytes, mimeType, filename }: { bytes: Uint8Array; mimeType: string; filename: string }) {
  const download = () => {
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button type="button" class="btn" onClick={download} title={`Save the decoded image as ${filename}`}>
      <span aria-hidden="true">⭳</span> Download
    </button>
  );
}

export default function ImageBase64Tool() {
  const [direction, setDirection] = useState<Direction>('encode');
  const [file, setFile] = useState<File | null>(null);
  const [fileOutput, setFileOutput] = useState<{ base64: string; dataUrl: string; mimeType: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setDirection('decode');
      setInput(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    if (!file) {
      setFileOutput(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    void encodeImageToBase64(file).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setFileOutput(result.value);
        setFileError(null);
      } else {
        setFileOutput(null);
        setFileError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const decodeResult = useMemo(() => (input.trim() === '' ? null : parseBase64Image(input)), [input]);
  const decoded = decodeResult?.ok ? decodeResult.value : null;
  const decodeError = decodeResult && !decodeResult.ok ? decodeResult.error : null;

  const clear = () => {
    setFile(null);
    setInput('');
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'encode'}
            onClick={() => setDirection('encode')}
            title="Convert an image file into a base64 string"
          >
            Image → Base64
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decode'}
            onClick={() => setDirection('decode')}
            title="Convert a base64 string back into an image"
          >
            Base64 → Image
          </button>
        </div>

        <span class="tool-bar__spacer" />
        {direction === 'decode' && <ShareLinkButton getState={() => ({ input })} describe="this base64 image" />}
        {direction === 'decode' && (
          <button type="button" class="btn" onClick={() => setInput(SAMPLE_BASE64)} title="Load a small example">
            Load example
          </button>
        )}
        <button type="button" class="btn" onClick={clear} disabled={file === null && input === ''} title="Clear and start over">
          Clear
        </button>
      </div>

      {direction === 'encode' ? (
        <>
          <div class="panes panes--split">
            <FileDropzone
              file={file}
              onFileSelected={setFile}
              chooseLabel="Choose an image to encode"
              accept="image/*"
              describeFile={(f) => `${formatBytes(f.size)} · ${f.type || 'unknown type'}`}
            />

            {fileOutput ? (
              <div class="field">
                <span class="field__label">Preview</span>
                <div class="image-preview">
                  <img src={fileOutput.dataUrl} alt={file?.name ?? 'Encoded preview'} />
                </div>
              </div>
            ) : (
              <div class="field">
                <span class="field__label">Preview</span>
                <div class="image-preview image-preview--empty">No image chosen yet.</div>
              </div>
            )}
          </div>

          <ErrorMessage message={fileError} />

          {fileOutput && (
            <>
              <OutputPane
                label="Base64 (data: URL)"
                value={fileOutput.dataUrl}
                placeholder="Encoded output appears here."
                tall
                describe="the data URL"
                actions={<DownloadButton value={fileOutput.dataUrl} filename="image-base64.txt" describe="the data URL" />}
              />
              <div class="field">
                <span class="field__label">Ready-to-paste snippets</span>
                <pre class="output">{buildImgTagSnippet(fileOutput.dataUrl, file?.name ?? 'Description')}</pre>
                <pre class="output">{buildCssBackgroundSnippet(fileOutput.dataUrl)}</pre>
              </div>
              {file && (
                <p class="field__hint">
                  {formatBytes(file.size)} original → {formatBytes(fileOutput.dataUrl.length)} as base64 (base64 always
                  inflates size by roughly a third — worth it for a small icon, usually not for a large photo).
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div class="panes panes--split">
            <div class="field">
              <label class="field__label" for="b64img-input">
                <span>Base64 or data URL</span>
              </label>
              <textarea
                id="b64img-input"
                class="textarea textarea--tall"
                spellcheck={false}
                autocomplete="off"
                placeholder="Paste a base64 string, or a data:image/…;base64,… URL"
                value={input}
                aria-invalid={decodeError !== null}
                onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
              />
            </div>

            {decoded ? (
              <div class="field">
                <div class="field__label">
                  <span>Preview</span>
                  <DownloadImageButton
                    bytes={decoded.bytes}
                    mimeType={decoded.mimeType}
                    filename={`decoded.${extensionFor(decoded.mimeType)}`}
                  />
                </div>
                <div class="image-preview">
                  <img src={decoded.dataUrl} alt="Decoded preview" />
                </div>
                <p class="field__hint">Detected type: {decoded.mimeType}</p>
              </div>
            ) : (
              <div class="field">
                <span class="field__label">Preview</span>
                <div class="image-preview image-preview--empty">Decoded image appears here.</div>
              </div>
            )}
          </div>

          <ErrorMessage message={decodeError} />
        </>
      )}

      <style>{`
        .image-preview {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); min-height: 10rem;
          display: flex; align-items: center; justify-content: center; padding: var(--space-3);
        }
        .image-preview img { max-width: 100%; max-height: 16rem; }
        .image-preview--empty { color: var(--text-muted); font-size: var(--text-sm); }
      `}</style>
    </div>
  );
}
