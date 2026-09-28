import { describe, it, expect } from 'vitest';
import {
  AES_MODES,
  DEFAULT_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  SALT_BYTES,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decryptText,
  encryptText,
  generateKeyHex,
  hexToBytes,
  ivLength,
  loadAesEngine,
  parseRawKey,
  encryptPayload,
  decryptPayload,
  encryptedFileName,
  decryptedFileName,
  describeCipher,
  readableText,
  MAX_FILE_BYTES,
  webCryptoEngine,
  type AesEngine,
  type AesMode,
  type KeyMaterial,
} from './aes';
import { jsEngine } from './aesJsEngine';

const ENGINES: ReadonlyArray<[string, AesEngine]> = [
  ['Web Crypto', webCryptoEngine],
  ['pure JS', jsEngine],
];

const hex = (value: string): Uint8Array<ArrayBuffer> => {
  const result = hexToBytes(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

// Low iteration count keeps the passphrase tests fast; the real default is exercised once below.
const passphraseKey = (passphrase = 'correct horse', iterations = MIN_PBKDF2_ITERATIONS): KeyMaterial => ({
  kind: 'passphrase',
  passphrase,
  iterations,
  keySize: 256,
});

const RAW_128 = '2b7e151628aed2a6abf7158809cf4f3c';
const RAW_256 = '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4';

describe('hex and Base64 helpers', () => {
  it('round-trips bytes through hex', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(bytesToHex(bytes)).toBe('00017f80ff');
    expect(hex('00017f80ff')).toEqual(bytes);
  });

  it('accepts a 0x prefix, upper case, whitespace and colons in hex', () => {
    expect(bytesToHex(hex('0xAB CD:ef'))).toBe('abcdef');
  });

  it('rejects non-hex characters and an odd digit count', () => {
    expect(hexToBytes('zz')).toMatchObject({ ok: false, error: expect.stringMatching(/not valid hex/i) });
    expect(hexToBytes('abc')).toMatchObject({ ok: false, error: expect.stringMatching(/odd number/i) });
  });

  it('round-trips bytes through Base64, including URL-safe and unpadded input', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00]);
    const standard = bytesToBase64(bytes);
    expect(standard).toBe('+/+/AA==');
    const urlSafe = base64ToBytes('-_-_AA');
    expect(urlSafe.ok && urlSafe.value).toEqual(bytes);
  });

  it('rejects malformed Base64', () => {
    expect(base64ToBytes('abc$')).toMatchObject({ ok: false });
    expect(base64ToBytes('abcde')).toMatchObject({ ok: false });
  });

  it('encodes a very large buffer without overflowing the call stack', () => {
    const big = new Uint8Array(1024 * 1024).fill(0x41);
    const encoded = bytesToBase64(big);
    const decoded = base64ToBytes(encoded);
    expect(decoded.ok && decoded.value.length).toBe(big.length);
  });
});

describe('raw keys', () => {
  it('accepts 128- and 256-bit keys matching the selected size', () => {
    expect(parseRawKey(RAW_128, 128).ok).toBe(true);
    expect(parseRawKey(RAW_256, 256).ok).toBe(true);
  });

  it('rejects an empty key, a wrong length, and explains 192-bit keys', () => {
    expect(parseRawKey('', 256)).toMatchObject({ ok: false, error: expect.stringMatching(/enter a key/i) });
    expect(parseRawKey('abcd', 256)).toMatchObject({ ok: false, error: expect.stringMatching(/16 bits.*64 hex digits/) });
    expect(parseRawKey('00'.repeat(24), 256)).toMatchObject({ ok: false, error: expect.stringMatching(/192-bit/) });
  });

  it('explains a valid key that does not match the selected key size', () => {
    expect(parseRawKey(RAW_128, 256)).toMatchObject({ ok: false, error: expect.stringMatching(/switch key size to 128-bit/i) });
  });

  it('generates random keys of the requested size', () => {
    expect(generateKeyHex(128)).toMatch(/^[0-9a-f]{32}$/);
    expect(generateKeyHex(256)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateKeyHex(256)).not.toBe(generateKeyHex(256));
  });
});

