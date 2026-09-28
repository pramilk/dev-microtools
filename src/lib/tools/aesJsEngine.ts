import { cbc, ctr, gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AesDecryptError, type AesEngine, type AesMode } from './aesEngine';

/**
 * Pure-JavaScript AES engine: no SubtleCrypto involved at any step.
 *
 * Built on @noble/ciphers and @noble/hashes (MIT, zero dependencies, independently
 * audited) rather than a hand-rolled AES — getting constant-time table lookups and GHASH
 * right is exactly the kind of thing that should not be reimplemented per project.
 *
 * Only ever reached through the dynamic `import()` in `aes.ts#loadAesEngine`, so the
 * libraries are downloaded solely by visitors who pick the pure-JS engine.
 */

const cipherFor = (mode: AesMode, key: Uint8Array, iv: Uint8Array) => {
  if (mode === 'AES-GCM') return gcm(key, iv);
  if (mode === 'AES-CBC') return cbc(key, iv); // PKCS#7 padding by default, like SubtleCrypto
  return ctr(key, iv); // full 128-bit big-endian counter, like the Web Crypto engine
};

/** Copies into a fresh ArrayBuffer-backed array so the result satisfies `BufferSource`. */
const own = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export const jsEngine: AesEngine = {
  async encrypt(mode, key, iv, plaintext) {
    return own(cipherFor(mode, key, iv).encrypt(plaintext));
  },

  async decrypt(mode, key, iv, ciphertext) {
    try {
      return own(cipherFor(mode, key, iv).decrypt(ciphertext));
    } catch (error) {
      // Lengths are validated before this is called, so what remains is noble's
      // "invalid tag" (GCM) or "invalid padding" (CBC) — both mean wrong key or altered data.
      if (error instanceof Error) throw new AesDecryptError();
      throw error;
    }
  },

  async pbkdf2Sha256(passphrase, salt, iterations, lengthBytes) {
    // The async variant yields to the event loop periodically, so 600,000 iterations in
    // plain JavaScript keeps the page responsive instead of freezing it for a few seconds.
    return own(
      await pbkdf2Async(sha256, new TextEncoder().encode(passphrase), salt, { c: iterations, dkLen: lengthBytes })
    );
  },
};
