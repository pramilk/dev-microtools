import { describe, it, expect } from 'vitest';
import { cbc, ecb } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, createDecryptor, createSecurityHandler, encodePassword, hashR6, openEncryption, randomBytes, type StandardEncryptionParams } from './pdfCrypto';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const noPadding = { disablePadding: true } as const;
const ZERO_IV = new Uint8Array(16);
const EMPTY = new Uint8Array(0);

describe('encodePassword', () => {
  it('encodes AES-256 passwords as UTF-8', () => {
    expect([...encodePassword('abc', 'aes256')]).toEqual([0x61, 0x62, 0x63]);
    expect([...encodePassword('é', 'aes256')]).toEqual([0xc3, 0xa9]);
  });

  it('NFKC-normalises AES-256 passwords so composed and decomposed forms match', () => {
    expect([...encodePassword('é', 'aes256')]).toEqual([...encodePassword('é', 'aes256')]);
  });

  it('truncates AES-256 passwords at 127 bytes and AES-128 passwords at 32', () => {
    expect(encodePassword('a'.repeat(300), 'aes256')).toHaveLength(127);
    expect(encodePassword('a'.repeat(300), 'aes128')).toHaveLength(32);
  });

  it('encodes AES-128 passwords one byte per Latin-1 character', () => {
    expect([...encodePassword('é', 'aes128')]).toEqual([0xe9]);
  });

  it('encodes the empty password as no bytes', () => {
    expect(encodePassword('', 'aes256')).toHaveLength(0);
    expect(encodePassword('', 'aes128')).toHaveLength(0);
  });
});

describe('hashR6', () => {
  it('is deterministic, 32 bytes, and depends on every input', () => {
    const salt = bytes('saltsalt');
    const base = hashR6(bytes('secret'), salt, EMPTY);
    expect(base).toHaveLength(32);
    expect([...hashR6(bytes('secret'), salt, EMPTY)]).toEqual([...base]);
    expect([...hashR6(bytes('Secret'), salt, EMPTY)]).not.toEqual([...base]);
    expect([...hashR6(bytes('secret'), bytes('saltsal2'), EMPTY)]).not.toEqual([...base]);
    expect([...hashR6(bytes('secret'), salt, new Uint8Array(48))]).not.toEqual([...base]);
  });

  it('is more than a single SHA-256 (the iterated variant is what makes guessing costly)', () => {
    const salt = bytes('saltsalt');
    expect([...hashR6(bytes('secret'), salt, EMPTY)]).not.toEqual([...sha256(concatBytes(bytes('secret'), salt))]);
  });
});

