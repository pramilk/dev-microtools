import { cbc, ecb } from '@noble/ciphers/aes.js';
import { md5 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { MAX_PASSWORD_BYTES, type PdfEncryption } from './pdfProtect';

export type { PdfEncryption };

/**
 * The PDF "Standard security handler" (ISO 32000-1 §7.6 and ISO 32000-2 §7.6), writing side:
 * given passwords and permissions it derives the `/Encrypt` dictionary values and hands back
 * a function that encrypts one object's strings or stream bytes.
 *
 * Pure byte-in/byte-out — no pdf-lib, no DOM — so it is unit-tested against the spec's
 * algorithms and can be reused by a future Unlock PDF. Two revisions are supported:
 *  - R6 / AES-256 (PDF 2.0, Acrobat X+) — the default; a random 256-bit file key wrapped
 *    separately by the user and owner passwords with the iterated "2.B" hash.
 *  - R4 / AES-128 (PDF 1.6, Acrobat 7+) — for older readers; MD5-derived keys and RC4 only to
 *    compute the O/U check values (the data itself is AES).
 * RC4 *data* encryption (40/128-bit) is deliberately not offered: it is broken.
 */

const NO_PADDING = { disablePadding: true } as const;
const ZERO_IV = new Uint8Array(16);
const EMPTY = new Uint8Array(0);

/** The 32-byte padding string from the spec (Algorithm 2, step a). */
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe,
  0x64, 0x53, 0x69, 0x7a,
]);

const SALT_SUFFIX = new TextEncoder().encode('sAlT');

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

const int32LE = (value: number): Uint8Array => Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);

// ------------------------------------------------------------------ password encoding

/**
 * A password as the handler hashes it. R6 takes UTF-8 (NFKC-normalised, the part of SASLprep
 * that matters for real passwords); R4 takes single-byte characters, so anything above U+00FF
 * has no encoding and callers must reject it first (`passwordProblem` in pdfProtect.ts).
 */
export function encodePassword(password: string, encryption: PdfEncryption): Uint8Array {
  if (encryption === 'aes256') return new TextEncoder().encode(password.normalize('NFKC')).subarray(0, MAX_PASSWORD_BYTES.aes256);
  const bytes = Uint8Array.from(Array.from(password, (char) => char.charCodeAt(0) & 0xff));
  return bytes.subarray(0, MAX_PASSWORD_BYTES.aes128);
}

// ------------------------------------------------------------------ R6 (AES-256)

/** ISO 32000-2 Algorithm 2.B — the iterated SHA-2/AES hash that makes R6 passwords costly to guess. */
export function hashR6(password: Uint8Array, salt: Uint8Array, userKey: Uint8Array): Uint8Array {
  let k = sha256(concatBytes(password, salt, userKey));
  for (let round = 1; ; round += 1) {
    const unit = concatBytes(password, k, userKey);
    const k1 = new Uint8Array(unit.length * 64);
    for (let i = 0; i < 64; i += 1) k1.set(unit, i * unit.length);
    const e = cbc(k.subarray(0, 16), k.subarray(16, 32), NO_PADDING).encrypt(k1);
    // The first 16 bytes read as a big-endian number, mod 3. 256 ≡ 1 (mod 3), so that is just
    // the byte sum mod 3.
    let sum = 0;
    for (let i = 0; i < 16; i += 1) sum += e[i] as number;
    const hash = [sha256, sha384, sha512][sum % 3] as typeof sha256;
    k = hash(e);
    if (round >= 64 && (e[e.length - 1] as number) <= round - 32) break;
  }
  return k.subarray(0, 32);
}

// ------------------------------------------------------------------ R4 (AES-128)

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (state[i] as number) + (key[i % key.length] as number)) & 0xff;
    [state[i], state[j]] = [state[j] as number, state[i] as number];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let n = 0; n < data.length; n += 1) {
    a = (a + 1) & 0xff;
    b = (b + (state[a] as number)) & 0xff;
    [state[a], state[b]] = [state[b] as number, state[a] as number];
    out[n] = (data[n] as number) ^ (state[((state[a] as number) + (state[b] as number)) & 0xff] as number);
  }
  return out;
}

