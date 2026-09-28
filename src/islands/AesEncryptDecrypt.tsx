import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AES_KEY_SIZES,
  AES_MODES,
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_FILE_BYTES,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  SALT_BYTES,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decryptPayload,
  decryptText,
  decryptedFileName,
  readableText,
  describeCipher,
  encryptPayload,
  encryptText,
  encryptedFileName,
  generateKeyHex,
  ivLength,
  loadAesEngine,
  type AesEngineId,
  type AesKeySize,
  type AesMode,
  type CipherEncoding,
  type KeyMaterial,
} from '../lib/tools/aes';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';
import { FileDropzone } from './shared/FileDropzone';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { downloadUrl } from './shared/downloadUrl';
import { formatBytes } from './shared/formatBytes';

type Direction = 'encrypt' | 'decrypt';
type InputKind = 'text' | 'file';
type KeySource = 'passphrase' | 'raw';

/**
 * What a share link carries. Deliberately never the passphrase, the raw key, the
 * plaintext or a file: the key is a credential, and the plaintext is exactly what
 * encryption is meant to protect. In text Decrypt mode the ciphertext (and a separate IV)
 * *is* shared — ciphertext is safe to send in the open, and "here is the link, I'll tell
 * you the passphrase another way" is the natural workflow for this tool.
 */
interface ShareState {
  direction: Direction;
  engine: AesEngineId;
  mode: AesMode;
  keySource: KeySource;
  keySize: AesKeySize;
  iterations: number;
  encoding: CipherEncoding;
  ciphertext?: string;
  ivHex?: string;
}

/** Hex parts of an encryption, shown so code that wants them separately can use them. */
interface Parts {
  saltHex: string | null;
  ivHex: string;
  /** Only for text results — a file's ciphertext is far too large to display. */
  ciphertext: string | null;
}

interface FileResult {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
}

// Match the worked example in aes-encrypt-decrypt.mdx exactly — the ciphertext was
// produced from SAMPLE_PLAINTEXT with SAMPLE_PASSPHRASE (AES-GCM-256, 600,000 iterations),
// and aes.test.ts proves it still decrypts, so the page and the button can't drift apart.
const SAMPLE_PLAINTEXT = 'Meet me at the usual place at 10pm.';
const SAMPLE_PASSPHRASE = 'correct horse battery staple';
const SAMPLE_CIPHERTEXT =
  '5mwsa04WUihXIiQZn06oCUMopkNn/Peg/+TtejnrIfHohyI+XlTlJUJnMnZZK2+SXGXrk0cSFkXI8jF5ROdLQFtawUYkjqlAps2c0gnz0Q==';
const SAMPLE_FILE_NAME = 'meeting-note.txt';

/**
 * Largest file result shown on the page. A <pre> holding tens of megabytes of text (or
 * of Base64, ~1.33x the byte size) makes the tab crawl, so above this the tool says why
 * and points at Download instead.
 */
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

/** Shown as a warning whenever a non-authenticated mode is selected. */
const UNAUTHENTICATED_MODE_WARNINGS: Partial<Record<AesMode, string>> = {
  'AES-CBC': 'Classic block mode with PKCS#7 padding. No integrity check; use for interop with older systems.',
  'AES-CTR': 'Stream-style counter mode, no padding. No integrity check; a wrong key yields garbage, not an error.',
};

function sampleFile(direction: Direction): File {
  if (direction === 'encrypt') return new File([SAMPLE_PLAINTEXT], SAMPLE_FILE_NAME, { type: 'text/plain' });
  const bytes = base64ToBytes(SAMPLE_CIPHERTEXT);
  // SAMPLE_CIPHERTEXT is a constant proven valid by aes.test.ts, so this branch is unreachable
  // in practice — but an empty file still yields a clear "too short" error rather than a crash.
  return new File([bytes.ok ? bytes.value : new Uint8Array(0)], encryptedFileName(SAMPLE_FILE_NAME), {
    type: 'application/octet-stream',
  });
}

function saveBytes(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  downloadUrl(url, name);
  URL.revokeObjectURL(url);
}

