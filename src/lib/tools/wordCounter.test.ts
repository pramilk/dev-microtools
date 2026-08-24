import { describe, expect, it } from 'vitest';
import {
  computeStats,
  convertCase,
  findMatches,
  replaceAll,
  toHighlightSegments,
  CASE_TYPES,
} from './wordCounter';

describe('computeStats', () => {
  it('returns all zeros for empty input', () => {
    const stats = computeStats('');
    expect(stats.words).toBe(0);
    expect(stats.characters).toBe(0);
    expect(stats.charactersNoSpaces).toBe(0);
    expect(stats.sentences).toBe(0);
    expect(stats.paragraphs).toBe(0);
    expect(stats.lines).toBe(0);
    expect(stats.uniqueWords).toBe(0);
    expect(stats.avgWordLength).toBe(0);
    expect(stats.avgSentenceLength).toBe(0);
    expect(stats.syllables).toBe(0);
    expect(stats.topWords).toEqual([]);
  });

  it('counts a single word', () => {
    const stats = computeStats('hello');
    expect(stats.words).toBe(1);
    expect(stats.characters).toBe(5);
    expect(stats.sentences).toBe(1);
    expect(stats.paragraphs).toBe(1);
    expect(stats.lines).toBe(1);
    expect(stats.uniqueWords).toBe(1);
  });

  it('counts words, sentences and characters in a short passage', () => {
    const stats = computeStats('Hello world. How are you? Fine!');
    expect(stats.words).toBe(6);
    expect(stats.sentences).toBe(3);
    expect(stats.charactersNoSpaces).toBeLessThan(stats.characters);
  });

  it('counts a trailing sentence fragment with no terminal punctuation', () => {
    expect(computeStats('One. Two').sentences).toBe(2);
  });

  it('counts paragraphs separated by blank lines', () => {
    const stats = computeStats('First paragraph.\n\nSecond paragraph.\n\n\nThird.');
    expect(stats.paragraphs).toBe(3);
  });

  it('counts lines by newline count', () => {
    expect(computeStats('a\nb\nc').lines).toBe(3);
    expect(computeStats('a\nb\n').lines).toBe(3);
  });

  it('counts unique words case-insensitively', () => {
    const stats = computeStats('Cat cat CAT dog');
    expect(stats.words).toBe(4);
    expect(stats.uniqueWords).toBe(2);
  });

  it('computes average word length and average sentence length', () => {
    const stats = computeStats('aa bb. cc dd ee.');
    expect(stats.avgWordLength).toBeCloseTo(2, 5);
    expect(stats.avgSentenceLength).toBeCloseTo(2.5, 5);
  });

  it('estimates syllables with a floor of 1 per word', () => {
    const stats = computeStats('a rhythm beautiful');
    expect(stats.syllables).toBeGreaterThanOrEqual(3);
  });

  it('computes reading and speaking time from word count', () => {
    const words = Array.from({ length: 200 }, () => 'word').join(' ');
    const stats = computeStats(words);
    expect(stats.readingTimeSeconds).toBe(60);
    expect(stats.speakingTimeSeconds).toBe(80);
  });

  it('ranks top words by frequency', () => {
    const stats = computeStats('apple apple banana apple banana cherry');
    expect(stats.topWords[0]).toEqual({ word: 'apple', count: 3 });
    expect(stats.topWords[1]).toEqual({ word: 'banana', count: 2 });
  });

  it('counts Unicode/emoji as single characters and handles Unicode letters as words', () => {
    const stats = computeStats('café 🎉 naïve');
    expect(stats.characters).toBe(Array.from('café 🎉 naïve').length);
    expect(stats.words).toBe(2); // "café" and "naïve" are words; the emoji is not a letter/number
  });

  it('handles very large input without throwing', () => {
    const large = 'The quick brown fox jumps over the lazy dog. '.repeat(20000);
    expect(() => computeStats(large)).not.toThrow();
    const stats = computeStats(large);
    expect(stats.words).toBeGreaterThan(100000);
  });
});