describe('createSecurityHandler — AES-256 (R6)', () => {
  const permissions = -3904;
  const id0 = randomBytes(16);
  const make = (user: string, owner: string) =>
    createSecurityHandler({ encryption: 'aes256', userPassword: bytes(user), ownerPassword: bytes(owner), permissions, id0 });

  it('writes a spec-shaped /Encrypt dictionary', () => {
    const { dict } = make('user', 'owner');
    expect(dict).toMatchObject({ version: 5, revision: 6, keyBits: 256, cryptFilterMethod: 'AESV3', cryptFilterBytes: 32, permissions });
    expect(dict.user).toHaveLength(48);
    expect(dict.owner).toHaveLength(48);
    expect(dict.userKey).toHaveLength(32);
    expect(dict.ownerKey).toHaveLength(32);
    expect(dict.permsBlock).toHaveLength(16);
  });

  it('lets the user password validate and unwrap the file key (the reader-side algorithm)', () => {
    const handler = make('user', 'owner');
    const { user, userKey } = handler.dict;
    const validation = hashR6(bytes('user'), user.subarray(32, 40), EMPTY);
    expect([...validation]).toEqual([...user.subarray(0, 32)]);
    const wrongValidation = hashR6(bytes('nope'), user.subarray(32, 40), EMPTY);
    expect([...wrongValidation]).not.toEqual([...user.subarray(0, 32)]);

    const fileKey = cbc(hashR6(bytes('user'), user.subarray(40, 48), EMPTY), ZERO_IV, noPadding).decrypt(userKey as Uint8Array);
    const secret = bytes('hello PDF — ünïcode');
    const encrypted = handler.encryptorFor(7, 0)(secret);
    expect(encrypted.length).toBe(16 + 32); // IV + one padded-up block pair
    expect([...cbc(fileKey, encrypted.subarray(0, 16)).decrypt(encrypted.subarray(16))]).toEqual([...secret]);
  });

  it('lets the owner password validate and unwrap the same file key', () => {
    const handler = make('user', 'owner');
    const { user, owner, ownerKey, userKey } = handler.dict;
    expect([...hashR6(bytes('owner'), owner.subarray(32, 40), user)]).toEqual([...owner.subarray(0, 32)]);
    const viaOwner = cbc(hashR6(bytes('owner'), owner.subarray(40, 48), user), ZERO_IV, noPadding).decrypt(ownerKey as Uint8Array);
    const viaUser = cbc(hashR6(bytes('user'), user.subarray(40, 48), EMPTY), ZERO_IV, noPadding).decrypt(userKey as Uint8Array);
    expect([...viaOwner]).toEqual([...viaUser]);
  });

  it('stores /Perms so a reader can detect a tampered /P', () => {
    const handler = make('user', 'owner');
    const { user, userKey, permsBlock } = handler.dict;
    const fileKey = cbc(hashR6(bytes('user'), user.subarray(40, 48), EMPTY), ZERO_IV, noPadding).decrypt(userKey as Uint8Array);
    const plain = ecb(fileKey, noPadding).decrypt(permsBlock as Uint8Array);
    expect(new DataView(plain.buffer, plain.byteOffset).getInt32(0, true)).toBe(permissions);
    expect([...plain.subarray(4, 8)]).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(String.fromCharCode(...plain.subarray(8, 12))).toBe('Tadb');
  });

  it('supports the empty open password', () => {
    const { user } = make('', 'owner').dict;
    expect([...hashR6(EMPTY, user.subarray(32, 40), EMPTY)]).toEqual([...user.subarray(0, 32)]);
  });

  it('uses a fresh IV every time, so equal inputs never encrypt alike', () => {
    const handler = make('user', 'owner');
    const encrypt = handler.encryptorFor(1, 0);
    const data = bytes('same');
    expect([...encrypt(data)]).not.toEqual([...encrypt(data)]);
  });

  it('makes a different file key (and so different output) per document', () => {
    const a = make('user', 'owner');
    const b = make('user', 'owner');
    expect([...a.dict.userKey as Uint8Array]).not.toEqual([...b.dict.userKey as Uint8Array]);
  });

  it('encrypts empty and large payloads', () => {
    const encrypt = make('user', 'owner').encryptorFor(1, 0);
    expect(encrypt(new Uint8Array(0))).toHaveLength(32); // IV + one full padding block
    expect(encrypt(new Uint8Array(1_000_000))).toHaveLength(16 + 1_000_016);
  });
});

