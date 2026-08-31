import { describe, it, expect } from 'vitest';
import { generateSlug, DEFAULT_SLUG_OPTIONS, MAX_SLUG_LENGTH } from './slug';

describe('generateSlug', () => {
  it('lowercases and hyphenates a typical title', () => {
    const result = generateSlug('Hello World!', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'hello-world' });
  });

  it('strips accents from Latin letters', () => {
    const result = generateSlug('Café au Lait', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'cafe-au-lait' });
  });

  it('substitutes common symbols with words', () => {
    const result = generateSlug('Rock & Roll', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'rock-and-roll' });
  });

  it('collapses runs of punctuation and whitespace into a single separator', () => {
    const result = generateSlug('  Too   many---spaces!!  ', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'too-many-spaces' });
  });

  it('uses an underscore separator when requested', () => {
    const result = generateSlug('Hello World', { ...DEFAULT_SLUG_OPTIONS, separator: '_' });
    expect(result).toEqual({ ok: true, value: 'hello_world' });
  });

  it('preserves case when lowercase is off', () => {
    const result = generateSlug('Hello World', { ...DEFAULT_SLUG_OPTIONS, lowercase: false });
    expect(result).toEqual({ ok: true, value: 'Hello-World' });
  });

  it('keeps numbers', () => {
    const result = generateSlug('Top 10 Tips for 2026', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'top-10-tips-for-2026' });
  });

  it('truncates to maxLength without cutting a word in half', () => {
    const result = generateSlug('one two three four five', { ...DEFAULT_SLUG_OPTIONS, maxLength: 12 });
    expect(result).toEqual({ ok: true, value: 'one-two' });
  });

  it('hard-cuts when the first word alone exceeds maxLength', () => {
    const result = generateSlug('supercalifragilisticexpialidocious word', { ...DEFAULT_SLUG_OPTIONS, maxLength: 10 });
    expect(result).toEqual({ ok: true, value: 'supercalif' });
  });

  it('rejects empty input', () => {
    const result = generateSlug('   ', DEFAULT_SLUG_OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('rejects a negative maxLength', () => {
    const result = generateSlug('hello', { ...DEFAULT_SLUG_OPTIONS, maxLength: -1 });
    expect(result.ok).toBe(false);
  });

  it('rejects a maxLength above the limit', () => {
    const result = generateSlug('hello', { ...DEFAULT_SLUG_OPTIONS, maxLength: MAX_SLUG_LENGTH + 1 });
    expect(result.ok).toBe(false);
  });

  it('errors when nothing survives slugifying, e.g. a non-Latin script', () => {
    const result = generateSlug('日本語のテキスト', DEFAULT_SLUG_OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no characters left/i);
  });

  it('strips leading and trailing separators', () => {
    const result = generateSlug('---Hello World---', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'hello-world' });
  });

  it('handles emoji and other symbols by dropping them', () => {
    const result = generateSlug('Great news 🎉 today', DEFAULT_SLUG_OPTIONS);
    expect(result).toEqual({ ok: true, value: 'great-news-today' });
  });
});
