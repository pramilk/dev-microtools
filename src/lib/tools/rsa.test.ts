import { describe, it, expect, beforeAll } from 'vitest';
import { constants, generateKeyPairSync, privateDecrypt, publicEncrypt } from 'node:crypto';
import { base64ToBytes } from './aes';
import {
  OAEP_HASHES,
  describeKeySource,
  describeScheme,
  generateRsaKeyPair,
  inspectKey,
  maxOaepPlaintextBytes,
  parseKey,
  rsaDecryptText,
  rsaEncryptText,
  toPem,
  type GeneratedKeyPair,
  type OaepHash,
  type RsaOptions,
} from './rsa';

const base64ToBytesForTest = (value: string): Uint8Array => {
  const result = base64ToBytes(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

// Key generation is the slow part of RSA, so one pair is shared by every test that
// doesn't care which key it gets.
let pair: GeneratedKeyPair;
beforeAll(async () => {
  const generated = await generateRsaKeyPair(2048);
  if (!generated.ok) throw new Error(generated.error);
  pair = generated.value;
}, 30000);

const options = (key: string, overrides: Partial<RsaOptions> = {}): RsaOptions => ({
  key,
  hash: 'SHA-256',
  scheme: 'oaep',
  encoding: 'base64',
  ...overrides,
});

async function encrypt(plaintext: string, key: string, overrides: Partial<RsaOptions> = {}): Promise<string> {
  const result = await rsaEncryptText(plaintext, options(key, overrides));
  if (!result.ok) throw new Error(result.error);
  return result.value.ciphertext;
}

const nodeHash = (hash: OaepHash): string => hash.replace('-', '').toLowerCase();

describe('maxOaepPlaintextBytes', () => {
  it('follows k − 2·hLen − 2 from RFC 8017', () => {
    expect(maxOaepPlaintextBytes(2048, 'SHA-256')).toBe(190);
    expect(maxOaepPlaintextBytes(2048, 'SHA-1')).toBe(214);
    expect(maxOaepPlaintextBytes(3072, 'SHA-384')).toBe(286);
    expect(maxOaepPlaintextBytes(4096, 'SHA-512')).toBe(382);
  });

  it('never goes negative for a tiny modulus', () => {
    expect(maxOaepPlaintextBytes(512, 'SHA-512')).toBe(0);
  });
});

describe('describe helpers', () => {
  it('names schemes and key sources', () => {
    expect(describeScheme('oaep', 'SHA-256')).toBe('RSA-OAEP (SHA-256)');
    expect(describeScheme('hybrid', 'SHA-1')).toBe('RSA-OAEP (SHA-1) + AES-256-GCM');
    expect(describeKeySource('pkcs1')).toBe('PKCS#1 PEM');
    expect(describeKeySource('jwk')).toBe('JWK');
  });
});

describe('toPem', () => {
  it('wraps Base64 at 64 characters with matching BEGIN/END lines', () => {
    const pem = toPem('PUBLIC KEY', new Uint8Array(100).fill(0xab));
    const lines = pem.trim().split('\n');
    expect(lines[0]).toBe('-----BEGIN PUBLIC KEY-----');
    expect(lines.at(-1)).toBe('-----END PUBLIC KEY-----');
    expect(lines[1]).toHaveLength(64);
  });
});

describe('generateRsaKeyPair', () => {
  it('produces an SPKI public key and a PKCS#8 private key of the requested size', async () => {
    expect(pair.publicPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(pair.privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(await inspectKey(pair.publicPem)).toEqual({ ok: true, value: { kind: 'public', source: 'spki', modulusBits: 2048 } });
    expect(await inspectKey(pair.privatePem)).toEqual({
      ok: true,
      value: { kind: 'private', source: 'pkcs8', modulusBits: 2048 },
    });
  });

  it(
    'generates a 3072-bit pair on request',
    async () => {
      const generated = await generateRsaKeyPair(3072);
      expect(generated.ok && (await inspectKey(generated.value.publicPem))).toMatchObject({ value: { modulusBits: 3072 } });
    },
    30000
  );
});

describe('parseKey', () => {
  it('rejects empty input', () => {
    expect(parseKey('   ')).toMatchObject({ ok: false, error: expect.stringMatching(/paste a key/i) });
  });

  it('rejects text with no PEM markers', () => {
    expect(parseKey('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A')).toMatchObject({ ok: false, error: expect.stringMatching(/PEM format/) });
  });

  it('explains how to convert OpenSSH keys and certificates', () => {
    expect(parseKey('ssh-rsa AAAAB3NzaC1yc2E user@host')).toMatchObject({ ok: false, error: expect.stringMatching(/ssh-keygen -e/) });
    expect(parseKey('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ssh-keygen -p -m PKCS8/),
    });
    expect(parseKey('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/openssl x509 -pubkey/),
    });
  });

  it('rejects passphrase-protected private keys in both PEM styles', () => {
    expect(parseKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/passphrase/),
    });
    const legacy = '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n-----END RSA PRIVATE KEY-----';
    expect(parseKey(legacy)).toMatchObject({ ok: false, error: expect.stringMatching(/passphrase/) });
  });

  it('rejects mismatched BEGIN/END labels and damaged Base64', () => {
    expect(parseKey('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/missing/),
    });
    expect(parseKey('-----BEGIN PUBLIC KEY-----\n$$$$\n-----END PUBLIC KEY-----')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not valid Base64/),
    });
  });

  it('rejects EC keys, in PEM or JWK form', () => {
    expect(parseKey('-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not an RSA key/),
    });
    expect(parseKey('{"kty":"EC","crv":"P-256","x":"a","y":"b"}')).toMatchObject({ ok: false, error: expect.stringMatching(/"EC" key/) });
  });

  it('rejects malformed JWKs and JWK Sets', () => {
    expect(parseKey('{not json')).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(parseKey('{"keys":[]}')).toMatchObject({ ok: false, error: expect.stringMatching(/JWK Set/) });
    expect(parseKey('{"kty":"RSA","n":"abc"}')).toMatchObject({ ok: false, error: expect.stringMatching(/"e"/) });
  });

  it('finds the key inside surrounding text', () => {
    expect(parseKey(`Here is my key:\n\n${pair.publicPem}\nThanks!`)).toMatchObject({ ok: true, value: { kind: 'public' } });
  });

  it('reports an EC key in SPKI form as unloadable rather than crashing', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(await inspectKey(pem)).toMatchObject({ ok: false, error: expect.stringMatching(/could not be loaded as an RSA key/) });
  });
});

