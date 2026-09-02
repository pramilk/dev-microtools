import { type ToolResult, ok, err } from './result';

export const BARCODE_SYMBOLOGIES = ['code128b', 'code39', 'ean13', 'upca'] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];

export interface BarcodePattern {
  /** Alternating bar/space widths in barcode "modules" (the narrowest bar = 1 module), starting with a bar. */
  widths: number[];
  /** Human-readable text to render below the bars (may differ from raw input, e.g. EAN-13 shows the computed check digit). */
  displayText: string;
}

export interface BarcodeOptions {
  /** Code 39 only: append an optional mod-43 check character (not required by the base standard). */
  code39Checksum?: boolean;
}

/**
 * Turns a run of '0'/'1' characters (space/bar per module) into alternating run-length
 * widths, e.g. "1101100" -> [2,1,2,2] (bar 2, space 1, bar 2, space 2). Every table in this
 * file is built from a string that starts with '1', so the returned array always starts
 * with a bar — the contract `BarcodePattern.widths` documents.
 */
function runLengthWidths(bits: string): number[] {
  const widths: number[] = [];
  let i = 0;
  while (i < bits.length) {
    let j = i;
    while (j < bits.length && bits[j] === bits[i]) j += 1;
    widths.push(j - i);
    i = j;
  }
  return widths;
}

// --- Code 128 (Subset B) ---------------------------------------------------------------
//
// The 107-entry symbol table below (values 0-106) is the standard Code 128 pattern table —
// each entry is the 11-module bar pattern for that value as a string of 1s (bar) and 0s
// (space), except value 106 (Stop) which is the 13-module stop pattern. Cross-checked
// against two independent published sources (Wikipedia's Code 128 widths table and the
// widely-used JsBarcode library's symbol table) which agree on every spot-checked entry,
// including the Start B (104) and Stop (106) patterns and several data values used in the
// worked checksum example in `barcode.test.ts`.
// Exported (alongside the Code 39 tables below) so the test suite can verify every table
// entry's structural invariants directly — e.g. that every Code 128 pattern sums to 11
// modules (13 for Stop) and that every Code 39 pattern has exactly 3 wide elements — rather
// than only spot-checking a couple of hand-traced examples.
export const CODE128_PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '1100011101011',
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

function generateCode128B(value: string): ToolResult<BarcodePattern> {
  if (value === '') return err('Enter some text to generate a Code 128 barcode.');

  const values: number[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      return err(
        `"${char}" isn't supported by Code 128 (Subset B) — only printable ASCII characters (space through ~) are allowed.`
      );
    }
    values.push(code - 32);
  }

  // Checksum = (start value + sum of each symbol's value * its 1-indexed position) mod 103.
  let checksum = CODE128_START_B;
  values.forEach((v, i) => {
    checksum += v * (i + 1);
  });
  checksum %= 103;

  const symbolValues = [CODE128_START_B, ...values, checksum, CODE128_STOP];
  const widths = symbolValues.flatMap((v) => runLengthWidths(CODE128_PATTERNS[v]));
  return ok({ widths, displayText: value });
}

// --- Code 39 -----------------------------------------------------------------------------
//
// Each of the 43 characters below is stored as its published 15-character bit pattern
// (bars/spaces where a "wide" element is 3 bits and a "narrow" element is 1 bit — a
// well-known encoding trick that packs the 9 physical elements, 3 wide + 6 narrow, into a
// fixed-length string). Sourced from the `python-barcode` library's Code 39 charset table
// and cross-checked against the Code 39 standard's own published construction rule (the
// two-out-of-five weighted code on the five bars, weights 1-2-4-7-0): decoding '0' gives
// wide bars at the two positions whose weights sum to 11 (special-cased to value 0), and
// decoding 'A' gives wide bars at weights 1 and 0 (sum 1, +10 -1 = 10) — both match the
// standard's documented worked examples exactly.
export const CODE39_VALUE_ORDER = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

export const CODE39_PATTERNS: Readonly<Record<string, string>> = {
  '0': '101000111011101',
  '1': '111010001010111',
  '2': '101110001010111',
  '3': '111011100010101',
  '4': '101000111010111',
  '5': '111010001110101',
  '6': '101110001110101',
  '7': '101000101110111',
  '8': '111010001011101',
  '9': '101110001011101',
  A: '111010100010111',
  B: '101110100010111',
  C: '111011101000101',
  D: '101011100010111',
  E: '111010111000101',
  F: '101110111000101',
  G: '101010001110111',
  H: '111010100011101',
  I: '101110100011101',
  J: '101011100011101',
  K: '111010101000111',
  L: '101110101000111',
  M: '111011101010001',
  N: '101011101000111',
  O: '111010111010001',
  P: '101110111010001',
  Q: '101010111000111',
  R: '111010101110001',
  S: '101110101110001',
  T: '101011101110001',
  U: '111000101010111',
  V: '100011101010111',
  W: '111000111010101',
  X: '100010111010111',
  Y: '111000101110101',
  Z: '100011101110101',
  '-': '100010101110111',
  '.': '111000101011101',
  ' ': '100011101011101',
  $: '100010001000101',
  '/': '100010001010001',
  '+': '100010100010001',
  '%': '101000100010001',
};