const padPassword = (password: Uint8Array): Uint8Array => concatBytes(password, PASSWORD_PADDING).subarray(0, 32);

/** The 19 extra RC4 passes of Algorithms 3 and 5, each keyed with the base key XOR the pass number. */
function rc4Passes(key: Uint8Array, data: Uint8Array): Uint8Array {
  let out = data;
  for (let pass = 1; pass <= 19; pass += 1) out = rc4(key.map((byte) => byte ^ pass), out);
  return out;
}

function ownerEntryR4(ownerPassword: Uint8Array, userPassword: Uint8Array): Uint8Array {
  let digest = md5(padPassword(ownerPassword));
  for (let i = 0; i < 50; i += 1) digest = md5(digest);
  const key = digest.subarray(0, 16);
  return rc4Passes(key, rc4(key, padPassword(userPassword)));
}

function fileKeyR234(
  userPassword: Uint8Array,
  ownerEntry: Uint8Array,
  permissions: number,
  id0: Uint8Array,
  revision: number,
  keyBytes: number,
  encryptMetadata: boolean
): Uint8Array {
  const parts = [padPassword(userPassword), ownerEntry.subarray(0, 32), int32LE(permissions), id0];
  if (revision >= 4 && !encryptMetadata) parts.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff));
  let digest = md5(concatBytes(...parts));
  if (revision >= 3) for (let i = 0; i < 50; i += 1) digest = md5(digest.subarray(0, keyBytes));
  return digest.subarray(0, keyBytes);
}

function userEntryR4(fileKey: Uint8Array, id0: Uint8Array): Uint8Array {
  const seed = md5(concatBytes(PASSWORD_PADDING, id0));
  // 16 bytes of check value, then 16 arbitrary bytes the spec leaves free.
  return concatBytes(rc4Passes(fileKey, rc4(fileKey, seed)), randomBytes(16));
}

// ------------------------------------------------------------------ the handler

export interface SecurityParams {
  encryption: PdfEncryption;
  userPassword: Uint8Array;
  ownerPassword: Uint8Array;
  /** The signed 32-bit /P value (see `permissionFlags`). */
  permissions: number;
  /** First element of the trailer /ID — part of the R4 key; unused by R6. */
  id0: Uint8Array;
}

/** What goes into the /Encrypt dictionary. Byte fields are written as hex strings. */
export interface EncryptDictValues {
  version: 4 | 5;
  revision: 4 | 6;
  keyBits: 128 | 256;
  cryptFilterMethod: 'AESV2' | 'AESV3';
  cryptFilterBytes: 16 | 32;
  owner: Uint8Array;
  user: Uint8Array;
  ownerKey?: Uint8Array;
  userKey?: Uint8Array;
  permsBlock?: Uint8Array;
  permissions: number;
}

export interface SecurityHandler {
  dict: EncryptDictValues;
  /** Encrypts the strings or stream bytes of the indirect object numbered `objectNumber`. */
  encryptorFor(objectNumber: number, generation: number): (data: Uint8Array) => Uint8Array;
}

/** AES-CBC with a fresh random IV prepended and PKCS#7 padding — how PDF stores every encrypted string and stream. */
function aesWithIv(key: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = randomBytes(16);
  return concatBytes(iv, cbc(key, iv).encrypt(data));
}

