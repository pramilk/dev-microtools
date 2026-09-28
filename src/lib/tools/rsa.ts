import { type ToolResult, ok, err, messageFrom } from './result';
import { MAX_TEXT_BYTES, base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, type CipherEncoding } from './aes';
import { AesDecryptError, webCryptoEngine } from './aesEngine';

export type { CipherEncoding } from './aes';

/**
 * Asymmetric (public-key) encryption with RSA-OAEP, on the browser's native Web Crypto.
 * Anyone holding the public key can encrypt; only the matching private key decrypts.
 *
 * Two schemes:
 *   - `oaep`:   plain RSA-OAEP. The ciphertext is exactly one modulus long (256 bytes for a
 *               2048-bit key) and interoperates directly with OpenSSL, Node, Java, .NET,
 *               Go and Python. Limited to short messages — see `maxOaepPlaintextBytes`.
 *   - `hybrid`: RSA-OAEP wraps a fresh random AES-256 key, and AES-256-GCM encrypts the
 *               message. Any length. Layout:
 *                 wrapped AES key (modulus length) | IV (12) | ciphertext + 16-byte tag
 *
 * Keys are read from PEM (SPKI / PKCS#8, plus OpenSSL's traditional PKCS#1 "RSA PUBLIC
 * KEY" / "RSA PRIVATE KEY"), or from a JWK. Nothing is ever transmitted.
 */

export const RSA_KEY_SIZES = [2048, 3072, 4096] as const;
export type RsaKeySize = (typeof RSA_KEY_SIZES)[number];

/** SHA-1 is listed last: it's only here because it is OpenSSL's and Node's OAEP default. */
export const OAEP_HASHES = ['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1'] as const;
export type OaepHash = (typeof OAEP_HASHES)[number];

export const RSA_SCHEMES = ['oaep', 'hybrid'] as const;
export type RsaScheme = (typeof RSA_SCHEMES)[number];

export type KeyKind = 'public' | 'private';
/** Where the key came from, for display — `pkcs1` keys are re-wrapped before import. */
export type KeySourceFormat = 'spki' | 'pkcs8' | 'pkcs1' | 'jwk';

const HASH_BYTES: Record<OaepHash, number> = { 'SHA-1': 20, 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 };

const HYBRID_AES_KEY_BYTES = 32;
const HYBRID_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Anything below this is factorable with serious but real resources; flagged, not refused. */
export const WEAK_MODULUS_BITS = 2048;

export const describeScheme = (scheme: RsaScheme, hash: OaepHash): string =>
  scheme === 'oaep' ? `RSA-OAEP (${hash})` : `RSA-OAEP (${hash}) + AES-256-GCM`;

/**
 * The longest message plain RSA-OAEP can encrypt: k − 2·hLen − 2 bytes (RFC 8017 §7.1.1),
 * where k is the modulus length in bytes and hLen the hash output length.
 */
export const maxOaepPlaintextBytes = (modulusBits: number, hash: OaepHash): number =>
  Math.max(0, Math.ceil(modulusBits / 8) - 2 * HASH_BYTES[hash] - 2);

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

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

const encodeBytes = (bytes: Uint8Array, encoding: CipherEncoding): string =>
  encoding === 'hex' ? bytesToHex(bytes) : bytesToBase64(bytes);

const decodeBytes = (text: string, encoding: CipherEncoding): ToolResult<Uint8Array<ArrayBuffer>> =>
  encoding === 'hex' ? hexToBytes(text) : base64ToBytes(text);

const isNamedError = (error: unknown, name: string): boolean => error instanceof Error && error.name === name;

// ---------------------------------------------------------------------------
// PEM and DER
// ---------------------------------------------------------------------------

