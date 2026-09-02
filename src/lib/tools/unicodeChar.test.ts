import { describe, it, expect } from 'vitest';
import { describeCodePoint, parseCodePointQuery, formatUnicodeCharInfo, RENDERABLE_CATEGORIES } from './unicodeChar';

describe('parseCodePointQuery', () => {
  it('parses a single BMP character', () => {
    expect(parseCodePointQuery('A')).toBe(65);
    expect(parseCodePointQuery('é')).toBe(0xe9);
  });

  it('parses a single astral (surrogate-pair) character as one code point', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(emoji.length).toBe(2); // sanity check: two UTF-16 code units
    expect(parseCodePointQuery(emoji)).toBe(0x1f600);
  });

  it('parses a decimal code point', () => {
    expect(parseCodePointQuery('128512')).toBe(0x1f600);
  });

  it('parses hex code points in 0x, U+, \\u, and \\u{...} forms', () => {
    for (const query of ['0x1F600', 'U+1F600', '\\u1F600', '\\u{1F600}']) {
      expect(parseCodePointQuery(query), query).toBe(0x1f600);
    }
  });

  it('returns null for empty input', () => {
    expect(parseCodePointQuery('')).toBeNull();
    expect(parseCodePointQuery('   ')).toBeNull();
  });

  it('returns null for multi-character text', () => {
    expect(parseCodePointQuery('ab')).toBeNull();
    expect(parseCodePointQuery('hello')).toBeNull();
  });

  it('returns null for an out-of-range or surrogate-half code point', () => {
    expect(parseCodePointQuery('1200000')).toBeNull();
    expect(parseCodePointQuery('0xFFFFFF')).toBeNull();
    expect(parseCodePointQuery('55296')).toBeNull(); // 0xD800, a lone high-surrogate value
  });
});

describe('describeCodePoint', () => {
  it('describes a plain ASCII letter', () => {
    const info = describeCodePoint(65);
    expect(info).toMatchObject({
      codePoint: 65,
      hex: '0041',
      char: 'A',
      utf8Bytes: ['41'],
      utf16Units: ['0041'],
      category: 'Lu',
      categoryLabel: 'Uppercase Letter',
      script: 'Latin',
    });
  });

  it('describes a Latin-1 letter with a diacritic', () => {
    const info = describeCodePoint(0xe9); // é
    expect(info).toMatchObject({ category: 'Ll', categoryLabel: 'Lowercase Letter', script: 'Latin' });
    expect(info!.utf8Bytes).toEqual(['C3', 'A9']);
  });

  it('describes a non-Latin script letter', () => {
    const info = describeCodePoint(0x03b1); // Greek small letter alpha
    expect(info).toMatchObject({ char: 'α', category: 'Ll', script: 'Greek' });
  });

  it('describes a supplementary-plane character with correct UTF-8/UTF-16 encodings', () => {
    const info = describeCodePoint(0x1f600); // grinning face emoji
    expect(info).toMatchObject({
      hex: '1F600',
      utf8Bytes: ['F0', '9F', '98', '80'],
      utf16Units: ['D83D', 'DE00'],
    });
  });

  it('returns null for an invalid code point', () => {
    expect(describeCodePoint(-1)).toBeNull();
    expect(describeCodePoint(0x110000)).toBeNull();
    expect(describeCodePoint(0xd800)).toBeNull();
    expect(describeCodePoint(1.5)).toBeNull();
  });

  it('classifies a control character as Cc, not renderable', () => {
    const info = describeCodePoint(9); // Tab
    expect(info).toMatchObject({ category: 'Cc', categoryLabel: 'Control' });
    expect(RENDERABLE_CATEGORIES.has(info!.category)).toBe(false);
  });

  it('marks ordinary letters and symbols as renderable', () => {
    expect(RENDERABLE_CATEGORIES.has(describeCodePoint(65)!.category)).toBe(true);
    expect(RENDERABLE_CATEGORIES.has(describeCodePoint(0x1f600)!.category)).toBe(true);
  });
});

describe('formatUnicodeCharInfo', () => {
  it('formats a readable, copy-friendly block', () => {
    const info = describeCodePoint(65)!;
    expect(formatUnicodeCharInfo(info)).toBe(
      ['char: A', 'code point: U+0041 (65)', 'UTF-8: 41', 'UTF-16: 0041', 'category: Lu (Uppercase Letter)', 'script: Latin'].join('\n')
    );
  });
});