describe.each(ENGINES)('published test vectors (%s engine)', (_name, engine) => {
  // NIST SP 800-38A, F.2.1 CBC-AES128.Encrypt, block #1. SubtleCrypto always adds PKCS#7
  // padding, so the output carries one extra block after the published one.
  it('matches NIST SP 800-38A AES-128-CBC', async () => {
    const out = await engine.encrypt('AES-CBC', hex(RAW_128), hex('000102030405060708090a0b0c0d0e0f'), hex('6bc1bee22e409f96e93d7e117393172a'));
    expect(bytesToHex(out).slice(0, 32)).toBe('7649abac8119b246cee98e9b12e9197d');
    expect(out.length).toBe(32);
  });

  // NIST SP 800-38A, F.5.1 CTR-AES128.Encrypt, block #1.
  it('matches NIST SP 800-38A AES-128-CTR', async () => {
    const out = await engine.encrypt('AES-CTR', hex(RAW_128), hex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'), hex('6bc1bee22e409f96e93d7e117393172a'));
    expect(bytesToHex(out)).toBe('874d6191b620e3261bef6864990db6ce');
  });

  // NIST SP 800-38A, F.5.5 CTR-AES256.Encrypt, block #1.
  it('matches NIST SP 800-38A AES-256-CTR', async () => {
    const out = await engine.encrypt('AES-CTR', hex(RAW_256), hex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'), hex('6bc1bee22e409f96e93d7e117393172a'));
    expect(bytesToHex(out)).toBe('601ec313775789a5b7a7f504bbf3d228');
  });

  // The original GCM spec (McGrew & Viega), Test Cases 1 and 2: all-zero key and IV.
  it('matches GCM test case 1 (empty plaintext, tag only)', async () => {
    const out = await engine.encrypt('AES-GCM', hex('00'.repeat(16)), hex('00'.repeat(12)), new Uint8Array(0));
    expect(bytesToHex(out)).toBe('58e2fccefa7e3061367f1d57a4e7455a');
  });

  it('matches GCM test case 2 (one zero block)', async () => {
    const out = await engine.encrypt('AES-GCM', hex('00'.repeat(16)), hex('00'.repeat(12)), hex('00'.repeat(16)));
    expect(bytesToHex(out)).toBe('0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf');
  });

  it('decrypts the GCM test case 2 vector back to zeros', async () => {
    const out = await engine.decrypt(
      'AES-GCM',
      hex('00'.repeat(16)),
      hex('00'.repeat(12)),
      hex('0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf')
    );
    expect(bytesToHex(out)).toBe('00'.repeat(16));
  });

  // RFC 7914 §11 PBKDF2-HMAC-SHA256 vector (P="passwd", S="salt", c=1), first 32 bytes.
  it('derives the RFC 7914 PBKDF2-HMAC-SHA256 key', async () => {
    const key = await engine.pbkdf2Sha256('passwd', new TextEncoder().encode('salt'), 1, 32);
    expect(bytesToHex(key)).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
  });
});

describe.each(ENGINES)('encryptText / decryptText round trips (%s engine)', (_name, engine) => {
  const modes: readonly AesMode[] = AES_MODES;

  for (const mode of modes) {
    it(`round-trips Unicode text with a passphrase in ${mode}`, async () => {
      const text = 'héllo wörld — 你好 🔐\n\ttabs & emoji';
      const enc = await encryptText(text, { engine, mode, key: passphraseKey(), encoding: 'base64' });
      expect(enc.ok).toBe(true);
      if (!enc.ok) return;
      const dec = await decryptText(enc.value.combined, { engine, mode, key: passphraseKey(), encoding: 'base64' });
      expect(dec).toEqual({ ok: true, value: text });
    });

    it(`round-trips with a raw key and hex encoding in ${mode}`, async () => {
      const key: KeyMaterial = { kind: 'raw', keyHex: RAW_256, keySize: 256 };
      const enc = await encryptText('secret', { engine, mode, key, encoding: 'hex' });
      if (!enc.ok) throw new Error(enc.error);
      expect(enc.value.combined).toMatch(/^[0-9a-f]+$/);
      expect(enc.value.saltHex).toBeNull();
      expect(enc.value.ivHex).toHaveLength(ivLength(mode) * 2);
      const dec = await decryptText(enc.value.combined, { engine, mode, key, encoding: 'hex' });
      expect(dec).toEqual({ ok: true, value: 'secret' });
    });
  }

  it('lays out a passphrase result as salt | IV | ciphertext+tag', async () => {
    const salt = new Uint8Array(SALT_BYTES).fill(1);
    const iv = new Uint8Array(12).fill(2);
    const enc = await encryptText('abc', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'hex', salt, iv });
    if (!enc.ok) throw new Error(enc.error);
    expect(enc.value.saltHex).toBe('01'.repeat(16));
    expect(enc.value.ivHex).toBe('02'.repeat(12));
    expect(enc.value.combined).toBe(enc.value.saltHex + enc.value.ivHex + enc.value.ciphertext);
    expect(enc.value.ciphertext).toHaveLength((3 + 16) * 2);
  });

  it('produces different ciphertext every time for the same input (random salt and IV)', async () => {
    const a = await encryptText('same', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'base64' });
    const b = await encryptText('same', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'base64' });
    expect(a.ok && b.ok && a.value.combined !== b.value.combined).toBe(true);
  });

  it('decrypts with a separately supplied IV in raw-key mode', async () => {
    const key: KeyMaterial = { kind: 'raw', keyHex: RAW_128, keySize: 128 };
    const enc = await encryptText('split IV', { engine, mode: 'AES-CBC', key, encoding: 'base64' });
    if (!enc.ok) throw new Error(enc.error);
    const dec = await decryptText(enc.value.ciphertext, { engine, mode: 'AES-CBC', key, encoding: 'base64', ivHex: enc.value.ivHex });
    expect(dec).toEqual({ ok: true, value: 'split IV' });
  });

  it('decrypts the fixed example from the content page at the default iteration count', async () => {
    const dec = await decryptText(
      '5mwsa04WUihXIiQZn06oCUMopkNn/Peg/+TtejnrIfHohyI+XlTlJUJnMnZZK2+SXGXrk0cSFkXI8jF5ROdLQFtawUYkjqlAps2c0gnz0Q==',
      {
        engine,
        mode: 'AES-GCM',
        key: { kind: 'passphrase', passphrase: 'correct horse battery staple', iterations: DEFAULT_PBKDF2_ITERATIONS, keySize: 256 },
        encoding: 'base64',
      }
    );
    expect(dec).toEqual({ ok: true, value: 'Meet me at the usual place at 10pm.' });
    // 600,000 PBKDF2 rounds in pure JavaScript take seconds, far more under a parallel suite.
  }, 30000);

  it('handles a large input', async () => {
    const text = 'x'.repeat(2 * 1024 * 1024);
    const key: KeyMaterial = { kind: 'raw', keyHex: RAW_256, keySize: 256 };
    const enc = await encryptText(text, { engine, mode: 'AES-GCM', key, encoding: 'base64' });
    if (!enc.ok) throw new Error(enc.error);
    const dec = await decryptText(enc.value.combined, { engine, mode: 'AES-GCM', key, encoding: 'base64' });
    expect(dec.ok && dec.value.length).toBe(text.length);
  });
});