/** Wraps DER bytes as PEM with the conventional 64-character lines. */
export function toPem(label: string, der: Uint8Array): string {
  const lines = bytesToBase64(der).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

interface PemBlock {
  label: string;
  /** RFC 1421-style headers such as `Proc-Type: 4,ENCRYPTED`, which OpenSSL still emits. */
  headers: string[];
  der: Uint8Array<ArrayBuffer>;
}

function parsePem(text: string): ToolResult<PemBlock> | null {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END ([A-Z0-9 ]+)-----/.exec(text);
  if (!match) return null;
  const [, label = '', body = '', endLabel = ''] = match;
  if (label !== endLabel) {
    return err(`The PEM block starts with "BEGIN ${label}" but ends with "END ${endLabel}" — part of the key is missing.`);
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const headers = lines.filter((line) => line.includes(':'));
  const der = base64ToBytes(lines.filter((line) => !line.includes(':')).join(''));
  if (!der.ok || der.value.length === 0) {
    return err('The text between the BEGIN and END lines is not valid Base64 — the key looks damaged or truncated.');
  }
  return ok({ label, headers, der: der.value });
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 | bytes.length, ...bytes];
}

const derWrap = (tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> =>
  concat(new Uint8Array([tag, ...derLength(content.length)]), content);

/** AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }. */
const RSA_ALGORITHM_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

/** PKCS#1 RSAPublicKey → SubjectPublicKeyInfo, which is what Web Crypto imports. */
export const pkcs1PublicToSpki = (pkcs1: Uint8Array): Uint8Array<ArrayBuffer> =>
  derWrap(0x30, concat(RSA_ALGORITHM_ID, derWrap(0x03, concat(new Uint8Array([0]), pkcs1))));

/** PKCS#1 RSAPrivateKey → PKCS#8 PrivateKeyInfo, which is what Web Crypto imports. */
export const pkcs1PrivateToPkcs8 = (pkcs1: Uint8Array): Uint8Array<ArrayBuffer> =>
  derWrap(0x30, concat(new Uint8Array([0x02, 0x01, 0x00]), RSA_ALGORITHM_ID, derWrap(0x04, pkcs1)));

// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

export type ParsedKey =
  | { kind: KeyKind; source: Exclude<KeySourceFormat, 'jwk'>; format: 'spki' | 'pkcs8'; der: Uint8Array<ArrayBuffer> }
  | { kind: KeyKind; source: 'jwk'; format: 'jwk'; jwk: JsonWebKey };

function parseJwk(text: string): ToolResult<ParsedKey> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return err(`That looks like a JWK, but it is not valid JSON (${messageFrom(error, 'parse error')}).`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err('That JSON is not a JWK — expected an object with "kty", "n" and "e".');
  }
  const jwk = value as JsonWebKey & { keys?: unknown };
  if (Array.isArray(jwk.keys)) {
    return err('That is a JWK Set ({"keys": [...]}). Paste just one key object from inside the "keys" array.');
  }
  if (jwk.kty !== 'RSA') {
    return err(
      `That JWK is a "${String(jwk.kty)}" key, not RSA. Only RSA keys can encrypt directly — EC and OKP keys are for signing and key agreement.`
    );
  }
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    return err('That RSA JWK is missing its "n" (modulus) or "e" (exponent) field.');
  }
  // `alg`, `key_ops`, `use` and `ext` constrain how Web Crypto may import the key; a JWK
  // exported for RSA-OAEP-256 would otherwise refuse the SHA-1 setting, or vice versa.
  const { alg: _alg, key_ops: _ops, use: _use, ext: _ext, ...material } = jwk;
  return ok({ kind: typeof jwk.d === 'string' ? 'private' : 'public', source: 'jwk', format: 'jwk', jwk: material });
}

/**
 * Reads a pasted key and says what it is, without importing it. Everything that is
 * recognisably *not* a usable RSA key gets a message saying how to convert it.
 */
