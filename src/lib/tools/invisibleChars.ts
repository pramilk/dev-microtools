/**
 * Detects zero-width/format characters, bidirectional-override control characters,
 * non-standard whitespace, raw control characters, and Latin-lookalike characters from
 * other scripts ("homoglyphs") in a block of text, then offers to strip or normalize
 * them.
 *
 * Pure code-point scanning against curated lookup tables below — no dependency, no
 * bundled Unicode database, no `Intl`-based script lookup. The homoglyph table is a
 * hand-picked list of characters actually seen in real spoofing incidents (Cyrillic,
 * Greek, Armenian and fullwidth Latin look-alikes), not the full Unicode confusables
 * database (which runs to several thousand entries and would need a bundled data file).
 */

export type CharCategory = 'bidi' | 'homoglyph' | 'invisible' | 'control' | 'whitespace';

export interface CategoryInfo {
  label: string;
  description: string;
  severity: 'danger' | 'warning';
}

/** Display order used everywhere in the UI — most security-relevant first. */
export const CATEGORY_ORDER: readonly CharCategory[] = ['bidi', 'homoglyph', 'invisible', 'control', 'whitespace'];

export const CATEGORY_INFO: Record<CharCategory, CategoryInfo> = {
  bidi: {
    label: 'Bidi control',
    description:
      'Reorders how surrounding text is displayed — the basis of the "Trojan Source" trick used to hide malicious code or disguise a file name’s real extension.',
    severity: 'danger',
  },
  homoglyph: {
    label: 'Homoglyph',
    description:
      'A letter from another script (Cyrillic, Greek, Armenian…) that renders identically or near-identically to a Latin letter — used to spoof domains, usernames, and brand names.',
    severity: 'danger',
  },
  invisible: {
    label: 'Invisible',
    description: 'Renders with no visible glyph at all — zero-width spaces, joiners, variation selectors, and similar format characters.',
    severity: 'warning',
  },
  control: {
    label: 'Control character',
    description: 'A raw C0/C1 control character other than tab, newline, or carriage return — usually pasted in by accident from a terminal, PDF, or binary file.',
    severity: 'warning',
  },
  whitespace: {
    label: 'Odd whitespace',
    description:
      'Looks like a normal space but is a different code point — a non-breaking space, an em space, a line/paragraph separator — which can silently break string comparisons and splits.',
    severity: 'warning',
  },
};

