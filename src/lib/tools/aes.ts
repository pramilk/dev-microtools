import { type ToolResult, ok, err, messageFrom } from './result';
import { AesDecryptError, webCryptoEngine, type AesEngine, type AesMode } from './aesEngine';

export { AES_MODES, AesDecryptError, webCryptoEngine, type AesEngine, type AesMode } from './aesEngine';

/**
 * AES encryption and decryption of text and files. The actual cipher runs on a pluggable
 * `AesEngine` — the browser's native SubtleCrypto by default, or pure JavaScript on
 * request (see aesEngine.ts). Either way nothing ever leaves the page.
 *
 * Payload layout (the same bytes whether they end up Base64/hex text or a `.enc` file):
 *   passphrase key:            salt (16) | IV | ciphertext
 *   raw key, IV prepended:     IV | ciphertext
 *   raw key, IV supplied:      ciphertext
 * For AES-GCM the 16-byte authentication tag is appended to the ciphertext, which is
 * what SubtleCrypto, Node's `crypto.webcrypto` and most GCM libraries expect.
 */

export const AES_ENGINE_IDS = ['webcrypto', 'js'] as const;
export type AesEngineId = (typeof AES_ENGINE_IDS)[number];

/**
 * Resolves an engine id to an implementation. The pure-JS engine is a dynamic `import()`
 * so its libraries are only downloaded by visitors who actually choose it.
 */
export async function loadAesEngine(id: AesEngineId): Promise<ToolResult<AesEngine>> {
  if (id === 'webcrypto') {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return err(
        'This browser does not expose Web Crypto here (it needs a secure https:// page). Switch the engine to Pure JS.'
      );
    }
    return ok(webCryptoEngine);
  }
  try {
    return ok((await import('./aesJsEngine')).jsEngine);
  } catch (error) {
    return err(
      `Could not load the pure-JavaScript AES engine (${messageFrom(error, 'unknown error')}). Check your connection and reload the page.`
    );
  }
}

/**
 * 192-bit keys are deliberately absent, for both engines: Chromium's Web Crypto rejects
 * them outright, so offering them would produce ciphertext some visitors' browsers could
 * not decrypt with the default engine.
 */
export const AES_KEY_SIZES = [128, 256] as const;
export type AesKeySize = (typeof AES_KEY_SIZES)[number];

export type CipherEncoding = 'base64' | 'hex';

export const SALT_BYTES = 16;
const GCM_TAG_BYTES = 16;
const AES_BLOCK_BYTES = 16;

/** OWASP's 2023+ recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_PBKDF2_ITERATIONS = 1_000;
/** Above this, deriving the key takes long enough in a browser to look like a hang. */
export const MAX_PBKDF2_ITERATIONS = 10_000_000;

/** Plenty for typed or pasted text; keeps a pasted giant blob from locking up the tab. */
export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
/**
 * Both engines are one-shot (the whole file in memory, plus a same-sized output buffer),
 * so this is a memory ceiling, not a speed one — comfortably inside what a phone tab has.
 */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** File extension given to encrypted files, and stripped again on decryption. */
export const ENCRYPTED_FILE_EXTENSION = '.enc';

/** GCM's standard nonce is 96 bits; CBC and CTR take a full 128-bit block. */
export const ivLength = (mode: AesMode): number => (mode === 'AES-GCM' ? 12 : AES_BLOCK_BYTES);

/** The conventional name for a cipher configuration, e.g. "AES-256-GCM". */
export const describeCipher = (mode: AesMode, keySize: AesKeySize): string =>
  `AES-${keySize}-${mode.replace('AES-', '')}`;

export type KeyMaterial =
  | { kind: 'passphrase'; passphrase: string; iterations: number; keySize: AesKeySize }
  | { kind: 'raw'; keyHex: string; keySize: AesKeySize };

export interface PayloadOptions {
  engine: AesEngine;
  mode: AesMode;
  key: KeyMaterial;
}

export interface EncryptPayloadOptions extends PayloadOptions {
  /** Fixed IV/salt for reproducible tests. Real use leaves these unset so they are random. */
  iv?: Uint8Array<ArrayBuffer>;
  salt?: Uint8Array<ArrayBuffer>;
}

export interface DecryptPayloadOptions extends PayloadOptions {
  /**
   * Raw-key mode only: the IV as hex. Empty or unset means the IV is read from the
   * front of the input, matching what `encryptPayload` produces.
   */
  ivHex?: string;
}

