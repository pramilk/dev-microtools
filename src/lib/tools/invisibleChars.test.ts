import { describe, it, expect } from 'vitest';
import {
  scanText,
  computeStats,
  cleanText,
  toInspectSegments,
  describeHomoglyphRisk,
  formatCodePoint,
  DEFAULT_CLEAN_OPTIONS,
  type CleanOptions,
} from './invisibleChars';

/*
 * Every special character below is built from its numeric code point via
 * String.fromCodePoint rather than pasted as a raw glyph, deliberately: this is a test
 * file for a tool whose whole point is that hidden bidi/invisible/homoglyph characters
 * shouldn't live unannounced inside a source file, including this repo's own. Building
 * them from plain ASCII digits keeps the file itself unambiguous and diff-safe while
 * still exercising the real code point at runtime.
 */
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

const ZWSP = cp(0x200b);
const BOM = cp(0xfeff);
const VS16 = cp(0xfe0f);
const RLO = cp(0x202e);
const PDF = cp(0x202c);
const NBSP = cp(0x00a0);
const LSEP = cp(0x2028);
const BEL = cp(0x07);
const DEL = cp(0x7f);
const NEL = cp(0x85);
const CYRILLIC_A = cp(0x0430);
const GREEK_ALPHA = cp(0x0391);
const FULLWIDTH_A = cp(0xff21);
const ZWJ = cp(0x200d);
const EMOJI_MAN = cp(0x1f468);
const EMOJI_WOMAN = cp(0x1f469);
const EMOJI_GIRL = cp(0x1f467);
const EMOJI_GRINNING = cp(0x1f600);
const CYRILLIC_NO_HOMOGLYPHS = [0x0436, 0x0438, 0x0437, 0x043d, 0x044c].map(cp).join('');

describe('scanText', () => {
  it('finds nothing in plain ASCII text', () => {
    expect(scanText('Hello, world! 123.')).toEqual([]);
  });

  it('does not flag tab, newline, or carriage return', () => {
    expect(scanText('a\tb\nc\rd')).toEqual([]);
  });

  it('does not flag a plain ASCII space', () => {
    expect(scanText('one two three')).toEqual([]);
  });

  it('flags a zero-width space as invisible', () => {
    const found = scanText(`a${ZWSP}b`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ index: 1, category: 'invisible', abbr: 'ZWSP', codePoint: 0x200b, replacement: '' });
  });

  it('flags a byte-order mark as invisible', () => {
    const found = scanText(`${BOM}hello`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ index: 0, category: 'invisible', abbr: 'BOM' });
  });

  it('flags a variation selector by computed name', () => {
    const found = scanText(`x${VS16}y`);
    expect(found[0]).toMatchObject({ category: 'invisible', name: 'VARIATION SELECTOR-16', abbr: 'VS16' });
  });

  it('flags a right-to-left override as bidi, with no replacement', () => {
    const found = scanText(`safe${RLO}file.exe${PDF}`);
    const rlo = found.find((f) => f.abbr === 'RLO');
    const pdf = found.find((f) => f.abbr === 'PDF');
    expect(rlo).toMatchObject({ category: 'bidi', replacement: '' });
    expect(pdf).toMatchObject({ category: 'bidi', replacement: '' });
  });

  it('flags a non-breaking space as whitespace, replaced with a plain space', () => {
    const found = scanText(`a${NBSP}b`);
    expect(found[0]).toMatchObject({ category: 'whitespace', abbr: 'NBSP', replacement: ' ' });
  });

  it('replaces a line separator with a newline, not a space', () => {
    const found = scanText(`a${LSEP}b`);
    expect(found[0]).toMatchObject({ category: 'whitespace', abbr: 'LSEP', replacement: '\n' });
  });

  it('flags a raw control character other than tab/newline/CR', () => {
    const found = scanText(`a${BEL}b`);
    expect(found[0]).toMatchObject({ category: 'control', abbr: 'BEL', replacement: '' });
  });

  it('flags DEL', () => {
    const found = scanText(`a${DEL}b`);
    expect(found[0]).toMatchObject({ category: 'control', abbr: 'DEL' });
  });

  it('flags a C1 control character', () => {
    const found = scanText(`a${NEL}b`);
    expect(found[0]).toMatchObject({ category: 'control' });
  });

  it('flags a Cyrillic homoglyph with its ASCII look-alike as the replacement', () => {
    const found = scanText(`p${CYRILLIC_A}ypal.com`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ category: 'homoglyph', codePoint: 0x0430, replacement: 'a' });
  });

  it('flags a Greek homoglyph', () => {
    const found = scanText(`${GREEK_ALPHA}pple`);
    expect(found[0]).toMatchObject({ category: 'homoglyph', replacement: 'A' });
  });

  it('flags a fullwidth Latin letter via the formula, not a lookup table', () => {
    const found = scanText(`${FULLWIDTH_A}BC`);
    expect(found[0]).toMatchObject({ category: 'homoglyph', replacement: 'A', name: 'FULLWIDTH LATIN CAPITAL LETTER A' });
  });

  it('does not flag ordinary Cyrillic letters that have no Latin look-alike', () => {
    expect(scanText(CYRILLIC_NO_HOMOGLYPHS)).toEqual([]);
  });

  it('flags a zero-width joiner even inside a legitimate emoji sequence', () => {
    // Family emoji: man + ZWJ + woman + ZWJ + girl. Documented, not a bug: an
    // "invisible character" inspector has no way to know a ZWJ is meaningful here.
    const found = scanText(`${EMOJI_MAN}${ZWJ}${EMOJI_WOMAN}${ZWJ}${EMOJI_GIRL}`);
    expect(found.filter((f) => f.abbr === 'ZWJ')).toHaveLength(2);
  });

  it('reports the correct UTF-16 index after a character outside the BMP', () => {
    const found = scanText(`${EMOJI_GRINNING}${ZWSP}`);
    expect(found[0]!.index).toBe(2);
  });
});