export interface FoundChar {
  /** UTF-16 code unit offset into the original string. */
  index: number;
  /** The actual character (a surrogate pair for anything outside the BMP). */
  char: string;
  codePoint: number;
  name: string;
  /** Short label for compact badges, e.g. "ZWSP", "RLO", "NBSP". */
  abbr: string;
  category: CharCategory;
  /** What "clean" substitutes when this category is enabled. Empty string removes it. */
  replacement: string;
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

// --------------------------------------------------------------------- bidi controls

const BIDI: Record<number, [name: string, abbr: string]> = {
  0x061c: ['ARABIC LETTER MARK', 'ALM'],
  0x200e: ['LEFT-TO-RIGHT MARK', 'LRM'],
  0x200f: ['RIGHT-TO-LEFT MARK', 'RLM'],
  0x202a: ['LEFT-TO-RIGHT EMBEDDING', 'LRE'],
  0x202b: ['RIGHT-TO-LEFT EMBEDDING', 'RLE'],
  0x202c: ['POP DIRECTIONAL FORMATTING', 'PDF'],
  0x202d: ['LEFT-TO-RIGHT OVERRIDE', 'LRO'],
  0x202e: ['RIGHT-TO-LEFT OVERRIDE', 'RLO'],
  0x2066: ['LEFT-TO-RIGHT ISOLATE', 'LRI'],
  0x2067: ['RIGHT-TO-LEFT ISOLATE', 'RLI'],
  0x2068: ['FIRST STRONG ISOLATE', 'FSI'],
  0x2069: ['POP DIRECTIONAL ISOLATE', 'PDI'],
};

// ---------------------------------------------------------------- invisible/format chars

const INVISIBLE: Record<number, [name: string, abbr: string]> = {
  0x00ad: ['SOFT HYPHEN', 'SHY'],
  0x034f: ['COMBINING GRAPHEME JOINER', 'CGJ'],
  0x115f: ['HANGUL CHOSEONG FILLER', 'HCF'],
  0x1160: ['HANGUL JUNGSEONG FILLER', 'HJF'],
  0x17b4: ['KHMER VOWEL INHERENT AQ', 'KIA'],
  0x17b5: ['KHMER VOWEL INHERENT AA', 'KIA'],
  0x180b: ['MONGOLIAN FREE VARIATION SELECTOR ONE', 'FVS1'],
  0x180c: ['MONGOLIAN FREE VARIATION SELECTOR TWO', 'FVS2'],
  0x180d: ['MONGOLIAN FREE VARIATION SELECTOR THREE', 'FVS3'],
  0x180e: ['MONGOLIAN VOWEL SEPARATOR', 'MVS'],
  0x200b: ['ZERO WIDTH SPACE', 'ZWSP'],
  0x200c: ['ZERO WIDTH NON-JOINER', 'ZWNJ'],
  0x200d: ['ZERO WIDTH JOINER', 'ZWJ'],
  0x2060: ['WORD JOINER', 'WJ'],
  0x2061: ['FUNCTION APPLICATION', 'FA'],
  0x2062: ['INVISIBLE TIMES', 'IT'],
  0x2063: ['INVISIBLE SEPARATOR', 'IS'],
  0x2064: ['INVISIBLE PLUS', 'IP'],
  0x206a: ['INHIBIT SYMMETRIC SWAPPING', 'ISS'],
  0x206b: ['ACTIVATE SYMMETRIC SWAPPING', 'ASS'],
  0x206c: ['INHIBIT ARABIC FORM SHAPING', 'IAFS'],
  0x206d: ['ACTIVATE ARABIC FORM SHAPING', 'AAFS'],
  0x206e: ['NATIONAL DIGIT SHAPES', 'NDS'],
  0x206f: ['NOMINAL DIGIT SHAPES', 'NODS'],
  0x3164: ['HANGUL FILLER', 'HF'],
  0xfeff: ['ZERO WIDTH NO-BREAK SPACE (BYTE ORDER MARK)', 'BOM'],
  0xffa0: ['HALFWIDTH HANGUL FILLER', 'HHF'],
};

/** Variation selectors and tag characters — regular ranges, not worth a 300-entry map. */
function classifyInvisibleRange(codePoint: number): [name: string, abbr: string] | null {
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) {
    const n = codePoint - 0xfe00 + 1;
    return [`VARIATION SELECTOR-${n}`, `VS${n}`];
  }
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) {
    const n = codePoint - 0xe0100 + 17;
    return [`VARIATION SELECTOR-${n}`, `VS${n}`];
  }
  if (codePoint === 0xe0001) return ['LANGUAGE TAG', 'TAG'];
  if (codePoint >= 0xe0020 && codePoint <= 0xe007f) return ['TAG CHARACTER', 'TAG'];
  return null;
}

// --------------------------------------------------------------------- odd whitespace

/** name, abbr, replacement (a plain space, except the two line/paragraph separators). */
const WHITESPACE: Record<number, [name: string, abbr: string, replacement: string]> = {
  0x00a0: ['NO-BREAK SPACE', 'NBSP', ' '],
  0x1680: ['OGHAM SPACE MARK', 'OSM', ' '],
  0x2000: ['EN QUAD', 'ENQD', ' '],
  0x2001: ['EM QUAD', 'EMQD', ' '],
  0x2002: ['EN SPACE', 'ENSP', ' '],
  0x2003: ['EM SPACE', 'EMSP', ' '],
  0x2004: ['THREE-PER-EM SPACE', '3/EM', ' '],
  0x2005: ['FOUR-PER-EM SPACE', '4/EM', ' '],
  0x2006: ['SIX-PER-EM SPACE', '6/EM', ' '],
  0x2007: ['FIGURE SPACE', 'FIGSP', ' '],
  0x2008: ['PUNCTUATION SPACE', 'PUNCSP', ' '],
  0x2009: ['THIN SPACE', 'THSP', ' '],
  0x200a: ['HAIR SPACE', 'HAIRSP', ' '],
  0x2028: ['LINE SEPARATOR', 'LSEP', '\n'],
  0x2029: ['PARAGRAPH SEPARATOR', 'PSEP', '\n'],
  0x202f: ['NARROW NO-BREAK SPACE', 'NNBSP', ' '],
  0x205f: ['MEDIUM MATHEMATICAL SPACE', 'MMSP', ' '],
  0x3000: ['IDEOGRAPHIC SPACE', 'IDSP', ' '],
};

// --------------------------------------------------------------------- control chars

