import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  OAEP_HASHES,
  RSA_KEY_SIZES,
  WEAK_MODULUS_BITS,
  describeKeySource,
  generateRsaKeyPair,
  inspectKey,
  maxOaepPlaintextBytes,
  parseKey,
  rsaDecryptText,
  rsaEncryptText,
  type CipherEncoding,
  type GeneratedKeyPair,
  type KeyInfo,
  type OaepHash,
  type RsaKeySize,
  type RsaScheme,
} from '../lib/tools/rsa';
import type { ToolResult } from '../lib/tools/result';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Direction = 'encrypt' | 'decrypt';

/**
 * What a share link carries. Never the private key — it is the credential — and never the
 * plaintext, which is what encryption exists to protect. The *public* key is shared in
 * Encrypt mode: "here is my public key, send me something" is the natural workflow for
 * asymmetric encryption, and a public key is safe to publish by design. In Decrypt mode
 * the ciphertext is shared, which is equally safe to send in the open.
 */
interface ShareState {
  direction: Direction;
  scheme: RsaScheme;
  hash: OaepHash;
  encoding: CipherEncoding;
  newKeySize: RsaKeySize;
  publicKey?: string;
  ciphertext?: string;
}

// Match the worked example in rsa-encrypt-decrypt.mdx exactly: SAMPLE_CIPHERTEXT is
// SAMPLE_PLAINTEXT encrypted to SAMPLE_PUBLIC_KEY with RSA-OAEP/SHA-256, and the component
// test proves it still decrypts with SAMPLE_PRIVATE_KEY. It is a published demo key pair —
// the UI says so — never something to protect real data with.
const SAMPLE_PLAINTEXT = 'The deploy key rotates on Friday at 09:00 UTC.';
const SAMPLE_CIPHERTEXT =
  'IUUje2HvRzrOUXnkYpr1WGoUyuYt99OMbQ/Ligr3CYxRgYTFeGqv9BGo0MhhmPhxiz5+faH2nhSOUIvtP3HJ34AloGcFNOfSw8t881mDy/nb+0kg/TtbM7lReMHuR1kNTKplcWGotwzrilF6aoFyozWBZEdtfvt85mXnAkpJtKLs9YpTzXF1+NkUH/NRr7zq+lNoTkbPHLzbOAdLbdPI+czO0zdXlXktI5G+jZ9S5s16nbdhewnAAUlWBaiYLIc0NUM5/g2au9Ti9fbA4Z8JesLkdcvDACU3m+J+5ted7TQZweE+7B4auj21BUDwfuVFjk00e1JWRn+XOCJulF1fEw==';