describe('computeStats', () => {
  it('counts code points, not UTF-16 code units, and totals bytes', () => {
    const text = EMOJI_GRINNING;
    const stats = computeStats(text, scanText(text));
    expect(stats.totalCodePoints).toBe(1);
    expect(stats.totalBytes).toBe(4);
    expect(stats.total).toBe(0);
  });

  it('buckets found characters by category', () => {
    const text = `a${ZWSP}b${RLO}c${PDF}d${NBSP}e${BEL}f${CYRILLIC_A}g`;
    const found = scanText(text);
    const stats = computeStats(text, found);
    expect(stats.total).toBe(found.length);
    expect(stats.byCategory.invisible).toBe(1);
    expect(stats.byCategory.bidi).toBe(2);
    expect(stats.byCategory.whitespace).toBe(1);
    expect(stats.byCategory.control).toBe(1);
    expect(stats.byCategory.homoglyph).toBe(1);
  });
});

describe('cleanText', () => {
  it('returns the input unchanged when nothing was found', () => {
    expect(cleanText('hello', [], DEFAULT_CLEAN_OPTIONS)).toBe('hello');
  });

  it('strips invisible/bidi/control characters and normalizes whitespace by default', () => {
    const text = `a${ZWSP}b${RLO}c${PDF}d${NBSP}ef`;
    const cleaned = cleanText(text, scanText(text), DEFAULT_CLEAN_OPTIONS);
    expect(cleaned).toBe('abcd ef');
  });

  it('leaves homoglyphs untouched by default (opt-in only)', () => {
    const text = `p${CYRILLIC_A}ypal.com`;
    expect(cleanText(text, scanText(text), DEFAULT_CLEAN_OPTIONS)).toBe(text);
  });

  it('replaces homoglyphs with their ASCII look-alike when enabled', () => {
    const text = `p${CYRILLIC_A}ypal.com`;
    const options: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS, homoglyph: true };
    expect(cleanText(text, scanText(text), options)).toBe('paypal.com');
  });

  it('leaves a category untouched when its option is off', () => {
    const text = `a${ZWSP}b`;
    const options: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS, invisible: false };
    expect(cleanText(text, scanText(text), options)).toBe(text);
  });

  it('handles two adjacent flagged characters', () => {
    const text = `a${ZWSP}${ZWSP}b`;
    expect(cleanText(text, scanText(text), DEFAULT_CLEAN_OPTIONS)).toBe('ab');
  });

  it('handles a flagged character at the very start and end of the string', () => {
    const text = `${ZWSP}ab${ZWSP}`;
    expect(cleanText(text, scanText(text), DEFAULT_CLEAN_OPTIONS)).toBe('ab');
  });

  it('replaces a line separator with an actual newline when cleaned', () => {
    const text = `a${LSEP}b`;
    expect(cleanText(text, scanText(text), DEFAULT_CLEAN_OPTIONS)).toBe('a\nb');
  });
});

describe('toInspectSegments', () => {
  it('returns one unmatched segment for plain text', () => {
    expect(toInspectSegments('hello', [])).toEqual([{ text: 'hello', found: null }]);
  });

  it('returns an empty array for empty text', () => {
    expect(toInspectSegments('', [])).toEqual([]);
  });

  it('splits around a single flagged character', () => {
    const text = `a${ZWSP}b`;
    const segments = toInspectSegments(text, scanText(text));
    expect(segments.map((s) => s.text)).toEqual(['a', ZWSP, 'b']);
    expect(segments[0]!.found).toBeNull();
    expect(segments[1]!.found).not.toBeNull();
    expect(segments[2]!.found).toBeNull();
  });

  it('handles a flagged character at the very start with no leading unmatched run', () => {
    const text = `${ZWSP}ab`;
    const segments = toInspectSegments(text, scanText(text));
    expect(segments[0]!.text).toBe(ZWSP);
    expect(segments[0]!.found).not.toBeNull();
  });

  it('handles two adjacent flagged characters with no gap between them', () => {
    const text = `${ZWSP}${RLO}`;
    const segments = toInspectSegments(text, scanText(text));
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.found !== null)).toBe(true);
  });
});

describe('describeHomoglyphRisk', () => {
  it('returns null when no homoglyphs were found', () => {
    expect(describeHomoglyphRisk('hello world', [])).toBeNull();
  });

  it('warns about likely spoofing when the text is mostly ASCII', () => {
    const text = `p${CYRILLIC_A}ypal-support.com`;
    const risk = describeHomoglyphRisk(text, scanText(text));
    expect(risk?.level).toBe('warning');
    expect(risk?.message).toMatch(/mostly plain ASCII/i);
  });

  it('reads as informational when the text is mostly non-Latin script', () => {
    const text = `${CYRILLIC_NO_HOMOGLYPHS} ${CYRILLIC_A}`;
    const risk = describeHomoglyphRisk(text, scanText(text));
    expect(risk?.level).toBe('info');
    expect(risk?.message).toMatch(/genuine text/i);
  });
});

describe('formatCodePoint', () => {
  it('formats as U+XXXX, uppercase, zero-padded to 4 digits', () => {
    expect(formatCodePoint(0x200b)).toBe('U+200B');
    expect(formatCodePoint(0x7)).toBe('U+0007');
    expect(formatCodePoint(0x1f600)).toBe('U+1F600');
  });
});