/** Start/stop delimiter — always present at both ends of a Code 39 barcode, never in the value. */
export const CODE39_EDGE = '100010111011101';

function generateCode39(rawValue: string, options: { checksum?: boolean } = {}): ToolResult<BarcodePattern> {
  if (rawValue === '') return err('Enter some text to generate a Code 39 barcode.');

  // Code 39 has no lowercase letters — uppercasing is the same convenience real barcode
  // systems apply rather than rejecting perfectly encodable text outright.
  const value = rawValue.toUpperCase();
  for (const char of value) {
    if (!(char in CODE39_PATTERNS)) {
      return err(`"${char}" isn't allowed in Code 39 — use 0-9, A-Z, space, and - . $ / + %.`);
    }
  }

  let checksumChar = '';
  if (options.checksum) {
    let sum = 0;
    for (const char of value) sum += CODE39_VALUE_ORDER.indexOf(char);
    checksumChar = CODE39_VALUE_ORDER[sum % 43];
  }

  const widths: number[] = [];
  const appendChar = (bits: string) => {
    // A single narrow-space module separates every pair of adjacent characters, including
    // the start/stop delimiters — required by the standard, not part of any character's own
    // 9-element pattern.
    if (widths.length > 0) widths.push(1);
    widths.push(...runLengthWidths(bits));
  };

  appendChar(CODE39_EDGE);
  for (const char of value) appendChar(CODE39_PATTERNS[char]);
  if (checksumChar !== '') appendChar(CODE39_PATTERNS[checksumChar]);
  appendChar(CODE39_EDGE);

  return ok({ widths, displayText: `*${value}${checksumChar}*` });
}

// --- EAN-13 / UPC-A ------------------------------------------------------------------------
//
// L/G/R digit patterns and the first-digit parity table are the standard EAN/UPC tables,
// cross-checked against the worked example on Wikipedia's EAN article (encoding
// "400638133393x": checksum sum 89, check digit 1, first digit 4 -> parity "LGLLGG").
const L_CODES: readonly string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const G_CODES: readonly string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const R_CODES: readonly string[] = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
/** For first digit 0-9, which of L/G encodes each of the next six (left-half) digits. */
const FIRST_DIGIT_PARITY: readonly string[] = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];
const GUARD_START = '101';
const GUARD_CENTER = '01010';
const GUARD_END = '101';