describe('PKCS#1 and JWK keys (interop with OpenSSL and JOSE)', () => {
  const node = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs1Public = node.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const pkcs1Private = node.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('reads "RSA PUBLIC KEY" / "RSA PRIVATE KEY" PEM by re-wrapping them', async () => {
    expect(await inspectKey(pkcs1Public)).toEqual({ ok: true, value: { kind: 'public', source: 'pkcs1', modulusBits: 2048 } });
    expect(await inspectKey(pkcs1Private)).toEqual({ ok: true, value: { kind: 'private', source: 'pkcs1', modulusBits: 2048 } });
    const ciphertext = await encrypt('pkcs1 round trip', pkcs1Public);
    expect(await rsaDecryptText(ciphertext, options(pkcs1Private))).toEqual({ ok: true, value: 'pkcs1 round trip' });
  });

  it('reads JWKs, ignoring an "alg" that names a different hash', async () => {
    const publicJwk = { ...node.publicKey.export({ format: 'jwk' }), alg: 'RSA-OAEP-256' };
    const privateJwk = { ...node.privateKey.export({ format: 'jwk' }), alg: 'RSA-OAEP-256', key_ops: ['decrypt'] };
    const ciphertext = await encrypt('jwk round trip', JSON.stringify(publicJwk), { hash: 'SHA-1' });
    expect(await rsaDecryptText(ciphertext, options(JSON.stringify(privateJwk), { hash: 'SHA-1' }))).toEqual({
      ok: true,
      value: 'jwk round trip',
    });
  });
});