export function parseKey(text: string): ToolResult<ParsedKey> {
  const trimmed = text.trim();
  if (trimmed === '') return err('Paste a key, or click "Generate key pair" to create one.');
  if (trimmed.startsWith('{')) return parseJwk(trimmed);
  if (/^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-)/.test(trimmed)) {
    return err(
      'That is an OpenSSH public key. Convert it to PEM first: ssh-keygen -e -m PKCS8 -f id_rsa.pub (only ssh-rsa keys can encrypt).'
    );
  }

  const pem = parsePem(trimmed);
  if (pem === null) {
    return err(
      'That is not a key this tool recognises. Paste it in PEM format, including the "-----BEGIN … KEY-----" and "-----END … KEY-----" lines, or as a JWK (JSON).'
    );
  }
  if (!pem.ok) return pem;
  const { label, headers, der } = pem.value;

  switch (label) {
    case 'PUBLIC KEY':
      return ok({ kind: 'public', source: 'spki', format: 'spki', der });
    case 'PRIVATE KEY':
      return ok({ kind: 'private', source: 'pkcs8', format: 'pkcs8', der });
    case 'RSA PUBLIC KEY':
      return ok({ kind: 'public', source: 'pkcs1', format: 'spki', der: pkcs1PublicToSpki(der) });
    case 'RSA PRIVATE KEY':
      if (headers.some((header) => /ENCRYPTED/i.test(header))) {
        return err(
          'That private key is protected with a passphrase. Remove it first: openssl rsa -in key.pem -out key-plain.pem'
        );
      }
      return ok({ kind: 'private', source: 'pkcs1', format: 'pkcs8', der: pkcs1PrivateToPkcs8(der) });
    case 'ENCRYPTED PRIVATE KEY':
      return err(
        'That private key is protected with a passphrase. Remove it first: openssl pkey -in key.pem -out key-plain.pem'
      );
    case 'OPENSSH PRIVATE KEY':
      return err(
        'That is an OpenSSH-format private key. Convert a copy to PKCS#8 PEM first: ssh-keygen -p -m PKCS8 -f copy_of_id_rsa'
      );
    case 'CERTIFICATE':
      return err(
        'That is an X.509 certificate, not a key. Extract its public key first: openssl x509 -pubkey -noout -in cert.pem'
      );
    case 'EC PRIVATE KEY':
    case 'EC PARAMETERS':
    case 'DSA PRIVATE KEY':
      return err('That is not an RSA key. Only RSA keys can encrypt directly — EC and DSA keys are for signing.');
    default:
      return err(`"${label}" is not a key type this tool can use. Paste an RSA public or private key.`);
  }
}

// ---------------------------------------------------------------------------
// Importing keys
// ---------------------------------------------------------------------------

function checkWebCrypto(): string | null {
  return typeof crypto === 'undefined' || !crypto.subtle
    ? 'This browser does not expose Web Crypto here — it needs a secure (https://) page.'
    : null;
}

const oaepParams = (hash: OaepHash): RsaHashedImportParams => ({ name: 'RSA-OAEP', hash });

function importFailureMessage(parsed: ParsedKey, error: unknown): string {
  if (isNamedError(error, 'DataError') || isNamedError(error, 'NotSupportedError')) {
    return parsed.format === 'jwk'
      ? 'That JWK could not be loaded as an RSA key — one of its fields is malformed.'
      : `That ${parsed.kind} key could not be loaded as an RSA key. It may be a different key type (EC or Ed25519 keys cannot encrypt), or the PEM may be damaged.`;
  }
  return messageFrom(error, 'That key could not be loaded.');
}

async function importParsed(parsed: ParsedKey, hash: OaepHash, extractable: boolean): Promise<ToolResult<CryptoKey>> {
  const usages: KeyUsage[] = [parsed.kind === 'public' ? 'encrypt' : 'decrypt'];
  try {
    const key =
      parsed.format === 'jwk'
        ? await crypto.subtle.importKey('jwk', parsed.jwk, oaepParams(hash), extractable, usages)
        : await crypto.subtle.importKey(parsed.format, parsed.der, oaepParams(hash), extractable, usages);
    return ok(key);
  } catch (error) {
    return err(importFailureMessage(parsed, error));
  }
}

/** A private key contains its public half (n, e); pulled out via JWK so it can encrypt. */
async function publicFromPrivate(privateKey: CryptoKey, hash: OaepHash): Promise<ToolResult<CryptoKey>> {
  try {
    const { kty, n, e } = await crypto.subtle.exportKey('jwk', privateKey);
    return ok(await crypto.subtle.importKey('jwk', { kty, n, e }, oaepParams(hash), false, ['encrypt']));
  } catch (error) {
    return err(messageFrom(error, 'Could not derive the public key from that private key.'));
  }
}

const modulusBitsOf = (key: CryptoKey): number => (key.algorithm as RsaHashedKeyAlgorithm).modulusLength;

export interface KeyInfo {
  kind: KeyKind;
  source: KeySourceFormat;
  modulusBits: number;
}

