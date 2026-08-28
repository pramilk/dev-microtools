import { useEffect, useMemo, useState } from 'preact/hooks';
import { type ToolResult } from '../lib/tools/result';
import { encodeBase64, decodeBase64, encodeFileToBase64, isImageDataUrl } from '../lib/tools/base64';
import { encodeBase32, decodeBase32 } from '../lib/tools/base32';
import { encodeBase58, decodeBase58 } from '../lib/tools/base58';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { FileDropzone } from './shared/FileDropzone';
import { formatBytes } from './shared/formatBytes';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Format = 'base64' | 'base32' | 'base58';
type Direction = 'encode' | 'decode';
type Source = 'text' | 'file';

interface ShareState {
  // Optional so links generated before formats were merged into one tool — which never
  // carried this field — still restore correctly, falling back to the ?format= query
  // param a redirect from an old URL supplies instead.
  format?: Format;
  input: string;
  direction: Direction;
  urlSafe: boolean;
  padding: boolean;
}

const FORMAT_LABEL: Record<Format, string> = {
  base64: 'Base64',
  base32: 'Base32',
  base58: 'Base58',
};

const FORMAT_TITLE: Record<Format, string> = {
  base64: '64-character alphabet (A-Z, a-z, 0-9, +, /) — the most common variant, compact but not safe to read aloud or retype',
  base32: '32-character alphabet (A-Z, 2-7) — case-insensitive; used for TOTP/2FA secret keys',
  base58: "58-character alphabet — excludes 0, O, I and l; used for Bitcoin addresses and IPFS CIDs",
};

const DECODE_PLACEHOLDER: Record<Format, string> = {
  base64: 'Paste base64, or a data:…;base64,… URL, to decode…',
  base32: 'Paste base32 to decode, e.g. a TOTP secret key…',
  base58: 'Paste Base58 to decode… (never 0, O, I or l)',
};

// Matches each format's own worked example, so "Load example" round-trips cleanly.
const SAMPLES: Record<Format, { plain: string; encoded: string }> = {
  base64: { plain: 'Hello, World!', encoded: 'SGVsbG8sIFdvcmxkIQ==' },
  base32: { plain: 'foobar', encoded: 'MZXW6YTBOI======' },
  base58: { plain: 'hello world', encoded: 'StV1DL6CwTryKyV' },
};

const isFormat = (value: string | null): value is Format =>
  value === 'base64' || value === 'base32' || value === 'base58';