describe('convertCase', () => {
  const source = 'hello world example';

  it('never offers a "sentence" case type', () => {
    expect(CASE_TYPES).not.toContain('sentence');
  });

  it('converts to UPPERCASE and lowercase, preserving spacing', () => {
    expect(convertCase(source, 'upper')).toBe('HELLO WORLD EXAMPLE');
    expect(convertCase('HELLO World', 'lower')).toBe('hello world');
  });

  it('converts to Title Case, preserving original punctuation and spacing', () => {
    expect(convertCase("don't stop, believing!", 'title')).toBe("Don't Stop, Believing!");
  });

  it('keeps minor words (articles, short prepositions/conjunctions) lowercase in Title Case', () => {
    expect(convertCase('the lord of the rings', 'title')).toBe('The Lord of the Rings');
    expect(convertCase('a tale of two cities', 'title')).toBe('A Tale of Two Cities');
  });

  it('always capitalizes the first and last word in Title Case, even if it is a minor word', () => {
    expect(convertCase('to be or not to be', 'title')).toBe('To Be or Not to Be');
    expect(convertCase('of mice and men', 'title')).toBe('Of Mice and Men');
  });

  it('does not split a contraction across the apostrophe in Title Case', () => {
    expect(convertCase("it isn't over till it's over", 'title')).toBe("It Isn't Over Till It's Over");
  });

  it('converts prose to camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case and dot.case', () => {
    expect(convertCase(source, 'camel')).toBe('helloWorldExample');
    expect(convertCase(source, 'pascal')).toBe('HelloWorldExample');
    expect(convertCase(source, 'snake')).toBe('hello_world_example');
    expect(convertCase(source, 'constant')).toBe('HELLO_WORLD_EXAMPLE');
    expect(convertCase(source, 'kebab')).toBe('hello-world-example');
    expect(convertCase(source, 'dot')).toBe('hello.world.example');
  });

  it('re-splits an already camelCased identifier at its internal boundaries', () => {
    expect(convertCase('helloWorldExample', 'snake')).toBe('hello_world_example');
    expect(convertCase('HelloWorldExample', 'kebab')).toBe('hello-world-example');
  });

  it('splits acronym runs at the trailing lowercase boundary', () => {
    expect(convertCase('XMLParser', 'snake')).toBe('xml_parser');
  });

  it('round-trips every case type through every other case type without throwing', () => {
    let value = source;
    for (const type of CASE_TYPES) {
      value = convertCase(value, type);
      expect(() => convertCase(value, type)).not.toThrow();
    }
  });

  it('handles empty input for every case type', () => {
    for (const type of CASE_TYPES) {
      expect(convertCase('', type)).toBe('');
    }
  });
});

describe('findMatches / replaceAll / toHighlightSegments', () => {
  it('returns no matches for an empty query', () => {
    expect(findMatches('hello world', '', true)).toEqual([]);
  });

  it('finds case-sensitive matches', () => {
    const matches = findMatches('Cat cat CAT', 'cat', true);
    expect(matches).toEqual([{ start: 4, end: 7 }]);
  });

  it('finds case-insensitive matches', () => {
    const matches = findMatches('Cat cat CAT', 'cat', false);
    expect(matches).toHaveLength(3);
  });

  it('finds adjacent, non-overlapping matches', () => {
    const matches = findMatches('aaaa', 'aa', true);
    expect(matches).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('replaces all occurrences', () => {
    expect(replaceAll('cat cat cat', 'cat', 'dog', true)).toBe('dog dog dog');
  });

  it('leaves text unchanged when there are no matches', () => {
    expect(replaceAll('hello world', 'xyz', 'abc', true)).toBe('hello world');
  });

  it('replaces case-insensitively when requested', () => {
    expect(replaceAll('Cat cat CAT', 'cat', 'dog', false)).toBe('dog dog dog');
  });

  it('builds highlight segments around matches', () => {
    const matches = findMatches('a cat sat', 'at', true);
    const segments = toHighlightSegments('a cat sat', matches);
    expect(segments.map((s) => s.text).join('')).toBe('a cat sat');
    expect(segments.filter((s) => s.isMatch).map((s) => s.text)).toEqual(['at', 'at']);
  });

  it('returns a single unmatched segment when there are no matches', () => {
    expect(toHighlightSegments('hello', [])).toEqual([{ text: 'hello', isMatch: false }]);
  });

  it('returns no segments for empty text', () => {
    expect(toHighlightSegments('', [])).toEqual([]);
  });
});
