import { describe, expect, it } from 'vitest';
import { COMMON_ENGLISH_WORDS } from './commonEnglishWords';

describe('COMMON_ENGLISH_WORDS', () => {
  it('contains exactly 10,000 entries', () => {
    expect(COMMON_ENGLISH_WORDS.size).toBe(10000);
  });

  it('contains only lowercase entries, with no duplicates or blank lines', () => {
    for (const word of COMMON_ENGLISH_WORDS) {
      expect(word).toBe(word.toLowerCase());
      expect(word.trim()).toBe(word);
      expect(word).not.toBe('');
    }
  });

  it('contains common everyday words used by sentenceCase.ts as the "commonWord" signal', () => {
    expect(COMMON_ENGLISH_WORDS.has('the')).toBe(true);
    expect(COMMON_ENGLISH_WORDS.has('name')).toBe(true);
    expect(COMMON_ENGLISH_WORDS.has('fox')).toBe(true);
    expect(COMMON_ENGLISH_WORDS.has('dog')).toBe(true);
  });

  it('does not contain an arbitrary made-up word', () => {
    expect(COMMON_ENGLISH_WORDS.has('zzzznotarealword')).toBe(false);
  });
});
