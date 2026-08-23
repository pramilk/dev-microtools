import { describe, it, expect } from 'vitest';
import {
  encodeShareState,
  decodeShareState,
  buildShareUrl,
  extractShareFragment,
  readShareStateFromLocation,
  MAX_SHARE_URL_LENGTH,
} from './shareLink';

describe('encodeShareState / decodeShareState', () => {
  it('round-trips a simple object', async () => {
    const state = { input: 'hello', flags: 'gi' };
    const encoded = await encodeShareState(state);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = await decodeShareState<typeof state>(encoded.value);
    expect(decoded).toEqual({ ok: true, value: state });
  });

  it('round-trips Unicode content', async () => {
    const state = { text: '日本語 🎉 émoji' };
    const encoded = await encodeShareState(state);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = await decodeShareState<typeof state>(encoded.value);
    expect(decoded).toEqual({ ok: true, value: state });
  });

  it('produces a URL-safe string with no padding or reserved characters', async () => {
    const encoded = await encodeShareState({ text: 'a'.repeat(500) });
    expect(encoded.ok).toBe(true);
    if (encoded.ok) expect(encoded.value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reports corrupted input instead of throwing', async () => {
    const result = await decodeShareState('not-valid-gzip-data!!!');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty fragment', async () => {
    expect((await decodeShareState('')).ok).toBe(false);
  });
});

describe('buildShareUrl', () => {
  it('produces a URL containing the encoded fragment', async () => {
    const result = await buildShareUrl('https://example.com/regex-tester/', { pattern: 'a+' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/^https:\/\/example\.com\/regex-tester\/#s=/);
    }
  });

  it('refuses to build a link beyond the safe length, rather than truncating it', async () => {
    const result = await buildShareUrl('https://example.com/json-formatter/', {
      // Repetitive text compresses extremely well, so use noise that gzip cannot shrink.
      input: Array.from({ length: 20_000 }, () => Math.random().toString(36)).join(''),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large to share/i);
  });

  it('the round-tripped URL, once built, stays within the documented limit', async () => {
    const result = await buildShareUrl('https://example.com/diff-checker/', {
      left: 'line one\nline two\n',
      right: 'line one\nline three\n',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
  });
});

describe('extractShareFragment', () => {
  it('extracts the payload from a hash with the leading #', () => {
    expect(extractShareFragment('#s=abc123')).toBe('abc123');
  });

  it('extracts the payload from a bare fragment with no leading #', () => {
    expect(extractShareFragment('s=abc123')).toBe('abc123');
  });

  it('returns null for a hash that is not a share fragment', () => {
    expect(extractShareFragment('#something-else')).toBeNull();
  });

  it('returns null for an empty hash', () => {
    expect(extractShareFragment('')).toBeNull();
  });
});

describe('readShareStateFromLocation', () => {
  it('returns null when the location has no share fragment', async () => {
    window.location.hash = '';
    expect(await readShareStateFromLocation()).toBeNull();
  });

  it('reads and decodes a share fragment from the current location', async () => {
    const encoded = await encodeShareState({ input: 'from location' });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    const result = await readShareStateFromLocation<{ input: string }>();
    expect(result).toEqual({ ok: true, value: { input: 'from location' } });

    window.location.hash = '';
  });
});
