import { describe, it, expect } from 'vitest';
import { encodeBase32, decodeBase32 } from './base32';

describe('encodeBase32', () => {
  // Known-answer vectors from RFC 4648 section 10.
  it.each([
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ])('encodes %j to %j (RFC 4648 vector)', (input, expected) => {
    if (input === '') {
      expect(encodeBase32(input).ok).toBe(false);
      return;
    }
    expect(encodeBase32(input)).toEqual({ ok: true, value: expected });
  });

  it('omits padding when requested', () => {
    expect(encodeBase32('foobar', { padding: false })).toEqual({ ok: true, value: 'MZXW6YTBOI' });
    expect(encodeBase32('f', { padding: false })).toEqual({ ok: true, value: 'MY' });
  });

  it('encodes multi-byte UTF-8 correctly', () => {
    const result = encodeBase32('héllo 🎉');
    expect(result.ok).toBe(true);
    if (result.ok) expect(decodeBase32(result.value)).toEqual({ ok: true, value: 'héllo 🎉' });
  });

  it('rejects empty input', () => {
    expect(encodeBase32('').ok).toBe(false);
  });

  it('round-trips input large enough to span many 5-byte blocks', () => {
    const large = 'The quick brown fox jumps over the lazy dog. '.repeat(200);
    const result = encodeBase32(large);
    expect(result.ok).toBe(true);
    if (result.ok) expect(decodeBase32(result.value)).toEqual({ ok: true, value: large });
  });
});

describe('decodeBase32', () => {
  it('decodes standard base32', () => {
    expect(decodeBase32('MZXW6YTBOI======')).toEqual({ ok: true, value: 'foobar' });
  });

  it('is case-insensitive', () => {
    expect(decodeBase32('mzxw6ytboi======')).toEqual({ ok: true, value: 'foobar' });
  });

  it('tolerates missing padding', () => {
    expect(decodeBase32('MZXW6YTBOI')).toEqual({ ok: true, value: 'foobar' });
  });

  it('tolerates surrounding whitespace and wrapped newlines', () => {
    expect(decodeBase32('  MZXW6\nYTBOI======  ')).toEqual({ ok: true, value: 'foobar' });
  });

  it('rejects characters outside the base32 alphabet', () => {
    const result1 = decodeBase32('MZXW1YTBOI');
    expect(result1.ok).toBe(false);
    if (!result1.ok) expect(result1.error).toMatch(/alphabet/i);

    const result8 = decodeBase32('MZXW8YTBOI');
    expect(result8.ok).toBe(false);
    if (!result8.ok) expect(result8.error).toMatch(/alphabet/i);
  });

  it('rejects empty input', () => {
    expect(decodeBase32('   ').ok).toBe(false);
  });

  it('explains when the payload decodes to binary rather than text', () => {
    // Encodes bytes 0xFF 0xFE, which is not valid UTF-8.
    const result = decodeBase32('777A====');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid UTF-8/i);
  });

  it('round-trips every encode', () => {
    for (const sample of ['hello', 'é', '日本語', '🎉 mixed ascii', '{"json":true}']) {
      const encoded = encodeBase32(sample);
      expect(encoded.ok).toBe(true);
      if (encoded.ok) expect(decodeBase32(encoded.value)).toEqual({ ok: true, value: sample });
    }
  });
});
