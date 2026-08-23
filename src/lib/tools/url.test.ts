import { describe, it, expect } from 'vitest';
import { encodeUrl, decodeUrl, parseUrl, buildUrl } from './url';

describe('encodeUrl', () => {
  it('escapes reserved delimiters in component mode', () => {
    expect(encodeUrl('a=1&b=2', 'component')).toEqual({ ok: true, value: 'a%3D1%26b%3D2' });
  });

  it('preserves reserved delimiters in full-URL mode', () => {
    expect(encodeUrl('https://x.dev/a b?q=1', 'full')).toEqual({
      ok: true,
      value: 'https://x.dev/a%20b?q=1',
    });
  });

  it('encodes spaces as %20, not +', () => {
    expect(encodeUrl('a b')).toEqual({ ok: true, value: 'a%20b' });
  });

  it('encodes multi-byte characters as UTF-8 percent triplets', () => {
    expect(encodeUrl('é')).toEqual({ ok: true, value: '%C3%A9' });
  });

  it('rejects empty input', () => {
    expect(encodeUrl('').ok).toBe(false);
  });

  it('reports unpaired surrogates instead of throwing', () => {
    const result = encodeUrl('\uD800');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe('decodeUrl', () => {
  it('decodes percent-encoded text', () => {
    expect(decodeUrl('a%3D1%26b%3D2')).toEqual({ ok: true, value: 'a=1&b=2' });
  });

  it('decodes UTF-8 triplets', () => {
    expect(decodeUrl('%F0%9F%8E%89')).toEqual({ ok: true, value: '🎉' });
  });

  it('explains a malformed escape sequence', () => {
    const result = decodeUrl('%zz');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/hex/i);
  });

  it('rejects empty input', () => {
    expect(decodeUrl('').ok).toBe(false);
  });

  it('round-trips arbitrary text', () => {
    for (const sample of ['hello world', 'a=1&b=2', '🎉 é 日本語', '/path?x=y#z']) {
      const encoded = encodeUrl(sample);
      expect(encoded.ok).toBe(true);
      if (encoded.ok) expect(decodeUrl(encoded.value)).toEqual({ ok: true, value: sample });
    }
  });
});

describe('parseUrl', () => {
  it('breaks a URL into its parts', () => {
    const result = parseUrl('https://example.com:8443/a/b?x=1&y=2#frag');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        protocol: 'https',
        host: 'example.com',
        port: '8443',
        path: '/a/b',
        hash: 'frag',
      });
      expect(result.value.params).toEqual([
        { key: 'x', value: '1' },
        { key: 'y', value: '2' },
      ]);
    }
  });

  it('decodes percent-encoded query values', () => {
    const result = parseUrl('https://x.dev/?q=a%20b');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.params[0]).toEqual({ key: 'q', value: 'a b' });
  });

  it('handles repeated query keys', () => {
    const result = parseUrl('https://x.dev/?tag=a&tag=b');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.params).toHaveLength(2);
  });

  it('rejects a relative URL with an actionable message', () => {
    const result = parseUrl('/just/a/path');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/scheme/i);
  });

  it('rejects empty input', () => {
    expect(parseUrl('   ').ok).toBe(false);
  });
});

describe('buildUrl', () => {
  it('is the inverse of parseUrl for a URL with a port, query and hash', () => {
    const original = 'https://example.com:8443/a/b?x=1&y=2#frag';
    const parsed = parseUrl(original);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(buildUrl(parsed.value)).toBe(original);
  });

  it('re-encodes an edited parameter value', () => {
    const parsed = parseUrl('https://x.dev/?q=a');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const edited = buildUrl({
        ...parsed.value,
        params: [{ key: 'q', value: 'a b' }],
      });
      expect(edited).toBe('https://x.dev/?q=a+b');
    }
  });

  it('omits the query entirely once every parameter is removed', () => {
    const parsed = parseUrl('https://x.dev/path?x=1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(buildUrl({ ...parsed.value, params: [] })).toBe('https://x.dev/path');
    }
  });

  it('adds a new parameter', () => {
    const parsed = parseUrl('https://x.dev/');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const built = buildUrl({ ...parsed.value, params: [{ key: 'new', value: 'value' }] });
      expect(built).toBe('https://x.dev/?new=value');
    }
  });

  it('skips a row whose key is still empty, rather than emitting "?="', () => {
    const parsed = parseUrl('https://x.dev/');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const built = buildUrl({ ...parsed.value, params: [{ key: '', value: 'x' }] });
      expect(built).toBe('https://x.dev/');
    }
  });

  it('rebuilds without a port when none was set', () => {
    const parsed = parseUrl('https://x.dev/path');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(buildUrl(parsed.value)).toBe('https://x.dev/path');
  });
});
