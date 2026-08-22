import { describe, it, expect } from 'vitest';
import { encodeBase64, decodeBase64, toUrlSafe, fromUrlSafe } from './base64';

describe('encodeBase64', () => {
  // Known-answer vectors from RFC 4648 section 10.
  it.each([
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j to %j (RFC 4648 vector)', (input, expected) => {
    expect(encodeBase64(input)).toEqual({ ok: true, value: expected });
  });

  it('encodes multi-byte UTF-8 correctly', () => {
    // btoa() alone throws on these; the encoder must go through UTF-8 bytes.
    expect(encodeBase64('é')).toEqual({ ok: true, value: 'w6k=' });
    expect(encodeBase64('日本語')).toEqual({ ok: true, value: '5pel5pys6Kqe' });
    expect(encodeBase64('🎉')).toEqual({ ok: true, value: '8J+OiQ==' });
  });

  it('rejects empty input', () => {
    expect(encodeBase64('').ok).toBe(false);
  });

  it('produces URL-safe output on request', () => {
    const result = encodeBase64('~~~?>>>', true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toMatch(/[+/=]/);
    }
  });

  it('handles input large enough to exceed the chunking threshold', () => {
    const large = 'a'.repeat(100_000);
    const result = encodeBase64(large);
    expect(result.ok).toBe(true);
    if (result.ok) expect(decodeBase64(result.value)).toEqual({ ok: true, value: large });
  });
});

describe('decodeBase64', () => {
  it('decodes standard base64', () => {
    expect(decodeBase64('Zm9vYmFy')).toEqual({ ok: true, value: 'foobar' });
  });

  it('decodes URL-safe base64 without padding', () => {
    expect(decodeBase64('8J-OiQ')).toEqual({ ok: true, value: '🎉' });
  });

  it('tolerates surrounding whitespace and wrapped newlines', () => {
    expect(decodeBase64('  Zm9v\nYmFy  ')).toEqual({ ok: true, value: 'foobar' });
  });

  it('rejects characters outside the base64 alphabet', () => {
    const result = decodeBase64('not valid!!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/alphabet/i);
  });

  it('rejects empty input', () => {
    expect(decodeBase64('   ').ok).toBe(false);
  });

  it('explains when the payload decodes to binary rather than text', () => {
    // 0xFF 0xFE is not valid UTF-8.
    const result = decodeBase64('//4=');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid UTF-8/i);
  });

  it('round-trips every encode', () => {
    for (const sample of ['hello', 'é', '日本語', '🎉 mixed ascii', '{"json":true}']) {
      const encoded = encodeBase64(sample);
      expect(encoded.ok).toBe(true);
      if (encoded.ok) expect(decodeBase64(encoded.value)).toEqual({ ok: true, value: sample });
    }
  });
});

describe('url-safe helpers', () => {
  it('converts to the URL-safe alphabet and strips padding', () => {
    expect(toUrlSafe('ab+/cd==')).toBe('ab-_cd');
  });

  it('restores the standard alphabet and padding', () => {
    expect(fromUrlSafe('ab-_cd')).toBe('ab+/cd==');
  });

  it('leaves correctly-padded input alone', () => {
    expect(fromUrlSafe('Zm9v')).toBe('Zm9v');
  });
});
