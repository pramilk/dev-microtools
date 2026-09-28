/**
 * The raw AES + PBKDF2 primitives the AES tool needs, behind one small interface so the
 * text-level logic in `aes.ts` never cares which implementation is doing the work.
 *
 * Two implementations exist:
 *   - `webCryptoEngine` (here): the browser's native SubtleCrypto. Fast, zero bytes of
 *     JavaScript to download, and the default.
 *   - `jsEngine` (`aesJsEngine.ts`): pure JavaScript via the audited @noble/ciphers and
 *     @noble/hashes libraries — for visitors who want the computation to happen in code
 *     they can read, or runtimes without SubtleCrypto. Loaded with a dynamic `import()`
 *     only when selected, so nobody else pays for it.
 *
 * Both produce byte-identical output for the same key, IV and plaintext (asserted by
 * aes.test.ts), so ciphertext from one always decrypts with the other.
 */

export const AES_MODES = ['AES-GCM', 'AES-CBC', 'AES-CTR'] as const;
export type AesMode = (typeof AES_MODES)[number];

export interface AesEngine {
  /** For GCM the 16-byte tag is appended; CBC applies PKCS#7 padding. */
  encrypt(
    mode: AesMode,
    key: Uint8Array<ArrayBuffer>,
    iv: Uint8Array<ArrayBuffer>,
    plaintext: Uint8Array<ArrayBuffer>
  ): Promise<Uint8Array<ArrayBuffer>>;
  /** Throws `AesDecryptError` when the tag doesn't verify (GCM) or the padding is invalid (CBC). */
  decrypt(
    mode: AesMode,
    key: Uint8Array<ArrayBuffer>,
    iv: Uint8Array<ArrayBuffer>,
    ciphertext: Uint8Array<ArrayBuffer>
  ): Promise<Uint8Array<ArrayBuffer>>;
  /** PBKDF2-HMAC-SHA-256, returning `lengthBytes` of derived key material. */
  pbkdf2Sha256(
    passphrase: string,
    salt: Uint8Array<ArrayBuffer>,
    iterations: number,
    lengthBytes: number
  ): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * The one failure both engines report the same way: the key/IV is wrong or the data was
 * altered. Each engine's own error for this (SubtleCrypto's opaque OperationError,
 * noble's "invalid tag"/"invalid padding") is normalised to this class so the caller can
 * give a single, useful explanation.
 */
export class AesDecryptError extends Error {
  constructor() {
    super('AES decryption failed: authentication or padding check did not pass.');
    this.name = 'AesDecryptError';
  }
}

const webCryptoParams = (
  mode: AesMode,
  iv: Uint8Array<ArrayBuffer>
): AesGcmParams | AesCbcParams | AesCtrParams =>
  // A full 128-bit counter matches OpenSSL, Node's createCipheriv and @noble/ciphers.
  mode === 'AES-CTR' ? { name: mode, counter: iv, length: 128 } : { name: mode, iv };

const importAesKey = (bytes: Uint8Array<ArrayBuffer>, mode: AesMode, usage: KeyUsage) =>
  crypto.subtle.importKey('raw', bytes, { name: mode }, false, [usage]);

export const webCryptoEngine: AesEngine = {
  async encrypt(mode, key, iv, plaintext) {
    const cryptoKey = await importAesKey(key, mode, 'encrypt');
    return new Uint8Array(await crypto.subtle.encrypt(webCryptoParams(mode, iv), cryptoKey, plaintext));
  },

  async decrypt(mode, key, iv, ciphertext) {
    const cryptoKey = await importAesKey(key, mode, 'decrypt');
    try {
      return new Uint8Array(await crypto.subtle.decrypt(webCryptoParams(mode, iv), cryptoKey, ciphertext));
    } catch (error) {
      // SubtleCrypto reports every wrong-key / tampered-data case as an opaque
      // OperationError. Checked by name, not `instanceof DOMException`, since test
      // runners and some runtimes expose more than one DOMException constructor.
      if (error instanceof Error && error.name === 'OperationError') throw new AesDecryptError();
      throw error;
    }
  },

  async pbkdf2Sha256(passphrase, salt, iterations, lengthBytes) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      lengthBytes * 8
    );
    return new Uint8Array(bits);
  },
};