export default function AesEncryptDecrypt() {
  const [direction, setDirection] = useState<Direction>('encrypt');
  const [inputKind, setInputKind] = useState<InputKind>('text');
  const [mode, setMode] = useState<AesMode>('AES-GCM');
  const [keySource, setKeySource] = useState<KeySource>('passphrase');
  const [keySize, setKeySize] = useState<AesKeySize>(256);
  const [iterations, setIterations] = useState(DEFAULT_PBKDF2_ITERATIONS);
  const [encoding, setEncoding] = useState<CipherEncoding>('base64');
  const [engineId, setEngineId] = useState<AesEngineId>('webcrypto');

  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [keyHex, setKeyHex] = useState('');
  const [ivHex, setIvHex] = useState('');

  const [output, setOutput] = useState('');
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const [parts, setParts] = useState<Parts | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Opt-in, and reset to hidden for every new result: a decrypted file is often exactly
   * the sensitive thing, so it's never put on screen until the user asks.
   */
  const [showContent, setShowContent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Each run gets an id so a slow key derivation that finishes after the user has already
  // changed something can't overwrite the newer state with a stale result.
  const runId = useRef(0);

  // Decoded/encoded only while the view is open, so a large file never pays for it unasked.
  const filePreview = useMemo(() => {
    if (!showContent || !fileResult || fileResult.bytes.length > MAX_PREVIEW_BYTES) return null;
    const text = readableText(fileResult.bytes);
    return text === null
      ? { kind: 'base64' as const, value: bytesToBase64(fileResult.bytes) }
      : { kind: 'text' as const, value: text };
  }, [showContent, fileResult]);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setDirection(state.direction);
      setMode(state.mode);
      setKeySource(state.keySource);
      setKeySize(state.keySize);
      setIterations(state.iterations);
      setEncoding(state.encoding);
      // Older links (or hand-edited ones) may lack the field; default to the native engine.
      setEngineId(state.engine === 'js' ? 'js' : 'webcrypto');
      setInput(state.ciphertext ?? '');
      setIvHex(state.ivHex ?? '');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // A result is only valid for the exact inputs that produced it — clear it the moment any
  // of them changes, rather than leaving output on screen that no longer matches.
  useEffect(() => {
    runId.current += 1;
    setOutput('');
    setFileResult(null);
    setParts(null);
    setError(null);
    setBusy(false);
  }, [direction, inputKind, engineId, mode, keySource, keySize, iterations, encoding, input, file, passphrase, keyHex, ivHex]);

  const keyMaterial = (): KeyMaterial =>
    keySource === 'passphrase'
      ? { kind: 'passphrase', passphrase, iterations, keySize }
      : { kind: 'raw', keyHex, keySize };

  const fail = (message: string) => {
    setBusy(false);
    setOutput('');
    setFileResult(null);
    setParts(null);
    setError(message);
  };

  const run = async () => {
    const id = (runId.current += 1);
    setBusy(true);
    setShowContent(false);
    setError(null);
    const key = keyMaterial();
    const separateIv = keySource === 'raw' ? ivHex : '';

    const engine = await loadAesEngine(engineId);
    if (id !== runId.current) return;
    if (!engine.ok) return fail(engine.error);

    if (inputKind === 'file') {
      if (!file) return fail('Choose a file first.');
      if (file.size > MAX_FILE_BYTES) {
        return fail(`That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)} in a browser tab.`);
      }
      let data: Uint8Array<ArrayBuffer>;
      try {
        data = new Uint8Array(await file.arrayBuffer());
      } catch (thrown) {
        return fail(thrown instanceof Error ? `Could not read that file: ${thrown.message}` : 'Could not read that file.');
      }
      if (id !== runId.current) return;

      if (direction === 'encrypt') {
        const result = await encryptPayload(data, { engine: engine.value, mode, key });
        if (id !== runId.current) return;
        if (!result.ok) return fail(result.error);
        setBusy(false);
        setFileResult({ bytes: result.value.bytes, name: encryptedFileName(file.name) });
        setParts({
          saltHex: result.value.salt ? bytesToHex(result.value.salt) : null,
          ivHex: bytesToHex(result.value.iv),
          ciphertext: null,
        });
        return;
      }

      const result = await decryptPayload(data, { engine: engine.value, mode, key, ivHex: separateIv });
      if (id !== runId.current) return;
      if (!result.ok) return fail(result.error);
      setBusy(false);
      setFileResult({ bytes: result.value, name: decryptedFileName(file.name) });
      return;
    }

    if (direction === 'encrypt') {
      const result = await encryptText(input, { engine: engine.value, mode, key, encoding });
      if (id !== runId.current) return;
      if (!result.ok) return fail(result.error);
      setBusy(false);
      setOutput(result.value.combined);
      setParts({ saltHex: result.value.saltHex, ivHex: result.value.ivHex, ciphertext: result.value.ciphertext });
      return;
    }

    const result = await decryptText(input, { engine: engine.value, mode, key, encoding, ivHex: separateIv });
    if (id !== runId.current) return;
    if (!result.ok) return fail(result.error);
    setBusy(false);
    setOutput(result.value);
  };

  const loadExample = () => {
    setMode('AES-GCM');
    setKeySource('passphrase');
    setKeySize(256);
    setIterations(DEFAULT_PBKDF2_ITERATIONS);
    setEncoding('base64');
    setPassphrase(SAMPLE_PASSPHRASE);
    if (inputKind === 'file') setFile(sampleFile(direction));
    else setInput(direction === 'encrypt' ? SAMPLE_PLAINTEXT : SAMPLE_CIPHERTEXT);
  };

  const hasEncryptedResult = direction === 'encrypt' && (output !== '' || fileResult !== null);

  /** Moves an encryption result into the input and flips to Decrypt — a round-trip check. */
  const useResultAsInput = () => {
    if (!hasEncryptedResult) return;
    if (inputKind === 'file' && fileResult) {
      setFile(new File([fileResult.bytes], fileResult.name, { type: 'application/octet-stream' }));
    } else {
      setInput(output);
    }
    setIvHex('');
    setDirection('decrypt');
  };

  const clear = () => {
    setInput('');
    setFile(null);
    setPassphrase('');
    setKeyHex('');
    setIvHex('');
  };

  const shareState = (): ShareState => ({
    direction,
    engine: engineId,
    mode,
    keySource,
    keySize,
    iterations,
    encoding,
    ...(direction === 'decrypt' && inputKind === 'text'
      ? { ciphertext: input, ivHex: keySource === 'raw' ? ivHex : '' }
      : {}),
  });

  const hasKey = keySource === 'passphrase' ? passphrase !== '' : keyHex.trim() !== '';
  const hasInput = inputKind === 'file' ? file !== null : input.trim() !== '';
  const canRun = hasInput && hasKey && !busy;
  const actionLabel = direction === 'encrypt' ? 'Encrypt' : 'Decrypt';
  const cipherName = describeCipher(mode, keySize);
  const tag = mode === 'AES-GCM' ? ' + 16-byte tag' : '';
  const layout =
    keySource === 'passphrase'
      ? `salt (${SALT_BYTES} bytes) + IV (${ivLength(mode)} bytes) + ciphertext${tag}`
      : `IV (${ivLength(mode)} bytes) + ciphertext${tag}`;
  const encodingName = encoding === 'base64' ? 'Base64' : 'hex';

  /** Plain-text summary of everything except the secret, for pasting next to the ciphertext. */
  const recipeText = [
    `Cipher: ${cipherName}`,
    keySource === 'passphrase'
      ? `Key derivation: PBKDF2-HMAC-SHA-256, ${iterations.toLocaleString('en-US')} iterations, ${SALT_BYTES}-byte salt`
      : 'Key: raw 128/256-bit key (shared separately)',
    `Layout: ${layout}`,
    ...(inputKind === 'text' ? [`Encoding: ${encodingName}`] : []),
  ].join('\n');

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'encrypt'}
            onClick={() => setDirection('encrypt')}
            title="Turn plain text or a file into ciphertext"
          >
            Encrypt
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decrypt'}
            onClick={() => setDirection('decrypt')}
            title="Turn ciphertext back into the original text or file"
          >
            Decrypt
          </button>
        </div>
        <div class="seg" role="group" aria-label="Input type">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={inputKind === 'text'}
            onClick={() => setInputKind('text')}
            title="Type or paste text; ciphertext is shown as Base64 or hex"
          >
            Text
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={inputKind === 'file'}
            onClick={() => setInputKind('file')}
            title={`Encrypt or decrypt any file up to ${formatBytes(MAX_FILE_BYTES)}; the result downloads as a file`}
          >
            File
          </button>
        </div>
        <span class="tool-bar__spacer" />
        {/* Shares only settings (plus text ciphertext in Decrypt mode) — see ShareState. */}
        <ShareLinkButton
          getState={shareState}
          describe={
            direction === 'decrypt' && inputKind === 'text'
              ? 'this ciphertext and settings (never the key)'
              : 'these settings (never the text, file or key)'
          }
        />
        <button
          type="button"
          class="btn"
          onClick={loadExample}
          title={
            direction === 'encrypt'
              ? `Fill in a sample ${inputKind === 'file' ? 'file' : 'message'} and passphrase`
              : `Fill in a sample encrypted ${inputKind === 'file' ? 'file' : 'message'} and the passphrase that decrypts it`
          }
        >
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={useResultAsInput}
          disabled={!hasEncryptedResult}
          title="Move the encrypted result into the input and switch to Decrypt — a quick round-trip check"
        >
          <span aria-hidden="true">⇄</span> Decrypt result
        </button>
        <button
          type="button"
          class="btn"
          onClick={clear}
          disabled={input === '' && file === null && passphrase === '' && keyHex === '' && ivHex === ''}
          title="Clear the text, file, key and IV"
        >
          Clear
        </button>
      </div>

      {inputKind === 'text' ? (
        <div class="field">
          <label class="field__label" for="aes-input">
            <span>{direction === 'encrypt' ? 'Plain text' : 'Ciphertext'}</span>
            <span class="field__hint">{input.length.toLocaleString()} characters</span>
          </label>
          <textarea
            id="aes-input"
            class="textarea textarea--short"
            spellcheck={false}
            autocomplete="off"
            placeholder={direction === 'encrypt' ? 'Text to encrypt…' : `${encoding === 'base64' ? 'Base64' : 'Hex'} ciphertext to decrypt…`}
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canRun) {
                event.preventDefault();
                void run();
              }
            }}
          />
        </div>
      ) : (
        <div class="field">
          <span class="field__label">
            <span>{direction === 'encrypt' ? 'File to encrypt' : 'Encrypted file (.enc)'}</span>
            <span class="field__hint">Up to {formatBytes(MAX_FILE_BYTES)} · never uploaded</span>
          </span>
          <FileDropzone
            file={file}
            onFileSelected={setFile}
            chooseLabel={direction === 'encrypt' ? 'Choose a file to encrypt' : 'Choose an encrypted file to decrypt'}
          />
        </div>
      )}

      <div class="aes-settings">
        <div class="field">
          <label class="field__label" for="aes-mode" title="The AES block-cipher mode. GCM is authenticated; CBC and CTR are not.">
            <span>Mode</span>
          </label>
          <select
            id="aes-mode"
            class="select"
            value={mode}
            title="The AES block-cipher mode. GCM is authenticated; CBC and CTR are not."
            onChange={(event) => setMode((event.target as HTMLSelectElement).value as AesMode)}
          >
            {AES_MODES.map((value) => (
              <option key={value} value={value}>
                {value}
                {value === 'AES-GCM' ? ' (recommended)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <span
            class="field__label"
            title="The encryption strength: AES key length. 256-bit is the usual choice; both sides must use the same size."
          >
            <span>Key size</span>
          </span>
          <div class="seg" role="group" aria-label="Key size">
            {AES_KEY_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                class="seg__btn"
                aria-pressed={keySize === size}
                onClick={() => setKeySize(size)}
                title={size === 256 ? 'AES-256 — the strongest standard AES key size' : 'AES-128 — still secure, slightly faster'}
              >
                {size}-bit
              </button>
            ))}
          </div>
        </div>

        <div class="field">
          <span class="field__label">
            <span>Key from</span>
          </span>
          <div class="seg" role="group" aria-label="Key source">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={keySource === 'passphrase'}
              onClick={() => setKeySource('passphrase')}
              title="Derive the key from a passphrase with PBKDF2-SHA-256 and a random salt"
            >
              Passphrase
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={keySource === 'raw'}
              onClick={() => setKeySource('raw')}
              title="Use an exact key given as hex"
            >
              Raw key (hex)
            </button>
          </div>
        </div>

        <div class="field">
          <span
            class="field__label"
            title="Which implementation runs the cipher. Both give identical, interchangeable results."
          >
            <span>Engine</span>
          </span>
          <div class="seg" role="group" aria-label="Engine">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={engineId === 'webcrypto'}
              onClick={() => setEngineId('webcrypto')}
              title="Your browser's built-in Web Crypto API — fastest, nothing extra to download"
            >
              Web Crypto
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={engineId === 'js'}
              onClick={() => setEngineId('js')}
              title="Pure JavaScript (the audited @noble/ciphers library), no browser crypto API — loaded on first use"
            >
              Pure JS
            </button>
          </div>
        </div>

        {inputKind === 'text' && (
          <div class="field">
            <span
              class="field__label"
              title="Encrypted output is raw bytes; this is how they're written as pasteable text. Text mode only — File mode keeps any file, including binary ones like .zip, as raw bytes."
            >
              <span>Ciphertext as</span>
            </span>
            <div class="seg" role="group" aria-label="Encoding">
              <button
                type="button"
                class="seg__btn"
                aria-pressed={encoding === 'base64'}
                onClick={() => setEncoding('base64')}
                title="Ciphertext as Base64 — compact, the usual choice for text channels"
              >
                Base64
              </button>
              <button
                type="button"
                class="seg__btn"
                aria-pressed={encoding === 'hex'}
                onClick={() => setEncoding('hex')}
                title="Ciphertext as hexadecimal — longer, but easy to inspect byte by byte"
              >
                Hex
              </button>
            </div>
          </div>
        )}

      </div>

      {keySource === 'passphrase' ? (
        <div class="aes-key-row">
          <div class="field">
            <div class="field__label">
              <label for="aes-passphrase">Passphrase</label>
              <label class="checkbox" title="Reveal the passphrase to check it for typos">
                <input
                  type="checkbox"
                  checked={showPassphrase}
                  onChange={(event) => setShowPassphrase((event.target as HTMLInputElement).checked)}
                />
                Show
              </label>
            </div>
            <input
              id="aes-passphrase"
              class="input"
              type={showPassphrase ? 'text' : 'password'}
              spellcheck={false}
              autocomplete="off"
              placeholder="A long passphrase…"
              value={passphrase}
              onInput={(event) => setPassphrase((event.target as HTMLInputElement).value)}
            />
          </div>
          {/* Lives beside the passphrase rather than in the settings grid above: it only
              exists in passphrase mode, and adding/removing it there reflowed every toggle. */}
          <div class="field">
            <label
              class="field__label"
              for="aes-iterations"
              title="PBKDF2 rounds used to turn the passphrase into a key. Decrypting needs the same number."
            >
              <span>Iterations</span>
            </label>
            <input
              id="aes-iterations"
              class="input"
              type="number"
              min={MIN_PBKDF2_ITERATIONS}
              max={MAX_PBKDF2_ITERATIONS}
              step={1000}
              value={iterations}
              title="PBKDF2 rounds used to turn the passphrase into a key. Decrypting needs the same number."
              onInput={(event) => setIterations(Number((event.target as HTMLInputElement).value))}
            />
          </div>
          <span class="field__hint aes-key-row__hint">
            To decrypt, you need <strong>this exact passphrase</strong> plus the same mode, key size and iteration count
            ({describeCipher(mode, keySize)}, {iterations.toLocaleString('en-US')} iterations). The passphrase isn't
            stored anywhere and can't be recovered if lost. The random salt is saved inside the output, so you don't
            need to keep it.
          </span>
        </div>
      ) : (
        <>
          <div class="field">
            <div class="field__label">
              <label for="aes-key">Key (hex)</label>
              <span class="tool-bar__group">
                <button
                  type="button"
                  class="btn"
                  onClick={() => setKeyHex(generateKeyHex(keySize))}
                  title={`Fill in a fresh random ${keySize}-bit key from your browser's secure random generator`}
                >
                  Generate {keySize}-bit key
                </button>
                <CopyButton value={keyHex.trim()} describe="key" />
              </span>
            </div>
            <input
              id="aes-key"
              class="input"
              spellcheck={false}
              autocomplete="off"
              placeholder={`${keySize / 4} hex digits (${keySize}-bit)`}
              value={keyHex}
              onInput={(event) => setKeyHex((event.target as HTMLInputElement).value)}
            />
            <span class="field__hint">Save this key — it is the only way to decrypt, and it isn't stored anywhere.</span>
          </div>

          {direction === 'decrypt' && (
            <div class="field">
              <label
                class="field__label"
                for="aes-iv"
                title="Only needed if the IV was stored separately rather than at the start of the ciphertext."
              >
                <span>IV (hex, optional)</span>
              </label>
              <input
                id="aes-iv"
                class="input"
                spellcheck={false}
                autocomplete="off"
                placeholder={`Leave blank if the IV is prepended — otherwise ${ivLength(mode) * 2} hex digits`}
                value={ivHex}
                onInput={(event) => setIvHex((event.target as HTMLInputElement).value)}
              />
            </div>
          )}
        </>
      )}

      {UNAUTHENTICATED_MODE_WARNINGS[mode] && (
        <p class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>{UNAUTHENTICATED_MODE_WARNINGS[mode]} Prefer AES-GCM unless you need to match an existing system.</span>
        </p>
      )}

      <div class="tool-bar">
        <button type="button" class="btn btn--primary" onClick={() => void run()} disabled={!canRun}>
          {actionLabel} <span class="aes-cipher-name">({cipherName})</span>
        </button>
        {busy && (
          <span class="field__hint">
            <span class="job__spinner" aria-hidden="true" />{' '}
            {keySource === 'passphrase'
              ? engineId === 'js'
                ? 'Deriving key in JavaScript — slower than Web Crypto…'
                : 'Deriving key…'
              : `${actionLabel}ing…`}
          </span>
        )}
      </div>

      <ErrorMessage message={error} />

      {inputKind === 'text' ? (
        <OutputPane
          label={direction === 'encrypt' ? 'Ciphertext' : 'Decrypted text'}
          value={output}
          placeholder={
            direction === 'encrypt'
              ? `Ciphertext appears here — ${layout}, as ${encodingName}.`
              : 'Decrypted text appears here.'
          }
          describe={direction === 'encrypt' ? 'ciphertext' : 'decrypted text'}
        />
      ) : (
        fileResult && (
          <>
            <p class="msg msg--success">
              <span class="msg__icon" aria-hidden="true">
                ✓
              </span>
              <span class="aes-file-result">
                <span>
                  {direction === 'encrypt' ? 'Encrypted' : 'Decrypted'} — <code>{fileResult.name}</code> (
                  {formatBytes(fileResult.bytes.length)})
                </span>
                <button
                  type="button"
                  class="btn btn--primary"
                  onClick={() => saveBytes(fileResult.bytes, fileResult.name)}
                  title={`Save ${fileResult.name} to your device`}
                >
                  Download {fileResult.name}
                </button>
                <button
                  type="button"
                  class="btn"
                  aria-pressed={showContent}
                  onClick={() => setShowContent((shown) => !shown)}
                  title="Show the file on the page so you can copy it: as text if it's a text file, as Base64 if it's binary. Hidden until you ask, since it may be sensitive."
                >
                  {showContent ? 'Hide content' : 'Show content'}
                </button>
              </span>
            </p>

            {showContent &&
              (filePreview === null ? (
                <p class="msg msg--info">
                  <span class="msg__icon" aria-hidden="true">
                    i
                  </span>
                  <span>
                    This file is {formatBytes(fileResult.bytes.length)} — too large to show on the page (the limit is{' '}
                    {formatBytes(MAX_PREVIEW_BYTES)}). Use Download instead.
                  </span>
                </p>
              ) : (
                <OutputPane
                  label={
                    filePreview.kind === 'text'
                      ? `${fileResult.name} — text`
                      : `${fileResult.name} — binary file, shown as Base64`
                  }
                  value={filePreview.value}
                  placeholder="This file is empty."
                  describe={filePreview.kind === 'text' ? `${fileResult.name} contents` : `${fileResult.name} as Base64`}
                />
              ))}
          </>
        )
      )}

      {parts && direction === 'encrypt' && (
        <section class="aes-recipe" aria-label="What you need to decrypt">
          <h3 class="aes-recipe__title">To decrypt this, you need exactly three things</h3>
          <ol class="aes-recipe__steps">
            <li>
              <strong>The encrypted output</strong> —{' '}
              {inputKind === 'file' && fileResult ? (
                <>
                  the file <code>{fileResult.name}</code>
                </>
              ) : (
                'the whole string in the Ciphertext box above'
              )}
              .
            </li>
            <li>
              {keySource === 'passphrase' ? (
                <>
                  <strong>The passphrase</strong> — exactly as you typed it. It is not in the output and can't be recovered
                  if lost.
                </>
              ) : (
                <span class="aes-recipe__key">
                  <span>
                    <strong>The key</strong> — it is not in the output:
                  </span>
                  <code>{keyHex.trim()}</code>
                  <CopyButton value={keyHex.trim()} describe="key" />
                </span>
              )}
            </li>
            <li>
              <span class="aes-recipe__key">
                <span>
                  <strong>The same settings</strong> — {cipherName}
                  {keySource === 'passphrase' && <>, {iterations.toLocaleString('en-US')} iterations</>}
                  {inputKind === 'text' && <>, ciphertext as {encodingName}</>}.
                </span>
                <CopyButton value={recipeText} label="Copy settings" describe="decryption settings (without the key)" />
              </span>
            </li>
          </ol>
          <p class="field__hint">
            Send the {keySource === 'passphrase' ? 'passphrase' : 'key'} through a different channel than the encrypted
            output.
          </p>

          <details class="aes-recipe__details">
            <summary>
              Technical breakdown — already inside the encrypted output, only for code that wants the parts separately
            </summary>
            <dl class="aes-recipe__grid">
              {parts.saltHex !== null && (
                <>
                  <dt>Salt</dt>
                  <dd>
                    <code>{parts.saltHex}</code>
                    <CopyButton value={parts.saltHex} describe="salt" />
                  </dd>
                </>
              )}
              <dt>IV</dt>
              <dd>
                <code>{parts.ivHex}</code>
                <CopyButton value={parts.ivHex} describe="IV" />
              </dd>
              {parts.ciphertext !== null && (
                <>
                  <dt>Ciphertext{tag ? ' + tag' : ''}</dt>
                  <dd>
                    <code class="aes-recipe__long">{parts.ciphertext}</code>
                    <CopyButton value={parts.ciphertext} describe="ciphertext without salt and IV" />
                  </dd>
                </>
              )}
            </dl>
          </details>
        </section>
      )}

      <style>{`
        /* A wrapping row of content-sized controls, not an auto-sized grid: each control
           keeps its natural width, so toggles never wrap internally, and hiding the last
           one (Encoding in File mode) can't resize or shift the ones before it. */
        .aes-settings {
          display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-6);
          align-items: flex-start;
        }
        .aes-settings > .field { flex: 0 0 auto; }
        .aes-settings .select { width: auto; min-width: 14rem; }
        .aes-key-row {
          display: grid; gap: var(--space-2) var(--space-4);
          grid-template-columns: minmax(0, 1fr) minmax(8rem, 11rem);
          align-items: start;
        }
        .aes-key-row__hint { grid-column: 1 / -1; }
        @media (max-width: 30rem) {
          .aes-key-row { grid-template-columns: 1fr; }
        }
        /* Each .field is a flex column, which would stretch the toggle to the whole grid
           cell and leave an empty tail after its last button. Size it to its buttons. */
        .aes-settings .seg { align-self: flex-start; }
        .aes-cipher-name { font-weight: 400; opacity: .85; }
        .aes-file-result {
          display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3);
        }
        .aes-file-result code { font-family: var(--font-mono); word-break: break-all; }
        .aes-recipe {
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-3) var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
        }
        .aes-recipe__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
        }
        .aes-recipe__grid {
          display: grid; grid-template-columns: minmax(7rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .aes-recipe__grid dt { font-family: var(--font-mono); color: var(--text-muted); }
        .aes-recipe__grid dd {
          margin: 0; display: flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--text);
        }
        .aes-recipe__grid code {
          flex: 1; min-width: 0; font-family: var(--font-mono); word-break: break-all;
        }
        .aes-recipe__long { max-height: 6rem; overflow: auto; }
        .aes-recipe p { margin: 0; }
        .aes-recipe__steps {
          margin: 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: var(--space-2);
          font-size: var(--text-sm); color: var(--text);
        }
        .aes-recipe__steps code { font-family: var(--font-mono); word-break: break-all; }
        .aes-recipe__key { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .aes-recipe__details summary { cursor: pointer; font-size: var(--text-sm); color: var(--text-muted); }
        .aes-recipe__details[open] summary { margin-bottom: var(--space-3); }
        @media (max-width: 30rem) {
          .aes-recipe__grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
