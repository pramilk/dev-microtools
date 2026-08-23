import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  encodeBase64,
  decodeBase64,
  encodeFileToBase64,
  isImageDataUrl,
} from '../lib/tools/base64';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { FileDropzone } from './shared/FileDropzone';
import { formatBytes } from './shared/formatBytes';

type Direction = 'encode' | 'decode';
type Source = 'text' | 'file';

export default function Base64Tool() {
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');
  const [urlSafe, setUrlSafe] = useState(false);
  const [source, setSource] = useState<Source>('text');
  const [file, setFile] = useState<File | null>(null);
  const [includeDataUrl, setIncludeDataUrl] = useState(true);

  const [fileOutput, setFileOutput] = useState<{ base64: string; dataUrl: string; mimeType: string } | null>(
    null
  );
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'file' || direction !== 'encode' || !file) {
      setFileOutput(null);
      setFileError(null);
      return;
    }

    let cancelled = false;
    void encodeFileToBase64(file).then((result) => {
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
  }, [source, direction, file]);

  const textResult = useMemo(() => {
    if (source === 'file' || input === '') return null;
    return direction === 'encode' ? encodeBase64(input, urlSafe) : decodeBase64(input);
  }, [source, input, direction, urlSafe]);

  const output =
    source === 'file'
      ? (fileOutput && (includeDataUrl ? fileOutput.dataUrl : fileOutput.base64)) ?? ''
      : textResult?.ok
        ? textResult.value
        : '';
  const error = source === 'file' ? fileError : textResult && !textResult.ok ? textResult.error : null;

  // A pasted data: URL is previewable even though it never goes through decodeBase64
  // as text — decoding raw image bytes as UTF-8 would just fail.
  const previewDataUrl = direction === 'decode' && isImageDataUrl(input) ? input.trim() : null;

  /** Moves the result into the input and flips direction, for round-tripping. */
  const swap = () => {
    if (output === '' || source === 'file') return;
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
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
            title="Convert plain text or a file into base64"
          >
            Encode
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decode'}
            onClick={() => {
              setDirection('decode');
              setSource('text');
            }}
            title="Convert base64 back into plain text"
          >
            Decode
          </button>
        </div>

        {direction === 'encode' && (
          <div class="seg" role="group" aria-label="Source">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={source === 'text'}
              onClick={() => setSource('text')}
              title="Encode text you type or paste"
            >
              Text
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={source === 'file'}
              onClick={() => setSource('file')}
              title="Encode an entire file — useful for inlining a small image as a data: URL"
            >
              File
            </button>
          </div>
        )}

        {direction === 'encode' && source === 'text' && (
          <label class="checkbox">
            <input
              type="checkbox"
              checked={urlSafe}
              onChange={(event) => setUrlSafe((event.target as HTMLInputElement).checked)}
            />
            URL-safe (-_ instead of +/, no padding)
          </label>
        )}

        {direction === 'encode' && source === 'file' && (
          <label class="checkbox" title="Include the data: URL prefix, so the result can be pasted straight into an <img src> or CSS url()">
            <input
              type="checkbox"
              checked={includeDataUrl}
              onChange={(event) => setIncludeDataUrl((event.target as HTMLInputElement).checked)}
            />
            Include data: URL prefix
          </label>
        )}

        <span class="tool-bar__spacer" />

        {source === 'text' && (
          <button
            type="button"
            class="btn"
            onClick={swap}
            disabled={output === ''}
            title="Copy the result into the input and flip direction — useful for checking a round trip"
          >
            <span aria-hidden="true">⇄</span> Use result as input
          </button>
        )}
        <button
          type="button"
          class="btn"
          onClick={() => {
            setInput('');
            setFile(null);
          }}
          disabled={input === '' && file === null}
          title="Clear the input and start over"
        >
          Clear
        </button>
      </div>

      {source === 'text' ? (
        <div class="panes panes--split">
          <div class="field">
            <label class="field__label" for="b64-input">
              <span>{direction === 'encode' ? 'Plain text' : 'Base64'}</span>
              <span class="field__hint">{input.length.toLocaleString()} characters</span>
            </label>
            <textarea
              id="b64-input"
              class="textarea"
              spellcheck={false}
              autocomplete="off"
              placeholder={
                direction === 'encode'
                  ? 'Type or paste text to encode…'
                  : 'Paste base64, or a data:…;base64,… URL, to decode…'
              }
              value={input}
              aria-invalid={error !== null}
              onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            />
          </div>

          {previewDataUrl ? (
            <div class="field">
              <span class="field__label">Image preview</span>
              <div class="image-preview">
                <img src={previewDataUrl} alt="Decoded preview" />
              </div>
            </div>
          ) : (
            <OutputPane
              label={direction === 'encode' ? 'Base64' : 'Decoded text'}
              value={output}
              placeholder={
                direction === 'encode' ? 'Encoded output appears here.' : 'Decoded text appears here.'
              }
              describe={direction === 'encode' ? 'base64' : 'decoded text'}
            />
          )}
        </div>
      ) : (
        <div class="panes panes--split">
          <FileDropzone
            file={file}
            onFileSelected={setFile}
            chooseLabel="Choose a file to encode"
            describeFile={(f) => `${formatBytes(f.size)} · ${f.type || 'unknown type'}`}
          />

          {fileOutput?.mimeType.startsWith('image/') ? (
            <div class="field">
              <span class="field__label">Image preview</span>
              <div class="image-preview">
                <img src={fileOutput.dataUrl} alt={file?.name ?? 'Encoded preview'} />
              </div>
            </div>
          ) : (
            <OutputPane
              label="Base64"
              value={output}
              placeholder="Encoded output appears here."
              describe="base64"
              tall
            />
          )}
        </div>
      )}

      <ErrorMessage message={error} />

      {output !== '' && source === 'text' && (
        <p class="stats">
          <span class="stats__item">
            <strong>{input.length.toLocaleString()}</strong> in
          </span>
          <span class="stats__item">
            <strong>{output.length.toLocaleString()}</strong> out
          </span>
          {direction === 'encode' && (
            <span class="stats__item">
              <strong>
                {input.length > 0 ? `+${Math.round((output.length / input.length - 1) * 100)}%` : '—'}
              </strong>{' '}
              size change
            </span>
          )}
        </p>
      )}

      <style>{`
        .image-preview {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface-2); min-height: 10rem;
          display: flex; align-items: center; justify-content: center; padding: var(--space-3);
        }
        .image-preview img { max-width: 100%; max-height: 16rem; }
      `}</style>
    </div>
  );
}