describe.each(ENGINES)('error handling (%s engine)', (_name, engine) => {
  it('refuses empty input in both directions', async () => {
    expect(await encryptText('', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'base64' })).toMatchObject({ ok: false });
    expect(await decryptText('  ', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'base64' })).toMatchObject({ ok: false });
  });

  it('refuses an empty passphrase and out-of-range iterations', async () => {
    const run = (key: KeyMaterial) => encryptText('x', { engine, mode: 'AES-GCM', key, encoding: 'base64' });
    expect(await run(passphraseKey(''))).toMatchObject({ ok: false, error: expect.stringMatching(/passphrase/i) });
    expect(await run(passphraseKey('p', 10))).toMatchObject({ ok: false, error: expect.stringMatching(/at least/i) });
    expect(await run(passphraseKey('p', MAX_PBKDF2_ITERATIONS + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/or lower/i) });
    expect(await run(passphraseKey('p', 1500.5))).toMatchObject({ ok: false, error: expect.stringMatching(/whole number/i) });
  });

  it('reports a wrong passphrase for AES-GCM as an authentication failure', async () => {
    const enc = await encryptText('top secret', { engine, mode: 'AES-GCM', key: passphraseKey('right'), encoding: 'base64' });
    if (!enc.ok) throw new Error(enc.error);
    const dec = await decryptText(enc.value.combined, { engine, mode: 'AES-GCM', key: passphraseKey('wrong'), encoding: 'base64' });
    expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/authentication check/i) });
  });

  it('detects tampered GCM ciphertext', async () => {
    const key: KeyMaterial = { kind: 'raw', keyHex: RAW_128, keySize: 128 };
    const enc = await encryptText('integrity', { engine, mode: 'AES-GCM', key, encoding: 'hex' });
    if (!enc.ok) throw new Error(enc.error);
    const last = enc.value.combined.slice(-1);
    const tampered = enc.value.combined.slice(0, -1) + (last === '0' ? '1' : '0');
    expect(await decryptText(tampered, { engine, mode: 'AES-GCM', key, encoding: 'hex' })).toMatchObject({ ok: false });
  });

  it('reports a wrong key for AES-CTR as unreadable output rather than garbage', async () => {
    const enc = await encryptText('a sentence long enough to be clearly invalid once scrambled', {
      engine,
      mode: 'AES-CTR',
      key: { kind: 'raw', keyHex: RAW_128, keySize: 128 },
      encoding: 'base64',
    });
    if (!enc.ok) throw new Error(enc.error);
    const dec = await decryptText(enc.value.combined, {
      engine,
      mode: 'AES-CTR',
      key: { kind: 'raw', keyHex: 'ff'.repeat(16), keySize: 128 },
      encoding: 'base64',
    });
    expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/no integrity check/i) });
  });

  it('explains truncated input', async () => {
    const dec = await decryptText('AAAA', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'base64' });
    expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/too short/i) });
  });

  it('explains CBC ciphertext that is not a whole number of blocks', async () => {
    const dec = await decryptText('00'.repeat(16 + 5), { engine, mode: 'AES-CBC', key: { kind: 'raw', keyHex: RAW_128, keySize: 128 }, encoding: 'hex' });
    expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/multiple of 16/i) });
  });

  it('explains an IV of the wrong length', async () => {
    const dec = await decryptText('00'.repeat(32), {
      engine,
      mode: 'AES-GCM',
      key: { kind: 'raw', keyHex: RAW_128, keySize: 128 },
      encoding: 'hex',
      ivHex: 'abcd',
    });
    expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/needs exactly 12/i) });
  });

  it('points hex ciphertext pasted in Base64 mode at the encoding switch', async () => {
    const dec = await decryptText('zz!!', { engine, mode: 'AES-GCM', key: passphraseKey(), encoding: 'base64' });
    expect(dec).toMatchObject({ ok: false, error: expect.stringMatching(/switch the encoding/i) });
  });
});