const C0_ABBR: Record<number, string> = {
  0x00: 'NUL', 0x01: 'SOH', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ',
  0x06: 'ACK', 0x07: 'BEL', 0x08: 'BS', 0x0b: 'VT', 0x0c: 'FF', 0x0e: 'SO',
  0x0f: 'SI', 0x10: 'DLE', 0x11: 'DC1', 0x12: 'DC2', 0x13: 'DC3', 0x14: 'DC4',
  0x15: 'NAK', 0x16: 'SYN', 0x17: 'ETB', 0x18: 'CAN', 0x19: 'EM', 0x1a: 'SUB',
  0x1b: 'ESC', 0x1c: 'FS', 0x1d: 'GS', 0x1e: 'RS', 0x1f: 'US',
};

const CONTROL_FULL_NAMES: Record<number, string> = {
  0x00: 'NULL', 0x07: 'BELL', 0x08: 'BACKSPACE', 0x0b: 'LINE TABULATION', 0x0c: 'FORM FEED', 0x1b: 'ESCAPE', 0x7f: 'DELETE',
};

/** \t \n \r are excluded — those are legitimate in ordinary text. */
function classifyControl(codePoint: number): [name: string, abbr: string] | null {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return null;
  if (codePoint <= 0x1f) {
    const abbr = C0_ABBR[codePoint] ?? `C0-${formatCodePoint(codePoint)}`;
    const full = CONTROL_FULL_NAMES[codePoint];
    return [full ? `${full} (control character)` : 'Control character', abbr];
  }
  if (codePoint === 0x7f) return ['DELETE (control character)', 'DEL'];
  if (codePoint >= 0x80 && codePoint <= 0x9f) return ['C1 control character', `C1-${formatCodePoint(codePoint)}`];
  return null;
}

// ----------------------------------------------------------------------- homoglyphs

/**
 * Curated Latin look-alikes, by script. Covers the letters actually exploited in real
 * domain/username spoofing — not a full confusables table. `replacement` is the ASCII
 * letter or digit it is meant to be mistaken for.
 */