describe('RSA-OAEP (direct)', () => {
  it.each(OAEP_HASHES)('round-trips with %s', async (hash) => {
    const ciphertext = await encrypt('hello, world', pair.publicPem, { hash });
    expect(await rsaDecryptText(ciphertext, options(pair.privatePem, { hash }))).toEqual({ ok: true, value: 'hello, world' });
  });

  it('produces exactly one modulus of ciphertext, randomised on every call', async () => {
    const first = await encrypt('same', pair.publicPem);
    const second = await encrypt('same', pair.publicPem);
    expect(first).not.toBe(second);
    const bytes = base64ToBytesForTest(first);
    expect(bytes).toHaveLength(256);
  });

  it('round-trips Unicode, including astral-plane characters', async () => {
    const text = 'héllo — 你好 — 🔐🚀 — \u0000 null';
    const ciphertext = await encrypt(text, pair.publicPem);
    expect(await rsaDecryptText(ciphertext, options(pair.privatePem))).toEqual({ ok: true, value: text });
  });

  it('round-trips hex encoding', async () => {
    const ciphertext = await encrypt('hex please', pair.publicPem, { encoding: 'hex' });
    expect(ciphertext).toMatch(/^[0-9a-f]{512}$/);
    expect(await rsaDecryptText(ciphertext, options(pair.privatePem, { encoding: 'hex' }))).toEqual({
      ok: true,
      value: 'hex please',
    });
  });

  it('accepts exactly the size limit and refuses one byte more, pointing at Hybrid', async () => {
    const atLimit = 'a'.repeat(190);
    const ciphertext = await encrypt(atLimit, pair.publicPem);
    expect(await rsaDecryptText(ciphertext, options(pair.privatePem))).toEqual({ ok: true, value: atLimit });
    expect(await rsaEncryptText('a'.repeat(191), options(pair.publicPem))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/191 bytes.*at most 190 bytes.*Hybrid/),
    });
  });

  it('counts the limit in UTF-8 bytes, not characters', async () => {
    // 64 × 3-byte characters = 192 bytes, over the 190-byte limit.
    expect(await rsaEncryptText('€'.repeat(64), options(pair.publicPem))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/192 bytes/),
    });
  });

  it('encrypts with a pasted private key by using its public half', async () => {
    const result = await rsaEncryptText('from private', options(pair.privatePem));
    expect(result).toMatchObject({ ok: true, value: { usedPrivateKey: true, modulusBits: 2048 } });
    if (!result.ok) return;
    expect(await rsaDecryptText(result.value.ciphertext, options(pair.privatePem))).toEqual({ ok: true, value: 'from private' });
  });

  it('decrypts ciphertext made by Node/OpenSSL, including its SHA-1 default', async () => {
    for (const hash of OAEP_HASHES) {
      const ciphertext = publicEncrypt(
        { key: pair.publicPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: nodeHash(hash) },
        Buffer.from(`from node ${hash}`)
      ).toString('base64');
      expect(await rsaDecryptText(ciphertext, options(pair.privatePem, { hash }))).toEqual({
        ok: true,
        value: `from node ${hash}`,
      });
    }
  });

  it('produces ciphertext Node/OpenSSL can decrypt', async () => {
    const ciphertext = await encrypt('to node', pair.publicPem, { hash: 'SHA-384' });
    const plain = privateDecrypt(
      { key: pair.privatePem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha384' },
      Buffer.from(ciphertext, 'base64')
    );
    expect(plain.toString('utf8')).toBe('to node');
  });
});