describe('engines are interchangeable', () => {
  for (const mode of AES_MODES) {
    it(`ciphertext from one engine decrypts with the other in ${mode}`, async () => {
      const key = passphraseKey('shared secret');
      const text = 'portable — 可移植 ✓';
      const fromNative = await encryptText(text, { engine: webCryptoEngine, mode, key, encoding: 'base64' });
      if (!fromNative.ok) throw new Error(fromNative.error);
      expect(await decryptText(fromNative.value.combined, { engine: jsEngine, mode, key, encoding: 'base64' })).toEqual({ ok: true, value: text });

      const fromJs = await encryptText(text, { engine: jsEngine, mode, key, encoding: 'hex' });
      if (!fromJs.ok) throw new Error(fromJs.error);
      expect(await decryptText(fromJs.value.combined, { engine: webCryptoEngine, mode, key, encoding: 'hex' })).toEqual({ ok: true, value: text });
    });
  }

  it('produces identical bytes from both engines for a fixed salt and IV', async () => {
    const options = { mode: 'AES-CTR' as const, key: passphraseKey(), encoding: 'hex' as const, salt: new Uint8Array(16).fill(7), iv: new Uint8Array(16).fill(0xff) };
    const a = await encryptText('counter wraps past 2^64 here', { ...options, engine: webCryptoEngine });
    const b = await encryptText('counter wraps past 2^64 here', { ...options, engine: jsEngine });
    expect(a.ok && b.ok && a.value.combined).toBe(b.ok && b.value.combined);
  });
});