/** Standard EAN/UPC mod-10 check digit: alternating weights 1,3 starting at the first digit. */
function computeEanCheckDigit(data12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const weight = i % 2 === 0 ? 1 : 3;
    sum += Number(data12[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Builds the raw module bit-string for a full 13-digit EAN code (first digit + 12 more). */
function buildEan13Bits(digits13: string): string {
  const parity = FIRST_DIGIT_PARITY[Number(digits13[0])];
  let bits = GUARD_START;
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(digits13[1 + i]);
    bits += parity[i] === 'L' ? L_CODES[digit] : G_CODES[digit];
  }
  bits += GUARD_CENTER;
  for (let i = 0; i < 6; i += 1) {
    bits += R_CODES[Number(digits13[7 + i])];
  }
  return bits + GUARD_END;
}

function generateEan13(rawValue: string): ToolResult<BarcodePattern> {
  const digits = rawValue.trim();
  if (digits === '') return err('Enter 12 or 13 digits to generate an EAN-13 barcode.');
  if (!/^\d+$/.test(digits)) return err('EAN-13 only accepts the digits 0-9.');
  if (digits.length !== 12 && digits.length !== 13) {
    return err(
      `EAN-13 needs 12 digits (the check digit is computed automatically) or 13 digits (including the check digit) — got ${digits.length}.`
    );
  }

  let full13: string;
  if (digits.length === 12) {
    full13 = digits + computeEanCheckDigit(digits);
  } else {
    const data12 = digits.slice(0, 12);
    const provided = digits[12];
    const expected = computeEanCheckDigit(data12);
    if (provided !== expected) {
      return err(`Invalid EAN-13 check digit — the last digit is ${provided} but should be ${expected}.`);
    }
    full13 = digits;
  }

  return ok({ widths: runLengthWidths(buildEan13Bits(full13)), displayText: full13 });
}

/** UPC-A is structurally EAN-13 with an implicit leading 0 — same tables, same checksum. */
function generateUpcA(rawValue: string): ToolResult<BarcodePattern> {
  const digits = rawValue.trim();
  if (digits === '') return err('Enter 11 or 12 digits to generate a UPC-A barcode.');
  if (!/^\d+$/.test(digits)) return err('UPC-A only accepts the digits 0-9.');
  if (digits.length !== 11 && digits.length !== 12) {
    return err(
      `UPC-A needs 11 digits (the check digit is computed automatically) or 12 digits (including the check digit) — got ${digits.length}.`
    );
  }

  let full12: string;
  if (digits.length === 11) {
    full12 = digits + computeEanCheckDigit(`0${digits}`);
  } else {
    const data12 = `0${digits.slice(0, 11)}`;
    const provided = digits[11];
    const expected = computeEanCheckDigit(data12);
    if (provided !== expected) {
      return err(`Invalid UPC-A check digit — the last digit is ${provided} but should be ${expected}.`);
    }
    full12 = digits;
  }

  return ok({ widths: runLengthWidths(buildEan13Bits(`0${full12}`)), displayText: full12 });
}

/** Generates the module-width pattern for the given symbology, or a validation error. */
export function generateBarcode(
  symbology: BarcodeSymbology,
  value: string,
  options: BarcodeOptions = {}
): ToolResult<BarcodePattern> {
  switch (symbology) {
    case 'code128b':
      return generateCode128B(value);
    case 'code39':
      return generateCode39(value, { checksum: options.code39Checksum });
    case 'ean13':
      return generateEan13(value);
    case 'upca':
      return generateUpcA(value);
  }
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The pixel dimensions `barcodeToSvg` will render at for the same pattern/options — callers
 * that rasterize the SVG onto a canvas (PNG export) need this to size the canvas correctly.
 */
export function barcodeSvgDimensions(
  pattern: BarcodePattern,
  options: { moduleWidth?: number; barHeight?: number; showText?: boolean } = {}
): { width: number; height: number } {
  const { moduleWidth = 2, barHeight = 80, showText = true } = options;
  const quietZone = moduleWidth * 10;
  const totalModules = pattern.widths.reduce((sum, w) => sum + w, 0);
  const width = totalModules * moduleWidth + quietZone * 2;
  const hasText = showText && pattern.displayText.trim() !== '';
  const textHeight = hasText ? Math.round(barHeight * 0.28) : 0;
  return { width, height: barHeight + textHeight };
}

/**
 * Renders a bar pattern as an inline SVG string — used for both preview and SVG/PNG export.
 *
 * Bars are drawn as a single `<path>` of rect commands (same technique as this codebase's
 * QR code renderer), which is far more compact than one `<rect>` element per bar. Only the
 * dark (bar) runs are drawn; the light background rect underneath covers the rest.
 *
 * Human-readable text is a single centered line below the bars — a simplification of the
 * fully correct EAN-13/UPC-A typographic layout, which conventionally splits the digits
 * into groups positioned relative to the guard bars (one digit outside the guards, then two
 * groups of six). That finer layout is out of scope here; a centered line still shows every
 * digit and is legible next to the barcode.
 */
export function barcodeToSvg(
  pattern: BarcodePattern,
  options: {
    moduleWidth?: number;
    barHeight?: number;
    showText?: boolean;
    darkColor?: string;
    lightColor?: string;
  } = {}
): string {
  const { moduleWidth = 2, barHeight = 80, showText = true, darkColor = '#000000', lightColor = '#ffffff' } = options;
  const quietZone = moduleWidth * 10;
  const { width, height } = barcodeSvgDimensions(pattern, { moduleWidth, barHeight, showText });

  let path = '';
  let x = quietZone;
  let isBar = true;
  for (const moduleCount of pattern.widths) {
    const pxWidth = moduleCount * moduleWidth;
    if (isBar) path += `M${x},0h${pxWidth}v${barHeight}h-${pxWidth}z`;
    x += pxWidth;
    isBar = !isBar;
  }

  const hasText = showText && pattern.displayText.trim() !== '';
  let textMarkup = '';
  if (hasText) {
    const textHeight = height - barHeight;
    const fontSize = Math.round(textHeight * 0.85);
    textMarkup =
      `<rect x="0" y="${barHeight}" width="${width}" height="${textHeight}" fill="${lightColor}"/>` +
      `<text x="${width / 2}" y="${barHeight + textHeight / 2}" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${fontSize}" ` +
      `letter-spacing="1" fill="${darkColor}">${escapeXmlText(pattern.displayText)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${width}" height="${height}" fill="${lightColor}"/>` +
    `<path d="${path}" fill="${darkColor}"/>` +
    textMarkup +
    `</svg>`
  );
}