export function createSecurityHandler(params: SecurityParams): SecurityHandler {
  const { userPassword, ownerPassword, permissions, id0 } = params;

  if (params.encryption === 'aes256') {
    const fileKey = randomBytes(32);
    const userValidation = randomBytes(8);
    const userKeySalt = randomBytes(8);
    const user = concatBytes(hashR6(userPassword, userValidation, EMPTY), userValidation, userKeySalt);
    const userKey = cbc(hashR6(userPassword, userKeySalt, EMPTY), ZERO_IV, NO_PADDING).encrypt(fileKey);

    const ownerValidation = randomBytes(8);
    const ownerKeySalt = randomBytes(8);
    // The owner entries are bound to the 48-byte /U, so a /U swapped in from another file fails.
    const owner = concatBytes(hashR6(ownerPassword, ownerValidation, user), ownerValidation, ownerKeySalt);
    const ownerKey = cbc(hashR6(ownerPassword, ownerKeySalt, user), ZERO_IV, NO_PADDING).encrypt(fileKey);

    // /Perms lets a reader detect a tampered /P: the permissions again (sign-extended to 64
    // bits), "T" for EncryptMetadata, the literal "adb", then 4 random bytes — AES-ECB under the file key.
    const permsPlain = concatBytes(int32LE(permissions), Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x54, 0x61, 0x64, 0x62]), randomBytes(4));
    const permsBlock = ecb(fileKey, NO_PADDING).encrypt(permsPlain);

    return {
      dict: { version: 5, revision: 6, keyBits: 256, cryptFilterMethod: 'AESV3', cryptFilterBytes: 32, owner, user, ownerKey, userKey, permsBlock, permissions },
      encryptorFor: () => (data) => aesWithIv(fileKey, data),
    };
  }

  const owner = ownerEntryR4(ownerPassword, userPassword);
  const fileKey = fileKeyR234(userPassword, owner, permissions, id0, 4, 16, true);
  const user = userEntryR4(fileKey, id0);
  return {
    dict: { version: 4, revision: 4, keyBits: 128, cryptFilterMethod: 'AESV2', cryptFilterBytes: 16, owner, user, permissions },
    encryptorFor(objectNumber, generation) {
      // Algorithm 1: a per-object key, so identical content in two objects never encrypts alike.
      const objectKey = md5(
        concatBytes(
          fileKey,
          Uint8Array.from([objectNumber & 0xff, (objectNumber >>> 8) & 0xff, (objectNumber >>> 16) & 0xff, generation & 0xff, (generation >>> 8) & 0xff]),
          SALT_SUFFIX
        )
      ).subarray(0, 16);
      return (data) => aesWithIv(objectKey, data);
    },
  };
}

// ------------------------------------------------------------------ reading (Unlock PDF)

/** How an object's strings or streams are enciphered, per the /Encrypt dictionary's crypt filters. */
export type CipherMethod = 'none' | 'rc4' | 'aesv2' | 'aesv3';

/** The /Encrypt dictionary of a Standard-handler file, as plain bytes and numbers. */
export interface StandardEncryptionParams {
  revision: 2 | 3 | 4 | 5 | 6;
  /** File-key length in bytes for R2-R4 (5 for R2, 16 for AES-128, 5-16 for RC4). Ignored by R5/R6. */
  keyBytes: number;
  owner: Uint8Array;
  user: Uint8Array;
  ownerKey?: Uint8Array;
  userKey?: Uint8Array;
  permissions: number;
  /** First element of the trailer /ID. */
  id0: Uint8Array;
  encryptMetadata: boolean;
}