describe('loadAesEngine', () => {
  it('returns the native engine for webcrypto', async () => {
    expect(await loadAesEngine('webcrypto')).toEqual({ ok: true, value: webCryptoEngine });
  });

  it('lazily loads the pure-JS engine', async () => {
    expect(await loadAesEngine('js')).toEqual({ ok: true, value: jsEngine });
  });
});

describe('cipher names and file names', () => {
  it('names the cipher configuration conventionally', () => {
    expect(describeCipher('AES-GCM', 256)).toBe('AES-256-GCM');
    expect(describeCipher('AES-CBC', 128)).toBe('AES-128-CBC');
  });

  it('adds and strips the .enc extension', () => {
    expect(encryptedFileName('report.pdf')).toBe('report.pdf.enc');
    expect(decryptedFileName('report.pdf.enc')).toBe('report.pdf');
    expect(decryptedFileName('REPORT.PDF.ENC')).toBe('REPORT.PDF');
  });

  it('never produces an empty or clashing decrypted name', () => {
    expect(decryptedFileName('.enc')).toBe('.enc.decrypted');
    expect(decryptedFileName('photo.jpg')).toBe('photo.jpg.decrypted');
    expect(encryptedFileName('')).toBe('file.enc');
  });
});

describe.each(ENGINES)('binary payloads (%s engine)', (_name, engine) => {
  it('round-trips arbitrary bytes, including every byte value', async () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i += 1) data[i] = i % 256;
    const key = passphraseKey();
    const enc = await encryptPayload(data, { engine, mode: 'AES-GCM', key });
    if (!enc.ok) throw new Error(enc.error);
    expect(enc.value.bytes.length).toBe(16 + 12 + data.length + 16);
    const dec = await decryptPayload(enc.value.bytes, { engine, mode: 'AES-GCM', key });
    expect(dec.ok && Array.from(dec.value)).toEqual(Array.from(data));
  });

  it('round-trips an empty file', async () => {
    const key = { kind: 'raw', keyHex: RAW_256, keySize: 256 } as const;
    for (const mode of AES_MODES) {
      const enc = await encryptPayload(new Uint8Array(0), { engine, mode, key });
      if (!enc.ok) throw new Error(enc.error);
      const dec = await decryptPayload(enc.value.bytes, { engine, mode, key });
      expect(dec.ok && dec.value.length).toBe(0);
    }
  });

  it('refuses a payload over the file size limit before doing any crypto work', async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1);
    expect(await encryptPayload(huge, { engine, mode: 'AES-GCM', key: passphraseKey() })).toMatchObject({ ok: false, error: expect.stringMatching(/100 MB/) });
  });
});

describe('readableText', () => {
  const enc = (text: string) => new TextEncoder().encode(text);

  it('returns plain and Unicode text unchanged, including whitespace controls', () => {
    expect(readableText(enc('hello\r\n\tworld'))).toBe('hello\r\n\tworld');
    expect(readableText(enc('héllo — 你好 🔐'))).toBe('héllo — 你好 🔐');
  });

  it('treats an empty file as (empty) text', () => {
    expect(readableText(new Uint8Array(0))).toBe('');
  });

  it('drops a UTF-8 byte-order mark', () => {
    expect(readableText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi');
  });

  it('recognises real binary formats', () => {
    // Zip local-file header and PNG signature.
    expect(readableText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]))).toBeNull();
    expect(readableText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });

  it('treats a NUL byte or invalid UTF-8 as binary', () => {
    expect(readableText(enc('abc\u0000def'))).toBeNull();
    expect(readableText(new Uint8Array([0x68, 0xff, 0x69]))).toBeNull();
  });

  it('tolerates a stray control character but not a text thick with them', () => {
    expect(readableText(enc('x'.repeat(200) + '\u001b'))).not.toBeNull();
    expect(readableText(enc('\u0001\u0002\u0003 abc'))).toBeNull();
  });

  it('handles a large text file', () => {
    const big = 'line of text\n'.repeat(200_000);
    expect(readableText(enc(big))).toHaveLength(big.length);
  });
});