/** Parses and imports a key just far enough to describe it: public/private, format, size. */
export async function inspectKey(text: string): Promise<ToolResult<KeyInfo>> {
  const unavailable = checkWebCrypto();
  if (unavailable) return err(unavailable);
  const parsed = parseKey(text);
  if (!parsed.ok) return parsed;
  const key = await importParsed(parsed.value, 'SHA-256', false);
  if (!key.ok) return key;
  return ok({ kind: parsed.value.kind, source: parsed.value.source, modulusBits: modulusBitsOf(key.value) });
}

/** Human-readable name of a key's encoding, e.g. "PKCS#8 PEM". */
export const describeKeySource = (source: KeySourceFormat): string =>
  ({ spki: 'SPKI PEM', pkcs8: 'PKCS#8 PEM', pkcs1: 'PKCS#1 PEM', jwk: 'JWK' })[source];

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export interface GeneratedKeyPair {
  /** SubjectPublicKeyInfo, "-----BEGIN PUBLIC KEY-----" — what OpenSSL and most libraries expect. */
  publicPem: string;
  /** PKCS#8, "-----BEGIN PRIVATE KEY-----", unencrypted. */
  privatePem: string;
  modulusBits: RsaKeySize;
}

export async function generateRsaKeyPair(modulusBits: RsaKeySize): Promise<ToolResult<GeneratedKeyPair>> {
  const unavailable = checkWebCrypto();
  if (unavailable) return err(unavailable);
  try {
    // The hash is bound to the CryptoKey object only; SPKI/PKCS#8 exports don't record it,
    // so this pair works with every OAEP hash.
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: modulusBits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt']
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    return ok({ publicPem: toPem('PUBLIC KEY', spki), privatePem: toPem('PRIVATE KEY', pkcs8), modulusBits });
  } catch (error) {
    return err(messageFrom(error, 'Could not generate a key pair in this browser.'));
  }
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

export interface RsaOptions {
  /** PEM or JWK text. Encrypting accepts a private key too (its public half is used). */
  key: string;
  hash: OaepHash;
  scheme: RsaScheme;
  encoding: CipherEncoding;
}

export interface RsaEncryptResult {
  ciphertext: string;
  modulusBits: number;
  /** True when a private key was pasted and its public half did the encrypting. */
  usedPrivateKey: boolean;
}

export async function rsaEncryptText(plaintext: string, options: RsaOptions): Promise<ToolResult<RsaEncryptResult>> {
  const { hash, scheme, encoding } = options;
  if (plaintext === '') return err('Nothing to encrypt — enter some text first.');
  const data = new TextEncoder().encode(plaintext);
  if (data.length > MAX_TEXT_BYTES) return err('That text is over 10 MB — too large to encrypt in a browser tab.');

  const unavailable = checkWebCrypto();
  if (unavailable) return err(unavailable);
  const parsed = parseKey(options.key);
  if (!parsed.ok) return parsed;
  const usedPrivateKey = parsed.value.kind === 'private';
  const imported = await importParsed(parsed.value, hash, usedPrivateKey);
  if (!imported.ok) return imported;
  const publicKey = usedPrivateKey ? await publicFromPrivate(imported.value, hash) : imported;
  if (!publicKey.ok) return publicKey;

  const modulusBits = modulusBitsOf(publicKey.value);
  const algorithm: RsaOaepParams = { name: 'RSA-OAEP' };

  try {
    if (scheme === 'oaep') {
      const max = maxOaepPlaintextBytes(modulusBits, hash);
      if (data.length > max) {
        return err(
          `That text is ${data.length.toLocaleString('en-US')} bytes, but RSA-OAEP with a ${modulusBits}-bit key and ${hash} can encrypt at most ${max} bytes. Switch Scheme to "Hybrid" to encrypt any length, or shorten the text.`
        );
      }
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt(algorithm, publicKey.value, data));
      return ok({ ciphertext: encodeBytes(ciphertext, encoding), modulusBits, usedPrivateKey });
    }

    const aesKey = randomBytes(HYBRID_AES_KEY_BYTES);
    const iv = randomBytes(HYBRID_IV_BYTES);
    const wrappedKey = new Uint8Array(await crypto.subtle.encrypt(algorithm, publicKey.value, aesKey));
    const body = await webCryptoEngine.encrypt('AES-GCM', aesKey, iv, data);
    return ok({ ciphertext: encodeBytes(concat(wrappedKey, iv, body), encoding), modulusBits, usedPrivateKey });
  } catch (error) {
    return err(messageFrom(error, 'Encryption failed.'));
  }
}