export interface OpenedEncryption {
  /** Which password matched: the open password grants the permissions; the owner password everything. */
  role: 'user' | 'owner';
  fileKey: Uint8Array;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** R5 (Adobe's pre-ISO extension, now deprecated): the same layout as R6 with a single SHA-256 as the hash. */
function hashR5(password: Uint8Array, salt: Uint8Array, userKey: Uint8Array): Uint8Array {
  return sha256(concatBytes(password, salt, userKey));
}

/** Algorithms 6 and 4/5 check: the file key if `password` is the open password, else null. */
function tryUserPasswordR234(params: StandardEncryptionParams, password: Uint8Array): Uint8Array | null {
  const key = fileKeyR234(password, params.owner, params.permissions, params.id0, params.revision, params.keyBytes, params.encryptMetadata);
  if (params.revision === 2) return sameBytes(rc4(key, PASSWORD_PADDING), params.user.subarray(0, 32)) ? key : null;
  const check = rc4Passes(key, rc4(key, md5(concatBytes(PASSWORD_PADDING, params.id0))));
  return sameBytes(check, params.user.subarray(0, 16)) ? key : null;
}

/**
 * Tries `password` as the open password, then as the owner password, and returns the file key
 * with the role it matched — or null when it is neither. The empty string is a valid attempt:
 * many "protected" PDFs only restrict permissions and open with no password at all.
 */
export function openEncryption(params: StandardEncryptionParams, password: string): OpenedEncryption | null {
  if (params.revision >= 5) {
    const { user, owner, userKey, ownerKey } = params;
    if (!userKey || !ownerKey || user.length < 48 || owner.length < 48) return null;
    const pw = encodePassword(password, 'aes256');
    const hash = params.revision === 5 ? hashR5 : hashR6;
    const user48 = user.subarray(0, 48);
    if (sameBytes(hash(pw, user.subarray(32, 40), EMPTY), user.subarray(0, 32))) {
      return { role: 'user', fileKey: cbc(hash(pw, user.subarray(40, 48), EMPTY), ZERO_IV, NO_PADDING).decrypt(userKey) };
    }
    if (sameBytes(hash(pw, owner.subarray(32, 40), user48), owner.subarray(0, 32))) {
      return { role: 'owner', fileKey: cbc(hash(pw, owner.subarray(40, 48), user48), ZERO_IV, NO_PADDING).decrypt(ownerKey) };
    }
    return null;
  }

  if (params.user.length < 16 || params.owner.length < 32) return null;
  const pw = encodePassword(password, 'aes128');
  const asUser = tryUserPasswordR234(params, pw);
  if (asUser) return { role: 'user', fileKey: asUser };

  // Algorithm 7: an owner password unlocks /O back into the (padded) user password.
  let digest = md5(padPassword(pw));
  if (params.revision >= 3) for (let i = 0; i < 50; i += 1) digest = md5(digest);
  const key = digest.subarray(0, params.keyBytes);
  let recovered = params.owner.subarray(0, 32);
  if (params.revision === 2) recovered = rc4(key, recovered);
  else for (let pass = 19; pass >= 0; pass -= 1) recovered = rc4(key.map((byte) => byte ^ pass), recovered);
  const viaOwner = tryUserPasswordR234(params, recovered);
  return viaOwner ? { role: 'owner', fileKey: viaOwner } : null;
}

/** AES-CBC with the IV in the first 16 bytes and PKCS#7 padding — the inverse of `aesWithIv`. */
function aesWithoutIv(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length <= 16) return new Uint8Array(0);
  return cbc(key, data.subarray(0, 16)).decrypt(data.subarray(16));
}

/**
 * Builds the per-object decryptor for a cipher method. Throws on ciphertext that is not a
 * whole number of AES blocks or has invalid padding — the file is damaged or the key is wrong.
 */
export function createDecryptor(fileKey: Uint8Array, method: CipherMethod): (objectNumber: number, generation: number) => (data: Uint8Array) => Uint8Array {
  if (method === 'none') return () => (data) => data;
  if (method === 'aesv3') return () => (data) => aesWithoutIv(fileKey, data);
  return (objectNumber, generation) => {
    const parts = [
      fileKey,
      Uint8Array.of(objectNumber & 0xff, (objectNumber >>> 8) & 0xff, (objectNumber >>> 16) & 0xff, generation & 0xff, (generation >>> 8) & 0xff),
    ];
    if (method === 'aesv2') parts.push(SALT_SUFFIX);
    const objectKey = md5(concatBytes(...parts)).subarray(0, Math.min(fileKey.length + 5, 16));
    return method === 'rc4' ? (data) => rc4(objectKey, data) : (data) => aesWithoutIv(objectKey, data);
  };
}