const HOMOGLYPHS: Record<number, [name: string, replacement: string]> = {
  // Cyrillic
  0x0405: ['CYRILLIC CAPITAL LETTER DZE', 'S'],
  0x0406: ['CYRILLIC CAPITAL LETTER BYELORUSSIAN-UKRAINIAN I', 'I'],
  0x0408: ['CYRILLIC CAPITAL LETTER JE', 'J'],
  0x0410: ['CYRILLIC CAPITAL LETTER A', 'A'],
  0x0412: ['CYRILLIC CAPITAL LETTER VE', 'B'],
  0x0415: ['CYRILLIC CAPITAL LETTER IE', 'E'],
  0x041a: ['CYRILLIC CAPITAL LETTER KA', 'K'],
  0x041c: ['CYRILLIC CAPITAL LETTER EM', 'M'],
  0x041d: ['CYRILLIC CAPITAL LETTER EN', 'H'],
  0x041e: ['CYRILLIC CAPITAL LETTER O', 'O'],
  0x0420: ['CYRILLIC CAPITAL LETTER ER', 'P'],
  0x0421: ['CYRILLIC CAPITAL LETTER ES', 'C'],
  0x0422: ['CYRILLIC CAPITAL LETTER TE', 'T'],
  0x0423: ['CYRILLIC CAPITAL LETTER U', 'Y'],
  0x0425: ['CYRILLIC CAPITAL LETTER HA', 'X'],
  0x0430: ['CYRILLIC SMALL LETTER A', 'a'],
  0x0435: ['CYRILLIC SMALL LETTER IE', 'e'],
  0x043e: ['CYRILLIC SMALL LETTER O', 'o'],
  0x0440: ['CYRILLIC SMALL LETTER ER', 'p'],
  0x0441: ['CYRILLIC SMALL LETTER ES', 'c'],
  0x0443: ['CYRILLIC SMALL LETTER U', 'y'],
  0x0445: ['CYRILLIC SMALL LETTER HA', 'x'],
  0x0455: ['CYRILLIC SMALL LETTER DZE', 's'],
  0x0456: ['CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I', 'i'],
  0x0458: ['CYRILLIC SMALL LETTER JE', 'j'],
  0x0461: ['CYRILLIC SMALL LETTER OMEGA', 'w'],
  0x04bb: ['CYRILLIC SMALL LETTER SHHA', 'h'],
  0x0501: ['CYRILLIC SMALL LETTER KOMI DE', 'd'],
  0x051a: ['CYRILLIC CAPITAL LETTER QA', 'Q'],
  0x051b: ['CYRILLIC SMALL LETTER QA', 'q'],
  0x051c: ['CYRILLIC CAPITAL LETTER WE', 'W'],
  0x051d: ['CYRILLIC SMALL LETTER WE', 'w'],
  // Greek
  0x0391: ['GREEK CAPITAL LETTER ALPHA', 'A'],
  0x0392: ['GREEK CAPITAL LETTER BETA', 'B'],
  0x0395: ['GREEK CAPITAL LETTER EPSILON', 'E'],
  0x0396: ['GREEK CAPITAL LETTER ZETA', 'Z'],
  0x0397: ['GREEK CAPITAL LETTER ETA', 'H'],
  0x0399: ['GREEK CAPITAL LETTER IOTA', 'I'],
  0x039a: ['GREEK CAPITAL LETTER KAPPA', 'K'],
  0x039c: ['GREEK CAPITAL LETTER MU', 'M'],
  0x039d: ['GREEK CAPITAL LETTER NU', 'N'],
  0x039f: ['GREEK CAPITAL LETTER OMICRON', 'O'],
  0x03a1: ['GREEK CAPITAL LETTER RHO', 'P'],
  0x03a4: ['GREEK CAPITAL LETTER TAU', 'T'],
  0x03a5: ['GREEK CAPITAL LETTER UPSILON', 'Y'],
  0x03a7: ['GREEK CAPITAL LETTER CHI', 'X'],
  0x03b1: ['GREEK SMALL LETTER ALPHA', 'a'],
  0x03b9: ['GREEK SMALL LETTER IOTA', 'i'],
  0x03ba: ['GREEK SMALL LETTER KAPPA', 'k'],
  0x03bd: ['GREEK SMALL LETTER NU', 'v'],
  0x03bf: ['GREEK SMALL LETTER OMICRON', 'o'],
  0x03c1: ['GREEK SMALL LETTER RHO', 'p'],
  0x03c2: ['GREEK SMALL LETTER FINAL SIGMA', 's'],
  0x03c5: ['GREEK SMALL LETTER UPSILON', 'u'],
  0x03c7: ['GREEK SMALL LETTER CHI', 'x'],
  // Armenian
  0x054d: ['ARMENIAN CAPITAL LETTER SEH', 'U'],
  0x0555: ['ARMENIAN CAPITAL LETTER OH', 'O'],
  0x057d: ['ARMENIAN SMALL LETTER SEH', 'u'],
  0x0585: ['ARMENIAN SMALL LETTER OH', 'o'],
};

/** Fullwidth Latin letters/digits (U+FF00 block) — a regular formula, not a lookup table. */
function classifyFullwidth(codePoint: number): [name: string, replacement: string] | null {
  if (codePoint >= 0xff21 && codePoint <= 0xff3a) {
    const ch = String.fromCharCode(codePoint - 0xff21 + 'A'.charCodeAt(0));
    return [`FULLWIDTH LATIN CAPITAL LETTER ${ch}`, ch];
  }
  if (codePoint >= 0xff41 && codePoint <= 0xff5a) {
    const ch = String.fromCharCode(codePoint - 0xff41 + 'a'.charCodeAt(0));
    return [`FULLWIDTH LATIN SMALL LETTER ${ch.toUpperCase()}`, ch];
  }
  if (codePoint >= 0xff10 && codePoint <= 0xff19) {
    const ch = String.fromCharCode(codePoint - 0xff10 + '0'.charCodeAt(0));
    return [`FULLWIDTH DIGIT ${ch}`, ch];
  }
  return null;
}

// ------------------------------------------------------------------------- scanning

interface Classification {
  category: CharCategory;
  name: string;
  abbr: string;
  replacement: string;
}

function classifyCodePoint(codePoint: number): Classification | null {
  const bidi = BIDI[codePoint];
  if (bidi) return { category: 'bidi', name: bidi[0], abbr: bidi[1], replacement: '' };

  const invisible = INVISIBLE[codePoint] ?? classifyInvisibleRange(codePoint);
  if (invisible) return { category: 'invisible', name: invisible[0], abbr: invisible[1], replacement: '' };

  const whitespace = WHITESPACE[codePoint];
  if (whitespace) return { category: 'whitespace', name: whitespace[0], abbr: whitespace[1], replacement: whitespace[2] };

  const control = classifyControl(codePoint);
  if (control) return { category: 'control', name: control[0], abbr: control[1], replacement: '' };

  const homoglyph = HOMOGLYPHS[codePoint] ?? classifyFullwidth(codePoint);
  if (homoglyph) return { category: 'homoglyph', name: homoglyph[0], abbr: homoglyph[1], replacement: homoglyph[1] };

  return null;
}

