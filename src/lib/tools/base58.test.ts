import { describe, it, expect } from 'vitest';
import { encodeBase58, decodeBase58, encodeBytesToBase58, BASE58_ALPHABET } from './base58';

describe('encodeBase58', () => {
  // Official test vector from Bitcoin's base58_encode_decode.json test suite.
  it('encodes an empty string to an empty string', () => {
    expect(encodeBase58('')).toEqual({ ok: true, value: '' });
  });

  it('encodes "hello world" to the known vector', () => {
    expect(encodeBase58('hello world')).toEqual({ ok: true, value: 'StV1DL6CwTryKyV' });
  });

  it('encodes a single 0x00 byte to a single leading "1"', () => {
    expect(encodeBase58('\x00')).toEqual({ ok: true, value: '1' });
  });

  it('encodes multiple leading zero bytes to the same number of leading "1"s', () => {
    expect(encodeBase58('\x00\x00\x00')).toEqual({ ok: true, value: '111' });
  });

  it('encodes leading zero bytes followed by non-zero data', () => {
    const result = encodeBase58('\x00\x00hello world');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('11')).toBe(true);
      expect(result.value).not.toMatch(/^1{3,}/);
    }
  });

  it('never produces characters outside the base58 alphabet', () => {
    const result = encodeBase58('The quick brown fox jumps over the lazy dog 0123456789');
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const char of result.value) {
        expect(BASE58_ALPHABET).toContain(char);
      }
    }
  });
});

describe('decodeBase58', () => {
  it('decodes the known vector back to "hello world"', () => {
    expect(decodeBase58('StV1DL6CwTryKyV')).toEqual({ ok: true, value: 'hello world' });
  });

  it('decodes a single "1" back to a single 0x00 byte', () => {
    expect(decodeBase58('1')).toEqual({ ok: true, value: '\x00' });
  });

  it('rejects empty input', () => {
    const result = decodeBase58('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing to decode/i);
  });

  it.each(['0', 'O', 'I', 'l'])('rejects the ambiguous character %j', (char) => {
    const result = decodeBase58(char);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/alphabet/i);
  });

  it('rejects other characters outside the alphabet', () => {
    const result = decodeBase58('not-valid!!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/alphabet/i);
  });

  it('tolerates surrounding whitespace', () => {
    expect(decodeBase58('  StV1DL6CwTryKyV  ')).toEqual({ ok: true, value: 'hello world' });
  });

  it('explains when the payload decodes to binary rather than text', () => {
    // Encode two bytes (0xFF 0xFE) that are not valid UTF-8, then try to decode as text.
    const bytes = new Uint8Array([0xff, 0xfe]);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    let digits = '';
    while (value > 0n) {
      digits = BASE58_ALPHABET[Number(value % 58n)] + digits;
      value /= 58n;
    }
    const result = decodeBase58(digits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid UTF-8/i);
  });
});

describe('round-trip', () => {
  it.each([
    '',
    'a',
    'hello world',
    'hello',
    '{"json":true}',
    'The quick brown fox jumps over the lazy dog',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '\x00leading zero byte',
    '\x00\x00\x00multiple leading zero bytes',
    'trailing zero byte\x00',
    'héllo 🎉',
    '日本語のテキスト',
    '🎉🎊🎈 emoji everywhere 🎈🎊🎉',
  ])('round-trips %j through encode and decode', (sample) => {
    const encoded = encodeBase58(sample);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    if (encoded.value === '') {
      expect(sample).toBe('');
      return;
    }
    expect(decodeBase58(encoded.value)).toEqual({ ok: true, value: sample });
  });

  it('round-trips a large input (several KB)', () => {
    const large = 'The quick brown fox jumps over the lazy dog. '.repeat(200);
    const encoded = encodeBase58(large);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(decodeBase58(encoded.value)).toEqual({ ok: true, value: large });
  });

  it('round-trips repeated-character input', () => {
    const repeated = 'x'.repeat(5000);
    const encoded = encodeBase58(repeated);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(decodeBase58(encoded.value)).toEqual({ ok: true, value: repeated });
  });
});

describe('encodeBytesToBase58', () => {
  it('matches the string encoder for ASCII input', () => {
    for (const sample of ['hello world', 'a', '{"json":true}']) {
      const bytes = new TextEncoder().encode(sample);
      expect(encodeBytesToBase58(bytes)).toEqual(encodeBase58(sample));
    }
  });

  it('encodes binary that is not valid UTF-8, which the string path cannot accept', () => {
    const result = encodeBytesToBase58(Uint8Array.from([0xff, 0xfe]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('preserves leading zero bytes as leading 1s', () => {
    expect(encodeBytesToBase58(Uint8Array.from([0x00, 0x00, 0x01]))).toEqual({ ok: true, value: '112' });
  });

  it('encodes empty input as an empty string', () => {
    expect(encodeBytesToBase58(new Uint8Array(0))).toEqual({ ok: true, value: '' });
  });
});