export interface EncryptedPayload {
  /** salt | IV | ciphertext — the single self-contained value to store or send. */
  bytes: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer> | null;
  iv: Uint8Array<ArrayBuffer>;
  /** Ciphertext alone (GCM tag included). */
  ciphertext: Uint8Array<ArrayBuffer>;
}

export interface EncryptOptions extends EncryptPayloadOptions {
  encoding: CipherEncoding;
}

export interface DecryptOptions extends DecryptPayloadOptions {
  encoding: CipherEncoding;
}

export interface EncryptResult {
  /** The single self-contained string to store or send. */
  combined: string;
  /** Individual parts, hex-encoded, for wiring into code that expects them separately. */
  saltHex: string | null;
  ivHex: string;
  /** Ciphertext alone (GCM tag included), in the chosen encoding. */
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Byte encoding helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Accepts upper/lower case, an optional `0x` prefix, and whitespace or `:` separators. */
export function hexToBytes(input: string): ToolResult<Uint8Array<ArrayBuffer>> {
  const hex = input.replace(/^0x/i, '').replace(/[\s:]/g, '');
  if (!/^[0-9a-f]*$/i.test(hex)) {
    return err('That is not valid hex — only the characters 0-9 and a-f are allowed.');
  }
  if (hex.length % 2 !== 0) {
    return err('That hex has an odd number of digits — every byte needs exactly two.');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return ok(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a multi-megabyte buffer doesn't blow the argument-count limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Accepts standard or URL-safe Base64, with or without padding, ignoring whitespace. */
export function base64ToBytes(input: string): ToolResult<Uint8Array<ArrayBuffer>> {
  const cleaned = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(cleaned) || cleaned.length % 4 === 1) {
    return err('That is not valid Base64. If the ciphertext is hex, switch the encoding to Hex.');
  }
  const binary = atob(cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return ok(bytes);
}

const encodeBytes = (bytes: Uint8Array, encoding: CipherEncoding): string =>
  encoding === 'hex' ? bytesToHex(bytes) : bytesToBase64(bytes);

const decodeBytes = (text: string, encoding: CipherEncoding): ToolResult<Uint8Array<ArrayBuffer>> =>
  encoding === 'hex' ? hexToBytes(text) : base64ToBytes(text);

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(length));

/**
 * Share of C0 control characters (other than tab, newline, carriage return, form feed and
 * vertical tab) tolerated before bytes are treated as binary. Real text files carry the
 * odd stray escape or backspace; binary formats that happen to decode as UTF-8 are thick
 * with them.
 */
const MAX_CONTROL_CHAR_RATIO = 0.01;

/**
 * Returns the bytes as text if they look like a human-readable text file, or null if they
 * look binary (a zip, an image, ciphertext) and should be shown as Base64 instead.
 * Readable means: valid UTF-8, no NUL characters, and almost no other control characters.
 */
export function readableText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Invalid UTF-8 is the commonest binary signal; not an error, just "not text".
    return null;
  }
  let controls = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0) return null;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0b && code !== 0x0c && code !== 0x0d) || code === 0x7f) {
      controls += 1;
    }
  }
  return text.length > 0 && controls / text.length > MAX_CONTROL_CHAR_RATIO ? null : text;
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

export const encryptedFileName = (name: string): string => `${name || 'file'}${ENCRYPTED_FILE_EXTENSION}`;