const SAMPLE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuvf+1l1FfBfH93JbPD0J
k168l0/XEwPi9D60iSObkMLu8YKMRDjm7jqL339jcsYML9ddGTegCRQuQrlMt0KL
kwHUB6WY+0dVXFuZvLAYuv2VlsAUlMVsyiZfE9M3w2NWxEPAeMFWliPUyNHh7yd1
dfUm3sea8djgrzmWZJGRurKrwkeainzyhDj8ltwhPGYvt6fAkfLzcQhNEPb9aPiT
l5aH+A0/DKzuK0zkK3904I7hrG6S/i3ymvRP99YcNqbX8UnKZJRblFYIZMVWjgZ8
KBktgZCd3rxBMYQ9Y8vlUvj3A0nKahwtdrXTS4ik3akByYgqqiz+G8XJQ/BGiKO3
HwIDAQAB
-----END PUBLIC KEY-----
`;
const SAMPLE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC69/7WXUV8F8f3
cls8PQmTXryXT9cTA+L0PrSJI5uQwu7xgoxEOObuOovff2Nyxgwv110ZN6AJFC5C
uUy3QouTAdQHpZj7R1VcW5m8sBi6/ZWWwBSUxWzKJl8T0zfDY1bEQ8B4wVaWI9TI
0eHvJ3V19Sbex5rx2OCvOZZkkZG6sqvCR5qKfPKEOPyW3CE8Zi+3p8CR8vNxCE0Q
9v1o+JOXlof4DT8MrO4rTOQrf3TgjuGsbpL+LfKa9E/31hw2ptfxScpklFuUVghk
xVaOBnwoGS2BkJ3evEExhD1jy+VS+PcDScpqHC12tdNLiKTdqQHJiCqqLP4bxclD
8EaIo7cfAgMBAAECggEAHr7TSDr0RzC98GH8wM4kufg1OQinDHhyJMn+9CJH3alA
k7RtDnbw+rHj+G/BUclhjahzpcbw6S1JYi2IgQZPX3BIhq1jl8amMdbaVB39Ixq6
M50IhWJlvmRK9D6ih93ZEdM2XmUksPHZduCUr7gkZ65VowLd5vFMGWR157nMZg/d
aYBJxXHW8abEAir+vg9eMLudTEGqkIEU/1TmFfBf9qE7Q21poVn8Y0EBJHE60mKL
TZiSZqoMWltbhHI+VIdUY7FbNGj5bX905A0CzWlhq4Gv3oXjKF+ak1MI0dCKshSV
rNfrrVR9YUzTKWhRxnSkqtKmbBrNmCpGpKoC9MB8oQKBgQDrtClH9t5uI9zegj6k
PckrgIgL5/63wGFtBkrqukzv4d8zZLATvk8fhT9vNlMaShCRwUF/R2rd5oXx4eLG
SHxZvd0g7i0A4sKkuK54knuzIjrT8n/UANepEctXdipMgeX+REZ6gh2gqhTvYTL1
A5jCyOA2BXi1daEQJTIDDQCUzwKBgQDLEYW+Bg2JEW5kg3n0N0/thw/KJA1MVncX
5uaR4/C+ODGeuIwPC0seaOxnvV2XGWUFchRleHe1RjG/4wbqHXHypNVfkYbhTEpJ
xJsog3W2l53M7a9I5gXHuq5GzUTxbd6ZaPXzKdxsBf1/T3gUK+kq2QzVlB5ObAsk
8TblnJLssQKBgH55d8UzxHrZJ4UF4lMDDFUZbObmn5k904lK3RxCx1HYo4nSN2EA
tzg0qaslPUZYA7gSOPDxA3j6X1lBWgwHjSIibOtkoiVdiBAXQRdVkqa2cVaVQt4h
bZc9Ax11PJE9Cop7XE4UT42MdhtUzqEGQwwR+a1DFlhYPAqLyuA0M+GlAoGBAJHB
Qf3i2lRH7rS2qhJgoT4cc3jj56ejaFf/o/+TXHksXHFQhTdHI+Pv67+KbGLIF3qR
J5KtpT63432Xtp7UA7XmGkE+c1HDMI9CTxwFP7iPmvQ8plPsxrlVhUHMlG+2LNBw
RhkDMvNWWV3H7KiN3A6lPFEQv7AKXPVnLcAhYlQBAoGBANWuuXzPDKbc/N+on+NA
3Lfegm6VUvjFXxKO1DxWzii1FLb/KfUqvppbWYuwznX3DVzkdlT38zRqcGrnwXoZ
tvQMPvY0QSihv846urz1mpo4NePxl/nWg809Ey0f+EO0Pv/l9psro4ZeRs6dUSOm
xQO+vbyocGZoqzeR12NzvJR1
-----END PRIVATE KEY-----
`;

/** Pause after the last keystroke in a key box before the key is parsed and described. */
const KEY_INSPECT_DELAY_MS = 200;

const HASH_TITLES: Record<OaepHash, string> = {
  'SHA-256': 'SHA-256 — the modern default (RSA-OAEP-256 in JOSE)',
  'SHA-384': 'SHA-384',
  'SHA-512': 'SHA-512',
  'SHA-1': "SHA-1 — OpenSSL's and Node's OAEP default; still safe inside OAEP, but only use it for interop",
};

const isShareablePublicKey = (text: string): boolean => {
  const parsed = parseKey(text);
  return parsed.ok && parsed.value.kind === 'public';
};

