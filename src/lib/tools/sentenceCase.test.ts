import { describe, expect, it } from 'vitest';
import { applySentenceCase } from './sentenceCase';

describe('applySentenceCase', () => {
  it('returns empty output for empty input', async () => {
    const result = await applySentenceCase('');
    expect(result).toEqual({ text: '', lowConfidenceRanges: [] });
  });

  it('returns whitespace-only input unchanged', async () => {
    const result = await applySentenceCase('   ');
    expect(result).toEqual({ text: '   ', lowConfidenceRanges: [] });
  });

  it('capitalizes known people, places and organizations regardless of source casing', async () => {
    const result = await applySentenceCase('john smith went to paris and google.');
    expect(result.text).toBe('John Smith went to Paris and Google.');
  });

  it('lowercases ordinary words while preserving sentence-start capitals', async () => {
    const result = await applySentenceCase('THE QUICK fox JUMPS over the lazy dog.');
    expect(result.text).toBe('The quick fox jumps over the lazy dog.');
  });

  it('capitalizes standalone "i" and its contractions, in any input casing', async () => {
    const result = await applySentenceCase("i think i'm right, i've seen it, i'll go, i'd rather not.");
    expect(result.text).toBe("I think I'm right, I've seen it, I'll go, I'd rather not.");
  });

  it('preserves acronyms in full caps instead of only capitalizing the first letter', async () => {
    const result = await applySentenceCase('the XML parser broke, said NASA.');
    expect(result.text).toBe('The XML parser broke, said NASA.');
  });

  it('flags a mid-sentence capitalized common word as low-confidence, not a known name', async () => {
    const result = await applySentenceCase('I saw a Fox in the yard.');
    expect(result.text).toBe('I saw a Fox in the yard.');
    const [range] = result.lowConfidenceRanges;
    expect(range).toBeDefined();
    expect(result.text.slice(range!.start, range!.end)).toBe('Fox');
    // "fox" is also an ordinary English word, so it gets the more specific reason.
    expect(range!.reason).toBe('commonWord');
  });

  it('flags a capitalized, unrecognized word as "unrecognized" rather than "commonWord"', async () => {
    const result = await applySentenceCase('I met Pramil yesterday.');
    const [range] = result.lowConfidenceRanges;
    expect(range).toBeDefined();
    expect(result.text.slice(range!.start, range!.end)).toBe('Pramil');
    expect(range!.reason).toBe('unrecognized');
  });

  it('does not flag a recognized name as low-confidence', async () => {
    const result = await applySentenceCase('Mary went to Paris.');
    expect(result.lowConfidenceRanges).toEqual([]);
  });

  it('does not flag "I" or its contractions as low-confidence', async () => {
    const result = await applySentenceCase("i'm here.");
    expect(result.lowConfidenceRanges).toEqual([]);
  });

  it('preserves whitespace and punctuation exactly, including multiple paragraphs', async () => {
    const input = 'First sentence.\n\nSecond   paragraph.  Third!';
    const result = await applySentenceCase(input);
    expect(result.text).toBe('First sentence.\n\nSecond   paragraph.  Third!');
  });

  it('handles Unicode and emoji without throwing', async () => {
    const result = await applySentenceCase('café NAÏVE test 🎉 done.');
    expect(() => result).not.toThrow();
    expect(result.text.startsWith('Café')).toBe(true);
  });

  it('handles a large input without throwing', async () => {
    const large = 'John went to Paris with Mary. THE WEATHER was Nice. '.repeat(300);
    const result = await applySentenceCase(large);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('leaves already-correct lowercase prose alone except sentence starts', async () => {
    const result = await applySentenceCase('the weather is nice today.');
    expect(result.text).toBe('The weather is nice today.');
  });
});
