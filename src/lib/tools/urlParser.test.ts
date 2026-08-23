import { describe, it, expect } from 'vitest';
import { parseUrl, rebuildUrl } from './urlParser';

describe('parseUrl', () => {
  it('decomposes a URL with every component populated', () => {
    const result = parseUrl('https://user:pass@sub.example.com:8080/some/path?a=1&b=2&a=3#section');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.href).toBe(
      'https://user:pass@sub.example.com:8080/some/path?a=1&b=2&a=3#section'
    );
    expect(result.value.protocol).toBe('https:');
    expect(result.value.origin).toBe('https://sub.example.com:8080');
    expect(result.value.username).toBe('user');
    expect(result.value.password).toBe('pass');
    expect(result.value.hostname).toBe('sub.example.com');
    expect(result.value.port).toBe('8080');
    expect(result.value.pathname).toBe('/some/path');
    expect(result.value.search).toBe('?a=1&b=2&a=3');
    expect(result.value.hash).toBe('#section');
    expect(result.value.queryParams).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'a', value: '3' },
    ]);
  });

  it('does not collapse duplicate query keys into one entry', () => {
    const result = parseUrl('https://x.dev/?a=1&b=2&a=3');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.queryParams).toHaveLength(3);
  });

  it('rejects a URL with no scheme', () => {
    const result = parseUrl('example.com/foo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/scheme/i);
  });

  it('rejects empty input', () => {
    const result = parseUrl('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('rejects whitespace-only input', () => {
    expect(parseUrl('   ').ok).toBe(false);
  });

  it('returns empty strings/array for a URL with no query string or fragment', () => {
    const result = parseUrl('https://example.com/path');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.search).toBe('');
      expect(result.value.hash).toBe('');
      expect(result.value.queryParams).toEqual([]);
      expect(result.value.username).toBe('');
      expect(result.value.password).toBe('');
      expect(result.value.port).toBe('');
    }
  });

  it('handles percent-encoded and Unicode characters in the path', () => {
    const result = parseUrl('https://example.com/caf%C3%A9/日本語?q=%E2%9C%93');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pathname).toContain('caf%C3%A9');
      expect(result.value.queryParams).toEqual([{ key: 'q', value: '✓' }]);
    }
  });

  it('handles an IDN hostname by converting it to punycode', () => {
    const result = parseUrl('https://münchen.example/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hostname).toBe('xn--mnchen-3ya.example');
  });

  it('parses a very long URL with many query parameters', () => {
    const params = Array.from({ length: 500 }, (_, i) => `p${i}=v${i}`).join('&');
    const result = parseUrl(`https://example.com/big?${params}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queryParams).toHaveLength(500);
      expect(result.value.queryParams[0]).toEqual({ key: 'p0', value: 'v0' });
      expect(result.value.queryParams[499]).toEqual({ key: 'p499', value: 'v499' });
    }
  });

  it('leaves port empty for the default port even though it is effectively 443', () => {
    const result = parseUrl('https://example.com:443/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.port).toBe('');
  });
});

describe('rebuildUrl', () => {
  it('replaces the query string with the given params, preserving array order for duplicate keys', () => {
    const result = rebuildUrl('https://example.com/path?old=1#frag', [
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'a', value: '3' },
    ]);
    expect(result).toEqual({ ok: true, value: 'https://example.com/path?a=1&b=2&a=3#frag' });
  });

  it('adds a new key not present in the original URL', () => {
    const result = rebuildUrl('https://example.com/', [{ key: 'new', value: 'value' }]);
    expect(result).toEqual({ ok: true, value: 'https://example.com/?new=value' });
  });

  it('removes the query string entirely when given an empty params array', () => {
    const result = rebuildUrl('https://example.com/path?x=1&y=2', []);
    expect(result).toEqual({ ok: true, value: 'https://example.com/path' });
  });

  it('skips a row whose key is empty, rather than emitting "?="', () => {
    const result = rebuildUrl('https://example.com/', [{ key: '', value: 'x' }]);
    expect(result).toEqual({ ok: true, value: 'https://example.com/' });
  });

  it('percent-encodes an edited value', () => {
    const result = rebuildUrl('https://example.com/?q=a', [{ key: 'q', value: 'a b&c' }]);
    expect(result).toEqual({ ok: true, value: 'https://example.com/?q=a+b%26c' });
  });

  it('rejects an invalid base URL with the same error as parseUrl', () => {
    const result = rebuildUrl('not-a-url', [{ key: 'a', value: '1' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/scheme/i);
  });

  it('rejects empty base input', () => {
    expect(rebuildUrl('', []).ok).toBe(false);
  });

  it('preserves the fragment untouched while replacing only the query', () => {
    const result = rebuildUrl('https://example.com/page#section-2', [{ key: 'a', value: '1' }]);
    expect(result).toEqual({ ok: true, value: 'https://example.com/page?a=1#section-2' });
  });
});