describe('createSecurityHandler — AES-128 (R4)', () => {
  const id0 = bytes('0123456789abcdef');
  const handler = createSecurityHandler({ encryption: 'aes128', userPassword: bytes('user'), ownerPassword: bytes('owner'), permissions: -3904, id0 });

  it('writes a spec-shaped /Encrypt dictionary', () => {
    expect(handler.dict).toMatchObject({ version: 4, revision: 4, keyBits: 128, cryptFilterMethod: 'AESV2', cryptFilterBytes: 16 });
    expect(handler.dict.owner).toHaveLength(32);
    expect(handler.dict.user).toHaveLength(32);
    expect(handler.dict.userKey).toBeUndefined();
  });

  it('derives a different key for each object number and generation', () => {
    // Same plaintext in two objects: even stripped of the random IV, the ciphertexts differ.
    const data = new Uint8Array(32);
    const a = handler.encryptorFor(5, 0)(data).subarray(16);
    const b = handler.encryptorFor(6, 0)(data).subarray(16);
    const c = handler.encryptorFor(5, 1)(data).subarray(16);
    expect([...a]).not.toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it('is deterministic for the O entry (no random input)', () => {
    const again = createSecurityHandler({ encryption: 'aes128', userPassword: bytes('user'), ownerPassword: bytes('owner'), permissions: -3904, id0 });
    expect([...again.dict.owner]).toEqual([...handler.dict.owner]);
  });

  it('changes the owner entry with either password', () => {
    const other = createSecurityHandler({ encryption: 'aes128', userPassword: bytes('user'), ownerPassword: bytes('other'), permissions: -3904, id0 });
    expect([...other.dict.owner]).not.toEqual([...handler.dict.owner]);
  });
});

describe('concatBytes / randomBytes', () => {
  it('concatenates in order and tolerates empty parts', () => {
    expect([...concatBytes(Uint8Array.of(1), EMPTY, Uint8Array.of(2, 3))]).toEqual([1, 2, 3]);
    expect(concatBytes()).toHaveLength(0);
  });

  it('returns the requested number of (non-constant) random bytes', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect([...randomBytes(16)]).not.toEqual([...randomBytes(16)]);
  });
});

describe('openEncryption (reader side, against the writer)', () => {
  const id0 = bytes('0123456789abcdef');
  const permissions = -3904;
  const paramsFor = (encryption: 'aes256' | 'aes128', user: string, owner: string): StandardEncryptionParams => {
    const { dict } = createSecurityHandler({ encryption, userPassword: encodePassword(user, encryption), ownerPassword: encodePassword(owner, encryption), permissions, id0 });
    return {
      revision: dict.revision,
      keyBytes: 16,
      owner: dict.owner,
      user: dict.user,
      ownerKey: dict.ownerKey,
      userKey: dict.userKey,
      permissions,
      id0,
      encryptMetadata: true,
    };
  };

  it.each(['aes256', 'aes128'] as const)('tells the open password from the permissions password (%s)', (encryption) => {
    const params = paramsFor(encryption, 'user-pw', 'owner-pw');
    expect(openEncryption(params, 'user-pw')?.role).toBe('user');
    expect(openEncryption(params, 'owner-pw')?.role).toBe('owner');
    expect(openEncryption(params, 'nope')).toBeNull();
    expect(openEncryption(params, '')).toBeNull();
    expect(openEncryption(params, 'user-pw ')).toBeNull();
  });

  it.each(['aes256', 'aes128'] as const)('recovers the same file key from either password (%s)', (encryption) => {
    const params = paramsFor(encryption, 'user-pw', 'owner-pw');
    const viaUser = openEncryption(params, 'user-pw')?.fileKey;
    const viaOwner = openEncryption(params, 'owner-pw')?.fileKey;
    expect(viaUser).toBeDefined();
    expect([...(viaOwner as Uint8Array)]).toEqual([...(viaUser as Uint8Array)]);
  });

  it.each(['aes256', 'aes128'] as const)('opens a file with an empty open password (%s)', (encryption) => {
    const params = paramsFor(encryption, '', 'owner-pw');
    expect(openEncryption(params, '')?.role).toBe('user');
    expect(openEncryption(params, 'owner-pw')?.role).toBe('owner');
  });

  it('decrypts what the writer encrypted, per object', () => {
    for (const encryption of ['aes256', 'aes128'] as const) {
      const handler = createSecurityHandler({ encryption, userPassword: encodePassword('u', encryption), ownerPassword: encodePassword('o', encryption), permissions, id0 });
      const params = paramsFor(encryption, 'u', 'o');
      // A fresh handler has a fresh key, so open this handler's own entries instead.
      const opened = openEncryption({ ...params, owner: handler.dict.owner, user: handler.dict.user, ownerKey: handler.dict.ownerKey, userKey: handler.dict.userKey }, 'u');
      expect(opened).not.toBeNull();
      const decrypt = createDecryptor((opened as { fileKey: Uint8Array }).fileKey, encryption === 'aes256' ? 'aesv3' : 'aesv2');
      const secret = bytes('round trip — ünïcode');
      expect([...decrypt(12, 0)(handler.encryptorFor(12, 0)(secret))]).toEqual([...secret]);
    }
  });

  it('rejects malformed entries instead of throwing', () => {
    const params = paramsFor('aes256', 'u', 'o');
    expect(openEncryption({ ...params, user: new Uint8Array(10) }, 'u')).toBeNull();
    expect(openEncryption({ ...params, userKey: undefined }, 'u')).toBeNull();
    const legacy = paramsFor('aes128', 'u', 'o');
    expect(openEncryption({ ...legacy, user: new Uint8Array(4) }, 'u')).toBeNull();
  });
});

describe('createDecryptor', () => {
  const key = randomBytes(16);

  it('passes data through untouched for the Identity method', () => {
    const data = bytes('plain');
    expect([...createDecryptor(key, 'none')(1, 0)(data)]).toEqual([...data]);
  });

  it('returns nothing for AES data too short to hold a block after the IV', () => {
    expect(createDecryptor(key, 'aesv2')(1, 0)(new Uint8Array(0))).toHaveLength(0);
    expect(createDecryptor(key, 'aesv3')(1, 0)(new Uint8Array(16))).toHaveLength(0);
  });

  it('throws on AES data that is not whole blocks, rather than returning garbage', () => {
    expect(() => createDecryptor(randomBytes(32), 'aesv3')(1, 0)(new Uint8Array(50))).toThrow();
  });

  it('applies RC4 symmetrically with a per-object key', () => {
    const decrypt = createDecryptor(randomBytes(5), 'rc4');
    const data = bytes('rc4 payload');
    const once = decrypt(9, 0)(data);
    expect([...once]).not.toEqual([...data]);
    expect([...decrypt(9, 0)(once)]).toEqual([...data]);
    expect([...decrypt(10, 0)(data)]).not.toEqual([...once]);
  });
});
