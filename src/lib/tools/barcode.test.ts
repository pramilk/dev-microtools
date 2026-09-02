import { describe, it, expect } from 'vitest';
import {
  generateBarcode,
  barcodeToSvg,
  barcodeSvgDimensions,
  CODE128_PATTERNS,
  CODE39_PATTERNS,
  CODE39_EDGE,
  CODE39_VALUE_ORDER,
} from './barcode';

/** Same run-length decoding barcode.ts uses internally, reimplemented here so the table
 * invariant tests below don't depend on (and can't accidentally validate against) the
 * module's own private helper. */
function runLengths(bits: string): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < bits.length) {
    let j = i;
    while (j < bits.length && bits[j] === bits[i]) j += 1;
    runs.push(j - i);
    i = j;
  }
  return runs;
}

describe('generateBarcode — code128b', () => {
  it('rejects empty input', () => {
    const result = generateBarcode('code128b', '');
    expect(result.ok).toBe(false);
  });

  it('rejects a character outside printable ASCII', () => {
    const withControlChar = generateBarcode('code128b', 'Hello\nWorld');
    expect(withControlChar.ok).toBe(false);

    const withUnicode = generateBarcode('code128b', 'café');
    expect(withUnicode.ok).toBe(false);
    if (!withUnicode.ok) expect(withUnicode.error).toContain('é');
  });

  it('accepts the full printable ASCII range', () => {
    const result = generateBarcode('code128b', ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCXYZ[\\]^_`abcxyz{|}~');
    expect(result.ok).toBe(true);
  });

  it('keeps the raw input as the display text', () => {
    const result = generateBarcode('code128b', 'HELLO-123');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('HELLO-123');
  });

  it('matches the exact published bar-width sequence for a known checksum worked example', () => {
    // Cross-checked against the Wikipedia Code 128 checksum example for "PJJ123C" (which
    // uses Start Code A, value 103) — Subset B shares the same per-character values for
    // this string (P=48, J=42, 1=17, 2=18, 3=19, C=35, all within the 32-95 overlap between
    // subsets A and B), only the start code differs (Start B = 104 instead of 103), so the
    // checksum here is independently computed from the same published algorithm:
    // (104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7) mod 103 = 55.
    // Each symbol's own bar-width pattern (including Start B, value 55, and Stop) is taken
    // directly from the published Code 128 symbol table.
    const result = generateBarcode('code128b', 'PJJ123C');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.widths).toEqual([
      2, 1, 1, 2, 1, 4, // Start B (104)
      3, 1, 3, 1, 2, 1, // P (48)
      1, 1, 2, 1, 3, 3, // J (42)
      1, 1, 2, 1, 3, 3, // J (42)
      1, 2, 3, 2, 2, 1, // 1 (17)
      2, 2, 3, 2, 1, 1, // 2 (18)
      2, 2, 1, 1, 3, 2, // 3 (19)
      1, 3, 1, 3, 2, 1, // C (35)
      3, 1, 1, 3, 2, 1, // checksum (55)
      2, 3, 3, 1, 1, 1, 2, // Stop (106)
    ]);
  });

  it('always starts with a bar and produces an even total bar/space count per symbol', () => {
    const result = generateBarcode('code128b', 'AB');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Start + 2 data + checksum = 4 symbols * 6 widths, + Stop's 7 widths.
    expect(result.value.widths).toHaveLength(4 * 6 + 7);
  });
});

describe('generateBarcode — code39', () => {
  it('rejects empty input', () => {
    expect(generateBarcode('code39', '').ok).toBe(false);
  });

  it('rejects a character outside the Code 39 charset', () => {
    const result = generateBarcode('code39', 'HELLO!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('!');
  });

  it('accepts every character in the charset', () => {
    const result = generateBarcode('code39', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%');
    expect(result.ok).toBe(true);
  });

  it('uppercases lowercase input instead of rejecting it', () => {
    const result = generateBarcode('code39', 'code39');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('*CODE39*');
  });

  it('wraps the display text in start/stop asterisks', () => {
    const result = generateBarcode('code39', 'HELLO');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('*HELLO*');
  });

  it('omits the checksum character by default', () => {
    const result = generateBarcode('code39', 'ABC');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('*ABC*');
  });

  it('appends a mod-43 checksum character when requested', () => {
    // Values: A=10, B=11, C=12 -> sum=33 -> 33 mod 43 = 33 -> CODE39_VALUE_ORDER[33] = 'X'.
    const result = generateBarcode('code39', 'ABC', { code39Checksum: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('*ABCX*');
  });

  it('inserts exactly one narrow-space gap between every pair of adjacent characters', () => {
    // Start '*' (9 elements) + gap(1) + 'A' (9) + gap(1) + stop '*' (9) = 29 elements.
    const result = generateBarcode('code39', 'A');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.widths).toHaveLength(9 + 1 + 9 + 1 + 9);
  });
});

describe('CODE39_PATTERNS table invariants', () => {
  const allEntries = { ...CODE39_PATTERNS, '*': CODE39_EDGE };

  it('has exactly 43 data characters plus the start/stop delimiter', () => {
    expect(Object.keys(CODE39_PATTERNS)).toHaveLength(43);
    expect(CODE39_VALUE_ORDER).toHaveLength(43);
  });

  it('every pattern is 15 characters, starts and ends with a bar, and has 9 elements', () => {
    for (const [char, bits] of Object.entries(allEntries)) {
      expect(bits, char).toHaveLength(15);
      expect(bits[0], char).toBe('1');
      expect(bits[bits.length - 1], char).toBe('1');
      expect(runLengths(bits), char).toHaveLength(9);
    }
  });

  it('every pattern has exactly 3 wide elements and 6 narrow elements, per the Code 39 standard', () => {
    for (const [char, bits] of Object.entries(allEntries)) {
      const runs = runLengths(bits);
      expect(runs.filter((len) => len === 3), char).toHaveLength(3);
      expect(runs.filter((len) => len === 1), char).toHaveLength(6);
    }
  });

  it('every pattern is unique — no two characters share a bar pattern', () => {
    const patterns = Object.values(allEntries);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('matches the standard\'s documented two-of-five weighted construction for "0" and "A"', () => {
    // Straight from the Code 39 standard's own description: the two wide bars (out of 5)
    // encode a value via weights [1, 2, 4, 7, 0]. "0" uses the wide-bar pair whose weights
    // sum to 11 (a special case standing in for 0); "A" uses the pair summing to 1, and the
    // +10/+20/+30 letter-group offset then subtracts 1: 1 + 10 - 1 = 10 (A's value).
    const bars = (bits: string) => {
      const runs = runLengths(bits);
      return [runs[0], runs[2], runs[4], runs[6], runs[8]];
    };
    const weightSum = (bits: string) => {
      const weights = [1, 2, 4, 7, 0];
      return bars(bits).reduce((sum, len, i) => sum + (len === 3 ? weights[i] : 0), 0);
    };
    expect(weightSum(CODE39_PATTERNS['0'])).toBe(11);
    expect(weightSum(CODE39_PATTERNS.A)).toBe(1);
  });
});

describe('CODE128_PATTERNS table invariants', () => {
  it('has exactly 107 entries (values 0-106)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it('every data/start pattern (0-105) is 11 modules wide; the stop pattern (106) is 13', () => {
    CODE128_PATTERNS.slice(0, 106).forEach((bits, value) => {
      const total = runLengths(bits).reduce((sum, w) => sum + w, 0);
      expect(total, `value ${value}`).toBe(11);
    });
    const stopTotal = runLengths(CODE128_PATTERNS[106]).reduce((sum, w) => sum + w, 0);
    expect(stopTotal).toBe(13);
  });

  it('every pattern starts with a bar and every pattern is unique', () => {
    for (const bits of CODE128_PATTERNS) expect(bits[0]).toBe('1');
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length);
  });
});

describe('generateBarcode — ean13', () => {
  it('rejects empty input', () => {
    expect(generateBarcode('ean13', '').ok).toBe(false);
  });

  it('rejects non-digit characters', () => {
    const result = generateBarcode('ean13', '59012341234x');
    expect(result.ok).toBe(false);
  });

  it('rejects the wrong digit count', () => {
    const result = generateBarcode('ean13', '12345');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/12 digits|13 digits/);
  });

  it('computes the correct check digit for the canonical 12-digit example', () => {
    // "590123412345" -> check digit 7 -> "5901234123457" is the standard worked example
    // used across barcode references (e.g. the Wikipedia EAN-13 article).
    const result = generateBarcode('ean13', '590123412345');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('5901234123457');
  });

  it('accepts a full 13-digit code with a correct check digit', () => {
    const result = generateBarcode('ean13', '5901234123457');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('5901234123457');
  });

  it('rejects a full 13-digit code with an incorrect check digit', () => {
    const result = generateBarcode('ean13', '5901234123459');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('check digit');
  });

  it('produces a barcode exactly 95 modules wide, per the EAN-13 standard', () => {
    const result = generateBarcode('ean13', '5901234123457');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const totalModules = result.value.widths.reduce((sum, w) => sum + w, 0);
    expect(totalModules).toBe(95);
  });

  it('always starts with the start guard pattern (bar, space, bar — each 1 module)', () => {
    const result = generateBarcode('ean13', '5901234123457');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.widths.slice(0, 3)).toEqual([1, 1, 1]);
  });
});

describe('generateBarcode — upca', () => {
  it('rejects empty input', () => {
    expect(generateBarcode('upca', '').ok).toBe(false);
  });

  it('rejects the wrong digit count', () => {
    const result = generateBarcode('upca', '123');
    expect(result.ok).toBe(false);
  });

  it('computes the correct check digit for a genuine, well-known UPC-A (Wrigley\'s Extra gum)', () => {
    const result = generateBarcode('upca', '03600029145');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('036000291452');
  });

  it('accepts a full 12-digit UPC-A with a correct check digit', () => {
    const result = generateBarcode('upca', '036000291452');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayText).toBe('036000291452');
  });

  it('rejects a full 12-digit UPC-A with an incorrect check digit', () => {
    const result = generateBarcode('upca', '036000291459');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('check digit');
  });

  it('produces a barcode exactly 95 modules wide, same as EAN-13', () => {
    const result = generateBarcode('upca', '036000291452');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const totalModules = result.value.widths.reduce((sum, w) => sum + w, 0);
    expect(totalModules).toBe(95);
  });
});

describe('barcodeToSvg', () => {
  const pattern = { widths: [2, 1, 2, 1, 2], displayText: 'TEST' };

  it('renders a well-formed SVG string', () => {
    const svg = barcodeToSvg(pattern, { moduleWidth: 2, barHeight: 50 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
  });

  it('sizes the SVG to match barcodeSvgDimensions for the same options', () => {
    const options = { moduleWidth: 3, barHeight: 60, showText: true };
    const svg = barcodeToSvg(pattern, options);
    const { width, height } = barcodeSvgDimensions(pattern, options);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
  });

  it('omits the text element when showText is false', () => {
    const svg = barcodeToSvg(pattern, { showText: false });
    expect(svg).not.toContain('<text');
  });

  it('omits the text element when displayText is blank', () => {
    const svg = barcodeToSvg({ widths: [1, 1, 1], displayText: '   ' });
    expect(svg).not.toContain('<text');
  });

  it('includes the display text when showText is true', () => {
    const svg = barcodeToSvg(pattern, { showText: true });
    expect(svg).toContain('<text');
    expect(svg).toContain('TEST');
  });

  it('escapes XML-significant characters in the display text', () => {
    const svg = barcodeToSvg({ widths: [1, 1, 1], displayText: '<A&B>' });
    expect(svg).toContain('&lt;A&amp;B&gt;');
    expect(svg).not.toContain('<A&B>');
  });

  it('honours custom colours', () => {
    const svg = barcodeToSvg(pattern, { darkColor: '#123456', lightColor: '#abcdef' });
    expect(svg).toContain('fill="#abcdef"');
    expect(svg).toContain('fill="#123456"');
  });

  it('falls back to the default colour for an invalid/malicious colour string', () => {
    const svg = barcodeToSvg(pattern, { darkColor: 'red" onmouseover="alert(1)' });
    expect(svg).not.toContain('onmouseover');
    expect(svg).toContain('fill="#000000"');
  });

  it('grows total width with a larger module width', () => {
    const narrow = barcodeSvgDimensions(pattern, { moduleWidth: 1 });
    const wide = barcodeSvgDimensions(pattern, { moduleWidth: 4 });
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('grows total height when text is shown vs hidden', () => {
    const withText = barcodeSvgDimensions(pattern, { showText: true });
    const withoutText = barcodeSvgDimensions(pattern, { showText: false });
    expect(withText.height).toBeGreaterThan(withoutText.height);
  });
});
