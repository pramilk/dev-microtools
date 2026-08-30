import { describe, it, expect, vi } from 'vitest';
import {
  countExactly,
  isEncodingLoaded,
  ENCODING_DOWNLOAD_KB,
  ENCODING_LABELS,
} from './exactTokenizer';

describe('countExactly', () => {
  it('reports a vocabulary as unloaded before anything asks for it', () => {
    // Must stay the first test in this file: every case below loads o200k_base.
    expect(isEncodingLoaded('o200k_base')).toBe(false);
  });

  it('returns zero for empty input without downloading anything', async () => {
    const result = await countExactly('', 'o200k_base');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(0);
      expect(result.value.pieces).toEqual([]);
    }
    expect(isEncodingLoaded('o200k_base')).toBe(false);
  });

  it('counts a known string exactly', async () => {
    const result = await countExactly('Hello world', 'o200k_base');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBe(2);
  });

  it('counts a pangram exactly', async () => {
    const result = await countExactly('The quick brown fox jumps over the lazy dog.', 'o200k_base');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBe(10);
  });

  it('caches the vocabulary after the first use', async () => {
    await countExactly('warm the cache', 'o200k_base');
    expect(isEncodingLoaded('o200k_base')).toBe(true);
  });

  it('returns one decoded piece per token, which reassembles into the original text', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const result = await countExactly(text, 'o200k_base');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pieces).toHaveLength(result.value.total);
    expect(result.value.pieces.map((piece) => piece.text).join('')).toBe(text);
    expect(result.value.piecesTruncated).toBe(false);
  });

  it('gives every piece a numeric vocabulary id', async () => {
    const result = await countExactly('token ids are numbers', 'o200k_base');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const piece of result.value.pieces) expect(Number.isInteger(piece.id)).toBe(true);
  });

  it('reassembles multi-byte characters and emoji', async () => {
    const text = 'Hello 你好 🎉 world';
    const result = await countExactly(text, 'o200k_base');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.pieces.map((p) => p.text).join('')).toBe(text);
  });

  it('counts the two published encodings differently for non-Latin text', async () => {
    const text = 'Привет, мир! Это тестовый абзац на русском языке.';
    const [modern, legacy] = await Promise.all([
      countExactly(text, 'o200k_base'),
      countExactly(text, 'cl100k_base'),
    ]);
    expect(modern.ok && legacy.ok).toBe(true);
    if (modern.ok && legacy.ok) expect(legacy.value.total).toBeGreaterThan(modern.value.total);
  });

  it('truncates the pieces list but still reports the full total', async () => {
    const text = 'word '.repeat(500);
    const result = await countExactly(text, 'o200k_base', { maxPieces: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pieces).toHaveLength(25);
    expect(result.value.piecesTruncated).toBe(true);
    expect(result.value.total).toBeGreaterThan(25);
  });

  it('handles a large input', async () => {
    const result = await countExactly('The quick brown fox jumps over the lazy dog. '.repeat(2000), 'o200k_base');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBeGreaterThan(15_000);
  });
});

describe('the encoding metadata the UI shows before downloading', () => {
  it('quotes a download size for every encoding', () => {
    expect(ENCODING_DOWNLOAD_KB.o200k_base).toBeGreaterThan(0);
    expect(ENCODING_DOWNLOAD_KB.cl100k_base).toBeGreaterThan(0);
    // The newer vocabulary is roughly twice the size; the UI's warning depends on it.
    expect(ENCODING_DOWNLOAD_KB.o200k_base).toBeGreaterThan(ENCODING_DOWNLOAD_KB.cl100k_base);
  });

  it('names the models each encoding covers', () => {
    expect(ENCODING_LABELS.o200k_base).toContain('o200k_base');
    expect(ENCODING_LABELS.cl100k_base).toContain('cl100k_base');
  });
});

describe('when the vocabulary download fails', () => {
  it('returns a message that points at the working fallback, not a thrown error', async () => {
    vi.resetModules();
    vi.doMock('gpt-tokenizer/encoding/cl100k_base', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });

    const { countExactly: countWithBrokenDownload } = await import('./exactTokenizer');
    const result = await countWithBrokenDownload('some text', 'cl100k_base');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/estimate/i);

    vi.doUnmock('gpt-tokenizer/encoding/cl100k_base');
    vi.resetModules();
  });
});