/**
 * Scans `text` code point by code point (not UTF-16 code unit — a surrogate pair is
 * treated as one character) and returns every flagged character in order.
 */
export function scanText(text: string): FoundChar[] {
  const found: FoundChar[] = [];
  let i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i)!;
    const char = String.fromCodePoint(codePoint);
    const info = classifyCodePoint(codePoint);
    if (info) {
      found.push({ index: i, char, codePoint, name: info.name, abbr: info.abbr, category: info.category, replacement: info.replacement });
    }
    i += char.length;
  }
  return found;
}

export interface ScanStats {
  /** Unicode code points, not UTF-16 code units — matches what a person would count as "characters". */
  totalCodePoints: number;
  totalBytes: number;
  total: number;
  byCategory: Record<CharCategory, number>;
}

export function computeStats(text: string, found: FoundChar[]): ScanStats {
  const byCategory: Record<CharCategory, number> = { bidi: 0, homoglyph: 0, invisible: 0, control: 0, whitespace: 0 };
  for (const f of found) byCategory[f.category] += 1;

  return {
    totalCodePoints: Array.from(text).length,
    totalBytes: new TextEncoder().encode(text).length,
    total: found.length,
    byCategory,
  };
}

export interface CleanOptions {
  bidi: boolean;
  homoglyph: boolean;
  invisible: boolean;
  control: boolean;
  whitespace: boolean;
}

/**
 * Homoglyphs default off: replacing them is a judgment call that can be wrong for
 * genuine non-Latin text (see describeHomoglyphRisk), unlike the other four categories,
 * which are safe to strip unconditionally.
 */
export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  bidi: true,
  homoglyph: false,
  invisible: true,
  control: true,
  whitespace: true,
};

/** Applies `options` to every found character, in one pass over `text`. */
export function cleanText(text: string, found: FoundChar[], options: CleanOptions): string {
  if (found.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const f of found) {
    if (!options[f.category]) continue;
    result += text.slice(cursor, f.index) + f.replacement;
    cursor = f.index + f.char.length;
  }
  return result + text.slice(cursor);
}

export interface InspectSegment {
  text: string;
  /** null for an ordinary, unflagged run of text. */
  found: FoundChar | null;
}

/** Splits `text` into flagged/unflagged runs so the UI can render an annotated preview. */
export function toInspectSegments(text: string, found: FoundChar[]): InspectSegment[] {
  if (found.length === 0) return text === '' ? [] : [{ text, found: null }];

  const segments: InspectSegment[] = [];
  let cursor = 0;
  for (const f of found) {
    if (f.index > cursor) segments.push({ text: text.slice(cursor, f.index), found: null });
    segments.push({ text: f.char, found: f });
    cursor = f.index + f.char.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), found: null });
  return segments;
}

export interface HomoglyphRisk {
  message: string;
  /** 'warning' when the surrounding text is mostly ASCII (likely spoofing); 'info' otherwise. */
  level: 'warning' | 'info';
}

/**
 * Homoglyphs are flagged unconditionally (see HOMOGLYPHS above), so genuine Russian,
 * Greek or Armenian text triggers matches for its own letters too — that's correct, not
 * a false positive, but it reads very differently from a handful of look-alikes hiding
 * inside otherwise-ASCII text. This gives the UI a way to tell the two apart.
 */
export function describeHomoglyphRisk(text: string, found: FoundChar[]): HomoglyphRisk | null {
  if (!found.some((f) => f.category === 'homoglyph')) return null;

  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return null;
  const asciiLetters = letters.filter((ch) => /[A-Za-z]/.test(ch)).length;
  const asciiRatio = asciiLetters / letters.length;

  return asciiRatio >= 0.6
    ? {
        level: 'warning',
        message:
          'This text is mostly plain ASCII but contains letters from another script that render identically to Latin letters — a common way to spoof a domain, username, or brand name.',
      }
    : {
        level: 'info',
        message:
          'This text is written mostly in a non-Latin script, and some of its own letters happen to look like Latin ones — expected for genuine text in that language, not necessarily a sign of tampering.',
      };
}
