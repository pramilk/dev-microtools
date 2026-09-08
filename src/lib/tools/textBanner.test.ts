import { describe, it, expect } from 'vitest';
import {
  renderTextBanner,
  validateFillChar,
  DEFAULT_TEXT_BANNER_OPTIONS,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MAX_LINE_LENGTH,
  MAX_LINES,
  SUPPORTED_CHARACTERS,
} from './textBanner';

describe('validateFillChar', () => {
  it('accepts a single visible character', () => {
    expect(validateFillChar('#')).toEqual({ ok: true, value: '#' });
  });

  it('rejects an empty string', () => {
    expect(validateFillChar('').ok).toBe(false);
  });

  it('rejects more than one character', () => {
    expect(validateFillChar('##').ok).toBe(false);
  });

  it('rejects a blank space', () => {
    expect(validateFillChar(' ').ok).toBe(false);
  });

  it('accepts a single astral-plane character without splitting its surrogate pair', () => {
    expect(validateFillChar('🔥')).toEqual({ ok: true, value: '🔥' });
  });
});

describe('renderTextBanner', () => {
  it('rejects empty input', () => {
    const result = renderTextBanner('', DEFAULT_TEXT_BANNER_OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('rejects whitespace-only input', () => {
    const result = renderTextBanner('   ', DEFAULT_TEXT_BANNER_OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid fill character', () => {
    const result = renderTextBanner('HI', { ...DEFAULT_TEXT_BANNER_OPTIONS, fillChar: '' });
    expect(result.ok).toBe(false);
  });

  it('renders a single letter at exactly the glyph height, in rows of glyph width', () => {
    const result = renderTextBanner('I', { ...DEFAULT_TEXT_BANNER_OPTIONS, fillChar: '#', scale: 1, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.value.output.split('\n');
    expect(rows).toHaveLength(GLYPH_HEIGHT);
    // 'I' is a solid column down the middle at every row, so its widest row (top/bottom bar)
    // is exactly GLYPH_WIDTH fill characters with no spacing added (single letter, no gap).
    expect(rows[0]).toBe('#'.repeat(GLYPH_WIDTH));
  });

  it('uses the requested fill character for ink cells', () => {
    const result = renderTextBanner('I', { ...DEFAULT_TEXT_BANNER_OPTIONS, fillChar: '@', scale: 1, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.output.split('\n')[0]).toBe('@'.repeat(GLYPH_WIDTH));
  });

  it('inserts letterSpacing blank columns between letters but not after the last one', () => {
    const withGap = renderTextBanner('II', { ...DEFAULT_TEXT_BANNER_OPTIONS, fillChar: '#', scale: 1, letterSpacing: 2 });
    expect(withGap.ok).toBe(true);
    if (!withGap.ok) return;
    const topRow = withGap.value.output.split('\n')[0]!;
    // Two 5-wide glyphs plus a 2-column gap between them, nothing trailing.
    expect(topRow).toBe('#####' + '  ' + '#####');
  });

  it('scales every cell by the requested factor in both directions', () => {
    const result = renderTextBanner('I', { ...DEFAULT_TEXT_BANNER_OPTIONS, fillChar: '#', scale: 3, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.value.output.split('\n');
    expect(rows).toHaveLength(GLYPH_HEIGHT * 3);
    expect(rows[0]).toBe('#'.repeat(GLYPH_WIDTH * 3));
  });

  it('renders lowercase input using the uppercase glyph', () => {
    const lower = renderTextBanner('i', { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
    const upper = renderTextBanner('I', { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
    expect(lower).toEqual(upper);
  });

  it('renders an unsupported character as a blank cell and reports it once', () => {
    const result = renderTextBanner('I~~I', { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unsupportedCharacters).toEqual(['~']);
    const rows = result.value.output.split('\n');
    // 'I', blank, blank, 'I' => width GLYPH_WIDTH*4, and the blank columns carry no ink.
    expect(rows[0]!.length).toBeLessThanOrEqual(GLYPH_WIDTH * 4);
    expect(rows[3]).not.toContain('#'); // the middle row of 'I' is a thin single dot, not ###
  });

  it('stacks multiple lines, each at full glyph height, in order', () => {
    const result = renderTextBanner('I\nI', { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.output.split('\n')).toHaveLength(GLYPH_HEIGHT * 2);
  });

  it('renders a blank input line as a single blank output line', () => {
    const result = renderTextBanner('I\n\nI', { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.output.split('\n')).toHaveLength(GLYPH_HEIGHT + 1 + GLYPH_HEIGHT);
  });

  it('rejects more than the maximum number of lines', () => {
    const text = new Array(MAX_LINES + 1).fill('A').join('\n');
    const result = renderTextBanner(text, DEFAULT_TEXT_BANNER_OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('rejects a line longer than the maximum', () => {
    const result = renderTextBanner('A'.repeat(MAX_LINE_LENGTH + 1), DEFAULT_TEXT_BANNER_OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('accepts a line at exactly the maximum length', () => {
    const result = renderTextBanner('A'.repeat(MAX_LINE_LENGTH), DEFAULT_TEXT_BANNER_OPTIONS);
    expect(result.ok).toBe(true);
  });

  it('has a glyph for every character it advertises as supported, each of the correct shape', () => {
    for (const char of SUPPORTED_CHARACTERS) {
      const result = renderTextBanner(char, { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.unsupportedCharacters).toEqual([]);
      const rows = result.value.output.split('\n');
      expect(rows).toHaveLength(GLYPH_HEIGHT);
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(GLYPH_WIDTH);
    }
  });

  it('renders digits via their font glyph despite the numeric object keys', () => {
    const result = renderTextBanner('0123456789', { ...DEFAULT_TEXT_BANNER_OPTIONS, scale: 1, letterSpacing: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unsupportedCharacters).toEqual([]);
  });

  it('is deterministic for the same input and options', () => {
    const a = renderTextBanner('HELLO WORLD', DEFAULT_TEXT_BANNER_OPTIONS);
    const b = renderTextBanner('HELLO WORLD', DEFAULT_TEXT_BANNER_OPTIONS);
    expect(a).toEqual(b);
  });
});