describe('Hybrid (RSA-OAEP + AES-256-GCM)', () => {
  it('round-trips text far beyond the RSA-OAEP limit', async () => {
    const text = 'Long message 🔐 '.repeat(70_000); // ~1.1 MB
    const ciphertext = await encrypt(text, pair.publicPem, { scheme: 'hybrid' });
    expect(await rsaDecryptText(ciphertext, options(pair.privatePem, { scheme: 'hybrid' }))).toEqual({ ok: true, value: text });
  });

  it('lays out wrapped key | 12-byte IV | ciphertext + 16-byte tag, decryptable with Node', async () => {
    const ciphertext = await encrypt('layout check', pair.publicPem, { scheme: 'hybrid' });
    const bytes = Buffer.from(ciphertext, 'base64');
    expect(bytes).toHaveLength(256 + 12 + 'layout check'.length + 16);

    const { createDecipheriv } = await import('node:crypto');
    const aesKey = privateDecrypt(
      { key: pair.privatePem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      bytes.subarray(0, 256)
    );
    const decipher = createDecipheriv('aes-256-gcm', aesKey, bytes.subarray(256, 268));
    decipher.setAuthTag(bytes.subarray(-16));
    expect(Buffer.concat([decipher.update(bytes.subarray(268, -16)), decipher.final()]).toString()).toBe('layout check');
  });

  it('detects tampering with the AES part', async () => {
    const bytes = base64ToBytesForTest(await encrypt('do not touch', pair.publicPem, { scheme: 'hybrid' }));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    const tampered = Buffer.from(bytes).toString('base64');
    expect(await rsaDecryptText(tampered, options(pair.privatePem, { scheme: 'hybrid' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/authentication check/),
    });
  });

  it('suggests the other scheme when the ciphertext shape gives it away', async () => {
    const direct = await encrypt('short', pair.publicPem);
    expect(await rsaDecryptText(direct, options(pair.privatePem, { scheme: 'hybrid' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/switching Scheme to "RSA-OAEP"/),
    });
    const hybrid = await encrypt('short', pair.publicPem, { scheme: 'hybrid' });
    expect(await rsaDecryptText(hybrid, options(pair.privatePem))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/switching Scheme to "Hybrid"/),
    });
  });
});

describe('errors', () => {
  it('refuses empty plaintext and empty ciphertext', async () => {
    expect(await rsaEncryptText('', options(pair.publicPem))).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to encrypt/i) });
    expect(await rsaDecryptText('  ', options(pair.privatePem))).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to decrypt/i) });
  });

  it('refuses to decrypt with a public key', async () => {
    const ciphertext = await encrypt('x', pair.publicPem);
    expect(await rsaDecryptText(ciphertext, options(pair.publicPem))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/needs the matching private key/),
    });
  });

  it('explains a wrong private key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const ciphertext = await encrypt('secret', pair.publicPem);
    expect(await rsaDecryptText(ciphertext, options(other))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/doesn't match the public key/),
    });
  });

  it('explains a mismatched OAEP hash', async () => {
    const ciphertext = await encrypt('secret', pair.publicPem, { hash: 'SHA-256' });
    expect(await rsaDecryptText(ciphertext, options(pair.privatePem, { hash: 'SHA-1' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/OAEP hash differs.*SHA-1/),
    });
  });

  it('reports malformed and truncated ciphertext', async () => {
    expect(await rsaDecryptText('not base64 !!', options(pair.privatePem))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not valid Base64/),
    });
    const ciphertext = await encrypt('secret', pair.publicPem);
    expect(await rsaDecryptText(ciphertext.slice(0, 100), options(pair.privatePem))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/exactly 256 bytes.*cut off/),
    });
  });

  it('reports an unusable key when encrypting', async () => {
    expect(await rsaEncryptText('x', options('garbage'))).toMatchObject({ ok: false, error: expect.stringMatching(/PEM format/) });
  });

  it('refuses text over 10 MB', async () => {
    expect(await rsaEncryptText('a'.repeat(10 * 1024 * 1024 + 1), options(pair.publicPem, { scheme: 'hybrid' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/over 10 MB/),
    });
  });
});