export default function RsaEncryptDecrypt() {
  const [direction, setDirection] = useState<Direction>('encrypt');
  const [scheme, setScheme] = useState<RsaScheme>('oaep');
  const [hash, setHash] = useState<OaepHash>('SHA-256');
  const [encoding, setEncoding] = useState<CipherEncoding>('base64');
  const [newKeySize, setNewKeySize] = useState<RsaKeySize>(2048);

  const [input, setInput] = useState('');
  // Kept separately so switching direction never loses either half of a pair.
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [generated, setGenerated] = useState<GeneratedKeyPair | null>(null);
  const [generating, setGenerating] = useState(false);

  const [output, setOutput] = useState('');
  const [usedPrivateKey, setUsedPrivateKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyStatus, setKeyStatus] = useState<ToolResult<KeyInfo> | null>(null);

  // Each run gets an id so a slow operation that finishes after the user has changed
  // something can't overwrite the newer state with a stale result.
  const runId = useRef(0);

  const keyText = direction === 'encrypt' ? publicKey : privateKey;
  const setKeyText = direction === 'encrypt' ? setPublicKey : setPrivateKey;

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setDirection(state.direction === 'decrypt' ? 'decrypt' : 'encrypt');
      setScheme(state.scheme === 'hybrid' ? 'hybrid' : 'oaep');
      if (OAEP_HASHES.includes(state.hash)) setHash(state.hash);
      setEncoding(state.encoding === 'hex' ? 'hex' : 'base64');
      if (RSA_KEY_SIZES.includes(state.newKeySize)) setNewKeySize(state.newKeySize);
      // Re-checked on the way in, so a hand-edited link can't plant a private key.
      if (state.publicKey && isShareablePublicKey(state.publicKey)) setPublicKey(state.publicKey);
      setInput(state.ciphertext ?? '');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // A result is only valid for the exact inputs that produced it.
  useEffect(() => {
    runId.current += 1;
    setOutput('');
    setError(null);
    setBusy(false);
  }, [direction, scheme, hash, encoding, input, publicKey, privateKey]);

  // Describe the key in view (type, size, format) shortly after the user stops typing.
  useEffect(() => {
    if (keyText.trim() === '') {
      setKeyStatus(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void inspectKey(keyText).then((result) => {
        if (!cancelled) setKeyStatus(result);
      });
    }, KEY_INSPECT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [keyText]);

  const inputBytes = useMemo(
    () => (direction === 'encrypt' && scheme === 'oaep' ? new TextEncoder().encode(input).length : 0),
    [direction, scheme, input]
  );
  const keyInfo = keyStatus?.ok ? keyStatus.value : null;
  const oaepLimit = keyInfo ? maxOaepPlaintextBytes(keyInfo.modulusBits, hash) : null;

  const fail = (message: string) => {
    setBusy(false);
    setOutput('');
    setError(message);
  };

  const run = async () => {
    const id = (runId.current += 1);
    setBusy(true);
    setError(null);
    const options = { key: keyText, hash, scheme, encoding };

    if (direction === 'encrypt') {
      const result = await rsaEncryptText(input, options);
      if (id !== runId.current) return;
      if (!result.ok) return fail(result.error);
      setBusy(false);
      setUsedPrivateKey(result.value.usedPrivateKey);
      setOutput(result.value.ciphertext);
      return;
    }

    const result = await rsaDecryptText(input, options);
    if (id !== runId.current) return;
    if (!result.ok) return fail(result.error);
    setBusy(false);
    setOutput(result.value);
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const result = await generateRsaKeyPair(newKeySize);
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPublicKey(result.value.publicPem);
    setPrivateKey(result.value.privatePem);
    setGenerated(result.value);
  };

  const loadExample = () => {
    setScheme('oaep');
    setHash('SHA-256');
    setEncoding('base64');
    setPublicKey(SAMPLE_PUBLIC_KEY);
    setPrivateKey(SAMPLE_PRIVATE_KEY);
    setInput(direction === 'encrypt' ? SAMPLE_PLAINTEXT : SAMPLE_CIPHERTEXT);
  };

  const hasEncryptedResult = direction === 'encrypt' && output !== '';

  /** Moves the ciphertext into the input and flips to Decrypt — a round-trip check. */
  const useResultAsInput = () => {
    if (!hasEncryptedResult) return;
    setInput(output);
    setDirection('decrypt');
  };

  const clear = () => {
    setInput('');
    setPublicKey('');
    setPrivateKey('');
    setGenerated(null);
  };

  const shareState = (): ShareState => ({
    direction,
    scheme,
    hash,
    encoding,
    newKeySize,
    ...(direction === 'encrypt' && isShareablePublicKey(publicKey) ? { publicKey } : {}),
    ...(direction === 'decrypt' ? { ciphertext: input } : {}),
  });

  // The pair panel only describes keys that are still exactly what was generated.
  const showGenerated = generated !== null && publicKey === generated.publicPem && privateKey === generated.privatePem;
  const isSample = publicKey === SAMPLE_PUBLIC_KEY || privateKey === SAMPLE_PRIVATE_KEY;
  const canRun = input.trim() !== '' && keyText.trim() !== '' && !busy && !generating;
  const actionLabel = direction === 'encrypt' ? 'Encrypt' : 'Decrypt';
  const cipherName = scheme === 'oaep' ? `RSA-OAEP, ${hash}` : `RSA-OAEP ${hash} + AES-256-GCM`;
  const keyLabel = direction === 'encrypt' ? 'Public key' : 'Private key';

  const keyStatusText = (): { text: string; warn: boolean } | null => {
    if (keyStatus === null) return null;
    if (!keyStatus.ok) return { text: keyStatus.error, warn: true };
    const { kind, modulusBits, source } = keyStatus.value;
    const base = `RSA ${modulusBits}-bit ${kind} key (${describeKeySource(source)})`;
    const weak = modulusBits < WEAK_MODULUS_BITS ? ` — under ${WEAK_MODULUS_BITS} bits is considered weak` : '';
    if (direction === 'encrypt' && kind === 'private') {
      return { text: `${base} — its public half will be used to encrypt.${weak}`, warn: weak !== '' };
    }
    if (direction === 'decrypt' && kind === 'public') {
      return { text: `${base} — decrypting needs the private key, not the public one.`, warn: true };
    }
    return { text: `${base}${weak}`, warn: weak !== '' };
  };
  const status = keyStatusText();

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'encrypt'}
            onClick={() => setDirection('encrypt')}
            title="Encrypt with a public key — anyone can do this"
          >
            Encrypt
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={direction === 'decrypt'}
            onClick={() => setDirection('decrypt')}
            title="Decrypt with the matching private key — only its owner can do this"
          >
            Decrypt
          </button>
        </div>
        <span class="tool-bar__spacer" />
        {/* Shares the public key or the ciphertext plus settings — never the private key
            or the plaintext. See ShareState. */}
        <ShareLinkButton
          getState={shareState}
          describe={
            direction === 'encrypt'
              ? 'these settings and the public key (never the text or a private key)'
              : 'this ciphertext and settings (never the private key)'
          }
        />
        <button
          type="button"
          class="btn"
          onClick={loadExample}
          title={
            direction === 'encrypt'
              ? 'Fill in a sample message and a demo key pair'
              : 'Fill in a sample encrypted message and the demo private key that decrypts it'
          }
        >
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={useResultAsInput}
          disabled={!hasEncryptedResult}
          title="Move the ciphertext into the input and switch to Decrypt — a quick round-trip check"
        >
          <span aria-hidden="true">⇄</span> Decrypt result
        </button>
        <button
          type="button"
          class="btn"
          onClick={clear}
          disabled={input === '' && publicKey === '' && privateKey === ''}
          title="Clear the text and both keys"
        >
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="rsa-input">
          <span>{direction === 'encrypt' ? 'Plain text' : 'Ciphertext'}</span>
          <span class="field__hint">
            {direction === 'encrypt' && scheme === 'oaep' && oaepLimit !== null
              ? `${inputBytes.toLocaleString()} / ${oaepLimit} bytes`
              : `${input.length.toLocaleString()} characters`}
          </span>
        </label>
        <textarea
          id="rsa-input"
          class="textarea textarea--short"
          spellcheck={false}
          autocomplete="off"
          placeholder={
            direction === 'encrypt' ? 'Text to encrypt…' : `${encoding === 'base64' ? 'Base64' : 'Hex'} ciphertext to decrypt…`
          }
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
        {direction === 'encrypt' && scheme === 'oaep' && oaepLimit !== null && inputBytes > oaepLimit && (
          <span class="field__hint rsa-hint--warn">
            Over the {oaepLimit}-byte RSA-OAEP limit for this key — switch Scheme to Hybrid to encrypt any length.
          </span>
        )}
      </div>

      <div class="field">
        <div class="field__label rsa-key-label">
          <label for="rsa-key">
            {keyLabel} <span class="rsa-key-format">(PEM or JWK)</span>
          </label>
          <span class="tool-bar__group">
            <select
              class="select rsa-inline-select"
              aria-label="Size of new key pairs"
              title="Modulus size for a newly generated key pair. 2048 is the common minimum; larger is slower to generate."
              value={newKeySize}
              onChange={(event) => setNewKeySize(Number((event.target as HTMLSelectElement).value) as RsaKeySize)}
            >
              {RSA_KEY_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}-bit
                </option>
              ))}
            </select>
            <button
              type="button"
              class="btn"
              onClick={() => void generate()}
              disabled={generating}
              title="Create a fresh RSA key pair in your browser and fill in both the public and private key"
            >
              Generate key pair
            </button>
            <CopyButton value={keyText.trim()} describe={keyLabel.toLowerCase()} />
          </span>
        </div>
        <textarea
          id="rsa-key"
          class="textarea textarea--short rsa-key"
          spellcheck={false}
          autocomplete="off"
          placeholder={
            direction === 'encrypt'
              ? '-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'
              : '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'
          }
          value={keyText}
          onInput={(event) => setKeyText((event.target as HTMLTextAreaElement).value)}
        />
        {generating ? (
          <span class="field__hint">
            <span class="job__spinner" aria-hidden="true" /> Generating a {newKeySize}-bit key pair
            {newKeySize >= 4096 ? ' — this can take several seconds…' : '…'}
          </span>
        ) : (
          status && <span class={`field__hint${status.warn ? ' rsa-hint--warn' : ''}`}>{status.text}</span>
        )}
        {isSample && (
          <span class="field__hint">
            This is the published demo key pair — fine for trying the tool, never for real secrets.
          </span>
        )}
      </div>

      {showGenerated && (
        <div class="msg msg--success">
          <span class="msg__icon" aria-hidden="true">
            ✓
          </span>
          <span class="rsa-pair">
            <span>
              New {generated.modulusBits}-bit key pair. Share the <strong>public key</strong> with whoever will send you
              messages; keep the <strong>private key</strong> (shown in Decrypt mode) to yourself. It isn't stored
              anywhere — copy it now.
            </span>
            <span class="tool-bar__group">
              <CopyButton value={generated.publicPem} label="Copy public key" describe="public key" />
              <CopyButton value={generated.privatePem} label="Copy private key" describe="private key" />
            </span>
          </span>
        </div>
      )}

      <div class="rsa-settings">
        <div class="field">
          <label
            class="field__label"
            for="rsa-scheme"
            title="RSA-OAEP alone can only encrypt a few hundred bytes. Hybrid wraps a random AES key with RSA and encrypts the text with AES-GCM."
          >
            <span>Scheme</span>
          </label>
          <select
            id="rsa-scheme"
            class="select"
            value={scheme}
            title="RSA-OAEP alone can only encrypt a few hundred bytes. Hybrid wraps a random AES key with RSA and encrypts the text with AES-GCM."
            onChange={(event) => setScheme((event.target as HTMLSelectElement).value as RsaScheme)}
          >
            <option value="oaep">RSA-OAEP (short text, max interop)</option>
            <option value="hybrid">Hybrid: RSA-OAEP + AES-256-GCM (any length)</option>
          </select>
        </div>

        <div class="field">
          <label
            class="field__label"
            for="rsa-hash"
            title="The hash used inside OAEP padding (and its MGF1). Both sides must use the same one."
          >
            <span>OAEP hash</span>
          </label>
          <select
            id="rsa-hash"
            class="select"
            value={hash}
            title="The hash used inside OAEP padding (and its MGF1). Both sides must use the same one."
            onChange={(event) => setHash((event.target as HTMLSelectElement).value as OaepHash)}
          >
            {OAEP_HASHES.map((value) => (
              <option key={value} value={value} title={HASH_TITLES[value]}>
                {value}
                {value === 'SHA-256' ? ' (recommended)' : value === 'SHA-1' ? ' (OpenSSL default)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <span
            class="field__label"
            title="Ciphertext is raw bytes; this is how they are written as pasteable text. Decrypting needs the same choice."
          >
            <span>Ciphertext as</span>
          </span>
          <div class="seg" role="group" aria-label="Encoding">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={encoding === 'base64'}
              onClick={() => setEncoding('base64')}
              title="Ciphertext as Base64 — compact, the usual choice"
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
      </div>

      <div class="tool-bar">
        <button type="button" class="btn btn--primary" onClick={() => void run()} disabled={!canRun}>
          {actionLabel} <span class="rsa-cipher-name">({cipherName})</span>
        </button>
        {busy && (
          <span class="field__hint">
            <span class="job__spinner" aria-hidden="true" /> {actionLabel}ing…
          </span>
        )}
      </div>

      <ErrorMessage message={error} />

      <OutputPane
        label={direction === 'encrypt' ? 'Ciphertext' : 'Decrypted text'}
        value={output}
        placeholder={
          direction === 'encrypt'
            ? scheme === 'oaep'
              ? `Ciphertext appears here — one RSA block (256 bytes for a 2048-bit key), as ${encoding === 'base64' ? 'Base64' : 'hex'}.`
              : `Ciphertext appears here — wrapped AES key + 12-byte IV + AES-GCM ciphertext and tag, as ${encoding === 'base64' ? 'Base64' : 'hex'}.`
            : 'Decrypted text appears here.'
        }
        describe={direction === 'encrypt' ? 'ciphertext' : 'decrypted text'}
      />

      {hasEncryptedResult && (
        <p class="field__hint">
          Only the holder of the matching private key can decrypt this
          {usedPrivateKey ? ' (encrypted with the public half of the private key you pasted)' : ''}. They need the same
          scheme, {hash} as the OAEP hash, and {encoding === 'base64' ? 'Base64' : 'hex'} encoding. RSA-OAEP is randomised,
          so encrypting the same text again gives a different ciphertext.
        </p>
      )}

      <style>{`
        .rsa-settings {
          display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-6);
          align-items: flex-start;
        }
        .rsa-settings > .field { flex: 0 0 auto; }
        .rsa-settings > .field { max-width: 100%; }
        .rsa-settings .select { width: auto; min-width: 12rem; max-width: 100%; }
        /* On narrow screens the key actions drop below the label instead of squeezing it. */
        .rsa-key-label { flex-wrap: wrap; gap: var(--space-2); }
        .rsa-key-label .tool-bar__group { flex-wrap: wrap; }
        .rsa-settings .seg { align-self: flex-start; }
        .rsa-inline-select { width: auto; padding-block: 0.25rem; }
        .rsa-key { font-size: var(--text-xs); }
        .rsa-key-format { color: var(--text-subtle); font-weight: 400; }
        .rsa-hint--warn { color: var(--warning); }
        .rsa-cipher-name { font-weight: 400; opacity: .85; }
        .rsa-pair {
          display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3);
        }
      `}</style>
    </div>
  );
}