/** Strips a trailing `.enc`; otherwise marks the name so the original is never overwritten. */
export function decryptedFileName(name: string): string {
  if (name.toLowerCase().endsWith(ENCRYPTED_FILE_EXTENSION) && name.length > ENCRYPTED_FILE_EXTENSION.length) {
    return name.slice(0, -ENCRYPTED_FILE_EXTENSION.length);
  }
  return `${name || 'file'}.decrypted`;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** A fresh random key, as hex, from the browser's CSPRNG. */
export const generateKeyHex = (keySize: AesKeySize): string => bytesToHex(randomBytes(keySize / 8));

/** Validates a raw hex key against the selected key size and returns its bytes. */
export function parseRawKey(keyHex: string, keySize: AesKeySize): ToolResult<Uint8Array<ArrayBuffer>> {
  if (keyHex.trim() === '') return err('Enter a key, or click "Generate key" to create a random one.');
  const bytes = hexToBytes(keyHex);
  if (!bytes.ok) return err(`Key: ${bytes.error}`);
  const bits = bytes.value.length * 8;
  if (bits === keySize) return bytes;
  if (bits === 192) {
    return err(
      'Key is 192 bits. Chrome and Edge do not support 192-bit AES keys in Web Crypto, so this tool sticks to sizes every browser can decrypt — use a 128-bit (32 hex digits) or 256-bit (64 hex digits) key.'
    );
  }
  if (bits === 128 || bits === 256) {
    return err(`Key is ${bits} bits, but Key size is set to ${keySize}-bit. Switch Key size to ${bits}-bit, or use a ${keySize}-bit key.`);
  }
  return err(`Key is ${bits} bits — a ${keySize}-bit key needs exactly ${keySize / 4} hex digits.`);
}

function validatePassphrase(key: Extract<KeyMaterial, { kind: 'passphrase' }>): string | null {
  if (key.passphrase === '') return 'Enter a passphrase.';
  if (!Number.isInteger(key.iterations)) return 'Iterations must be a whole number.';
  if (key.iterations < MIN_PBKDF2_ITERATIONS) {
    return `Iterations must be at least ${MIN_PBKDF2_ITERATIONS.toLocaleString('en-US')} — fewer makes the passphrase cheap to brute-force.`;
  }
  if (key.iterations > MAX_PBKDF2_ITERATIONS) {
    return `Iterations must be ${MAX_PBKDF2_ITERATIONS.toLocaleString('en-US')} or lower, or deriving the key takes too long in a browser.`;
  }
  return null;
}

async function resolveKey(
  engine: AesEngine,
  key: KeyMaterial,
  salt: Uint8Array<ArrayBuffer>
): Promise<ToolResult<Uint8Array<ArrayBuffer>>> {
  if (key.kind === 'raw') return parseRawKey(key.keyHex, key.keySize);
  try {
    return ok(await engine.pbkdf2Sha256(key.passphrase, salt, key.iterations, key.keySize / 8));
  } catch (error) {
    return err(messageFrom(error, 'Could not derive a key from that passphrase.'));
  }
}

// ---------------------------------------------------------------------------
// Byte-level API (files use this directly; text wraps it)
// ---------------------------------------------------------------------------

export async function encryptPayload(
  data: Uint8Array<ArrayBuffer>,
  options: EncryptPayloadOptions
): Promise<ToolResult<EncryptedPayload>> {
  const { engine, mode, key } = options;
  if (data.length > MAX_FILE_BYTES) {
    return err('That is over 100 MB — too large to encrypt in one go in a browser tab.');
  }

  const iv = options.iv ?? randomBytes(ivLength(mode));
  if (iv.length !== ivLength(mode)) return err(`${mode} needs a ${ivLength(mode)}-byte IV.`);

  let salt: Uint8Array<ArrayBuffer> | null = null;
  if (key.kind === 'passphrase') {
    const problem = validatePassphrase(key);
    if (problem) return err(problem);
    salt = options.salt ?? randomBytes(SALT_BYTES);
  }

  const keyBytes = await resolveKey(engine, key, salt ?? new Uint8Array(0));
  if (!keyBytes.ok) return keyBytes;

  try {
    const ciphertext = await engine.encrypt(mode, keyBytes.value, iv, data);
    return ok({ bytes: salt ? concat(salt, iv, ciphertext) : concat(iv, ciphertext), salt, iv, ciphertext });
  } catch (error) {
    return err(messageFrom(error, 'Encryption failed.'));
  }
}

/** Explains a failed decrypt in terms of what the user can actually change. */
function decryptFailureMessage(mode: AesMode, key: KeyMaterial): string {
  const secret = key.kind === 'passphrase' ? 'passphrase' : 'key';
  const settings = key.kind === 'passphrase' ? 'mode, key size and iterations' : 'mode and IV';
  if (mode === 'AES-GCM') {
    return `Decryption failed — the authentication check did not pass. Either the ${secret} is wrong, the ${settings} differ from those used to encrypt, or the data was altered.`;
  }
  return `Decryption failed — the padding is invalid, which almost always means the ${secret} is wrong or the ${settings} differ from those used to encrypt.`;
}

export async function decryptPayload(
  bytes: Uint8Array<ArrayBuffer>,
  options: DecryptPayloadOptions
): Promise<ToolResult<Uint8Array<ArrayBuffer>>> {
  const { engine, mode, key } = options;
  if (bytes.length > MAX_FILE_BYTES) {
    return err('That is over 100 MB — too large to decrypt in one go in a browser tab.');
  }

  const ivBytes = ivLength(mode);
  let offset = 0;
  if (key.kind === 'passphrase') {
    const problem = validatePassphrase(key);
    if (problem) return err(problem);
    offset = SALT_BYTES;
  }

  let iv: Uint8Array<ArrayBuffer>;
  const suppliedIv = key.kind === 'raw' ? (options.ivHex ?? '').trim() : '';
  if (suppliedIv !== '') {
    const parsed = hexToBytes(suppliedIv);
    if (!parsed.ok) return err(`IV: ${parsed.error}`);
    if (parsed.value.length !== ivBytes) {
      return err(`IV is ${parsed.value.length} bytes — ${mode} needs exactly ${ivBytes} (${ivBytes * 2} hex digits).`);
    }
    iv = parsed.value;
  } else {
    iv = bytes.slice(offset, offset + ivBytes);
    offset += ivBytes;
  }

  const ciphertext = bytes.slice(offset);
  const header =
    (key.kind === 'passphrase' ? `a ${SALT_BYTES}-byte salt, ` : '') + (suppliedIv === '' ? `a ${ivBytes}-byte IV, ` : '');
  if (bytes.length < offset) {
    return err(`That input is too short — it should start with ${header}but is only ${bytes.length} bytes long.`);
  }
  if (mode === 'AES-GCM' && ciphertext.length < GCM_TAG_BYTES) {
    return err(
      `That input is too short for AES-GCM — after ${header}there must be at least a ${GCM_TAG_BYTES}-byte authentication tag.`
    );
  }
  if (mode === 'AES-CBC' && (ciphertext.length === 0 || ciphertext.length % AES_BLOCK_BYTES !== 0)) {
    return err(
      `AES-CBC ciphertext must be a non-empty multiple of 16 bytes, but this is ${ciphertext.length}. Check the mode, encoding and that nothing was cut off.`
    );
  }

  const keyBytes = await resolveKey(engine, key, bytes.slice(0, SALT_BYTES));
  if (!keyBytes.ok) return keyBytes;

  try {
    return ok(await engine.decrypt(mode, keyBytes.value, iv, ciphertext));
  } catch (error) {
    if (error instanceof AesDecryptError) return err(decryptFailureMessage(mode, key));
    return err(messageFrom(error, decryptFailureMessage(mode, key)));
  }
}

// ---------------------------------------------------------------------------
// Text-level API
// ---------------------------------------------------------------------------

export async function encryptText(plaintext: string, options: EncryptOptions): Promise<ToolResult<EncryptResult>> {
  if (plaintext === '') return err('Nothing to encrypt — enter some text first.');
  const data = new TextEncoder().encode(plaintext);
  if (data.length > MAX_TEXT_BYTES) {
    return err('That text is over 10 MB — too large to paste comfortably. Use File mode instead.');
  }

  const payload = await encryptPayload(data, options);
  if (!payload.ok) return payload;
  const { bytes, salt, iv, ciphertext } = payload.value;
  return ok({
    combined: encodeBytes(bytes, options.encoding),
    saltHex: salt ? bytesToHex(salt) : null,
    ivHex: bytesToHex(iv),
    ciphertext: encodeBytes(ciphertext, options.encoding),
  });
}

export async function decryptText(input: string, options: DecryptOptions): Promise<ToolResult<string>> {
  const { mode } = options;
  if (input.trim() === '') return err('Nothing to decrypt — paste the ciphertext first.');

  const decoded = decodeBytes(input, options.encoding);
  if (!decoded.ok) return decoded;

  const plain = await decryptPayload(decoded.value, options);
  if (!plain.ok) return plain;

  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(plain.value));
  } catch {
    // AES-CTR has no integrity check, so a wrong key "succeeds" and yields random bytes —
    // invalid UTF-8 is the only signal we get.
    return err(
      mode === 'AES-CTR'
        ? 'Decrypted bytes are not valid text. AES-CTR has no integrity check, so this almost always means the key, passphrase or IV is wrong.'
        : 'Decryption succeeded, but the result is not valid UTF-8 text — the original was probably a binary file. Use File mode to decrypt it to a download.'
    );
  }
}
