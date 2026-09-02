import { describe, it, expect } from 'vitest';
import { ASCII_TABLE, searchAsciiTable, formatAsciiEntry, formatAsciiTable } from './asciiTable';

describe('ASCII_TABLE', () => {
  it('has exactly 128 entries, indexed 0-127 in order', () => {
    expect(ASCII_TABLE).toHaveLength(128);
    ASCII_TABLE.forEach((entry, index) => expect(entry.dec).toBe(index));
  });

  it('describes a printable capital letter', () => {
    const a = ASCII_TABLE[65]!;
    expect(a).toMatchObject({
      char: 'A',
      hex: '41',
      oct: '101',
      bin: '01000001',
      name: 'Latin Capital Letter A',
      abbr: null,
      category: 'printable',
    });
  });

  it('describes a digit', () => {
    expect(ASCII_TABLE[48]).toMatchObject({ char: '0', name: 'Digit Zero' });
  });

  it('describes space distinctly from other control-like entries', () => {
    expect(ASCII_TABLE[32]).toMatchObject({ char: ' ', name: 'Space', abbr: 'SP', category: 'printable' });
  });

  it('describes a control character with a mnemonic, caret notation, and no glyph', () => {
    expect(ASCII_TABLE[9]).toMatchObject({
      char: '',
      symbol: '^I',
      name: 'Horizontal Tab',
      abbr: 'HT',
      category: 'control',
      hex: '09',
      oct: '011',
      bin: '00001001',
    });
  });

  it('describes NUL and DEL, the boundary control codes', () => {
    expect(ASCII_TABLE[0]).toMatchObject({ abbr: 'NUL', symbol: '^@' });
    expect(ASCII_TABLE[127]).toMatchObject({ abbr: 'DEL', symbol: '^?', category: 'control' });
  });
});

describe('searchAsciiTable', () => {
  it('returns the full table for an empty query', () => {
    expect(searchAsciiTable('')).toHaveLength(128);
    expect(searchAsciiTable('   ')).toHaveLength(128);
  });

  it('matches an exact printable character', () => {
    const result = searchAsciiTable('a');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ dec: 97, char: 'a' });
  });

  it('matches a decimal code', () => {
    const result = searchAsciiTable('65');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ dec: 65, char: 'A' });
  });

  it('matches a hex code in 0x, U+, and \\u forms', () => {
    for (const query of ['0x41', '0X41', 'U+0041', '\\u0041']) {
      const result = searchAsciiTable(query);
      expect(result, query).toHaveLength(1);
      expect(result[0]!.dec, query).toBe(65);
    }
  });

  it('matches by name or mnemonic substring, case-insensitively', () => {
    const byName = searchAsciiTable('tab');
    expect(byName.map((e) => e.dec)).toContain(9);

    const byMnemonic = searchAsciiTable('esc');
    expect(byMnemonic.map((e) => e.dec)).toContain(27);
  });

  it('returns an empty array for a code outside the ASCII range', () => {
    expect(searchAsciiTable('200')).toEqual([]);
    expect(searchAsciiTable('0xFF')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchAsciiTable('not-a-real-character-name')).toEqual([]);
  });
});

describe('formatAsciiEntry', () => {
  it('formats a printable character with its literal glyph', () => {
    expect(formatAsciiEntry(ASCII_TABLE[65]!)).toBe('A — dec 65, hex 41, oct 101, bin 01000001 (Latin Capital Letter A)');
  });

  it('formats a control character with its mnemonic and caret notation, not a blank glyph', () => {
    expect(formatAsciiEntry(ASCII_TABLE[9]!)).toBe('HT (^I) — dec 9, hex 09, oct 011, bin 00001001 (Horizontal Tab)');
  });
});

describe('formatAsciiTable', () => {
  it('produces a tab-separated table with a header row', () => {
    const text = formatAsciiTable([ASCII_TABLE[65]!, ASCII_TABLE[9]!]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Dec\tHex\tOct\tBin\tChar\tName');
    expect(lines[1]).toBe('65\t41\t101\t01000001\tA\tLatin Capital Letter A');
    expect(lines[2]).toBe('9\t09\t011\t00001001\tHT\tHorizontal Tab');
  });
});