const wrongKeyMessage = (hash: OaepHash): string =>
  `Decryption failed. Either this private key doesn't match the public key the message was encrypted with, the OAEP hash differs (this is set to ${hash} — try the others, OpenSSL and Node default to SHA-1), or the ciphertext was altered.`;

export async function rsaDecryptText(input: string, options: RsaOptions): Promise<ToolResult<string>> {
  const { hash, scheme, encoding } = options;
  if (input.trim() === '') return err('Nothing to decrypt — paste the ciphertext first.');
  const decoded = decodeBytes(input, encoding);
  if (!decoded.ok) return decoded;
  const bytes = decoded.value;

  const unavailable = checkWebCrypto();
  if (unavailable) return err(unavailable);
  const parsed = parseKey(options.key);
  if (!parsed.ok) return parsed;
  if (parsed.value.kind === 'public') {
    return err('That is a public key. Decrypting needs the matching private key — a public key can only encrypt.');
  }
  const privateKey = await importParsed(parsed.value, hash, false);
  if (!privateKey.ok) return privateKey;

  const modulusBits = modulusBitsOf(privateKey.value);
  const blockBytes = Math.ceil(modulusBits / 8);
  const algorithm: RsaOaepParams = { name: 'RSA-OAEP' };

  let plain: Uint8Array<ArrayBuffer>;
  if (scheme === 'oaep') {
    if (bytes.length !== blockBytes) {
      return err(
        `RSA-OAEP ciphertext for a ${modulusBits}-bit key is always exactly ${blockBytes} bytes, but this is ${bytes.length}.` +
          (bytes.length > blockBytes
            ? ' It may have been made with the Hybrid scheme — try switching Scheme to "Hybrid".'
            : ' Check the encoding and that nothing was cut off.')
      );
    }
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt(algorithm, privateKey.value, bytes));
    } catch (error) {
      if (isNamedError(error, 'OperationError')) return err(wrongKeyMessage(hash));
      return err(messageFrom(error, wrongKeyMessage(hash)));
    }
  } else {
    const minimum = blockBytes + HYBRID_IV_BYTES + GCM_TAG_BYTES;
    if (bytes.length < minimum) {
      return err(
        `That is too short for Hybrid ciphertext from a ${modulusBits}-bit key — it needs at least ${minimum} bytes (${blockBytes}-byte wrapped key, ${HYBRID_IV_BYTES}-byte IV, ${GCM_TAG_BYTES}-byte tag), but is ${bytes.length}.` +
          (bytes.length === blockBytes ? ' It is exactly one RSA block, so try switching Scheme to "RSA-OAEP".' : '')
      );
    }
    let aesKey: Uint8Array<ArrayBuffer>;
    try {
      aesKey = new Uint8Array(await crypto.subtle.decrypt(algorithm, privateKey.value, bytes.slice(0, blockBytes)));
    } catch (error) {
      if (isNamedError(error, 'OperationError')) return err(wrongKeyMessage(hash));
      return err(messageFrom(error, wrongKeyMessage(hash)));
    }
    if (aesKey.length !== 16 && aesKey.length !== HYBRID_AES_KEY_BYTES) {
      return err(
        `The RSA part decrypted to ${aesKey.length} bytes, which is not an AES key — this was probably encrypted with plain RSA-OAEP. Switch Scheme to "RSA-OAEP".`
      );
    }
    const iv = bytes.slice(blockBytes, blockBytes + HYBRID_IV_BYTES);
    try {
      plain = await webCryptoEngine.decrypt('AES-GCM', aesKey, iv, bytes.slice(blockBytes + HYBRID_IV_BYTES));
    } catch (error) {
      if (error instanceof AesDecryptError) {
        return err('The key unlocked, but the AES-GCM part failed its authentication check — the ciphertext was altered or cut off.');
      }
      return err(messageFrom(error, 'Decryption failed.'));
    }
  }

  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    // Not an error in the decryption itself: the bytes were valid, they just aren't text.
    return err('Decryption succeeded, but the result is not valid UTF-8 text — the original was probably binary data.');
  }
}