export default function BaseConverterTool() {
  const [format, setFormat] = useState<Format>('base64');
  const [input, setInput] = useState('');
  const [direction, setDirection] = useState<Direction>('encode');
  const [urlSafe, setUrlSafe] = useState(false);
  const [padding, setPadding] = useState(true);
  const [source, setSource] = useState<Source>('text');
  const [file, setFile] = useState<File | null>(null);
  const [includeDataUrl, setIncludeDataUrl] = useState(true);

  const changeFormat = (next: Format) => {
    setFormat(next);
    if (next !== 'base64') setSource('text');
  };

  // Restores state from either a share link (#s=...) or a ?format= deep link, which is
  // what a 301 redirect from a pre-merge URL like /base64-encode-decode/ points to. File
  // content is never part of either — it isn't practical (or always safe) to put in a URL.
  useEffect(() => {
    const formatParam = new URLSearchParams(window.location.search).get('format');
    const hasFormatParam = isFormat(formatParam);
    if (hasFormatParam) setFormat(formatParam);

    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (restored?.ok) {
        if (restored.value.format) setFormat(restored.value.format);
        setSource('text');
        setInput(restored.value.input);
        setDirection(restored.value.direction);
        setUrlSafe(restored.value.urlSafe);
        setPadding(restored.value.padding);
      }
      if (hasFormatParam || restored?.ok) {
        history.replaceState(null, '', window.location.pathname);
      }
    });
  }, []);

  const [fileOutput, setFileOutput] = useState<{ base64: string; dataUrl: string; mimeType: string } | null>(
    null
  );
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (format !== 'base64' || source !== 'file' || direction !== 'encode' || !file) {
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
  }, [format, source, direction, file]);

  const textResult = useMemo((): ToolResult<string> | null => {
    if (source === 'file' || input === '') return null;
    if (direction === 'decode') {
      switch (format) {
        case 'base64':
          return decodeBase64(input);
        case 'base32':
          return decodeBase32(input);
        case 'base58':
          return decodeBase58(input);
      }
    }
    switch (format) {
      case 'base64':
        return encodeBase64(input, urlSafe);
      case 'base32':
        return encodeBase32(input, { padding });
      case 'base58':
        return encodeBase58(input);
    }
  }, [source, input, direction, format, urlSafe, padding]);

  const isFileMode = format === 'base64' && source === 'file';
  const output = isFileMode
    ? (fileOutput && (includeDataUrl ? fileOutput.dataUrl : fileOutput.base64)) ?? ''
    : textResult?.ok
      ? textResult.value
      : '';
  const error = isFileMode ? fileError : textResult && !textResult.ok ? textResult.error : null;

  // A pasted data: URL is previewable even though it never goes through decodeBase64
  // as text — decoding raw image bytes as UTF-8 would just fail.
  const previewDataUrl =
    format === 'base64' && direction === 'decode' && isImageDataUrl(input) ? input.trim() : null;

  /** Moves the result into the input and flips direction, for round-tripping. */
  const swap = () => {
    if (output === '' || isFileMode) return;
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  };

  const sample = SAMPLES[format];

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Format">
          {(['base64', 'base32', 'base58'] as const).map((f) => (
            <button
              key={f}
              type="button"
              class="seg__btn"
              aria-pressed={format === f}
              onClick={() => changeFormat(f)}
              title={FORMAT_TITLE[f]}
            >
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>

        <div class="seg" role="group" aria-label="Direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'encode'}
            onClick={() => setDirection('encode')}
            title={`Convert plain text or a file into ${FORMAT_LABEL[format]}`}
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
            title={`Convert ${FORMAT_LABEL[format]} back into plain text`}
          >
            Decode
          </button>
        </div>

        {format === 'base64' && direction === 'encode' && (
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

        {format === 'base64' && direction === 'encode' && source === 'text' && (
          <label class="checkbox">
            <input
              type="checkbox"
              checked={urlSafe}
              onChange={(event) => setUrlSafe((event.target as HTMLInputElement).checked)}
            />
            URL-safe (-_ instead of +/, no padding)
          </label>
        )}

        {format === 'base32' && direction === 'encode' && (
          <label
            class="checkbox"
            title="TOTP/2FA secret keys are conventionally shown without the trailing = padding"
          >
            <input
              type="checkbox"
              checked={!padding}
              onChange={(event) => setPadding(!(event.target as HTMLInputElement).checked)}
            />
            Omit padding (=)
          </label>
        )}

        {format === 'base64' && direction === 'encode' && source === 'file' && (
          <label
            class="checkbox"
            title="Include the data: URL prefix, so the result can be pasted straight into an <img src> or CSS url()"
          >
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
          <ShareLinkButton getState={() => ({ format, input, direction, urlSafe, padding })} describe="this text" />
        )}
        {source === 'text' && (
          <button
            type="button"
            class="btn"
            onClick={() => setInput(direction === 'encode' ? sample.plain : sample.encoded)}
            title="Load a small example"
          >
            Load example
          </button>
        )}
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
            <label class="field__label" for="base-input">
              <span>{direction === 'encode' ? 'Plain text' : FORMAT_LABEL[format]}</span>
              <span class="field__hint">{input.length.toLocaleString()} characters</span>
            </label>
            <textarea
              id="base-input"
              class="textarea"
              spellcheck={false}
              autocomplete="off"
              placeholder={direction === 'encode' ? 'Type or paste text to encode…' : DECODE_PLACEHOLDER[format]}
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
              label={direction === 'encode' ? FORMAT_LABEL[format] : 'Decoded text'}
              value={output}
              placeholder={direction === 'encode' ? 'Encoded output appears here.' : 'Decoded text appears here.'}
              describe={direction === 'encode' ? FORMAT_LABEL[format].toLowerCase() : 'decoded text'}
              actions={
                format === 'base64' ? (
                  <DownloadButton
                    value={output}
                    filename={direction === 'encode' ? 'encoded.txt' : 'decoded.txt'}
                    describe={direction === 'encode' ? 'base64' : 'decoded text'}
                  />
                ) : undefined
              }
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
              actions={<DownloadButton value={output} filename="encoded.txt" describe="base64" />}
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
