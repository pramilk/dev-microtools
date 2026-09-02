/**
 * Looks up any Unicode code point — not just ASCII — using properties the JS engine's
 * own ICU data already knows (`\p{General_Category=...}` / `\p{Script=...}` regex
 * properties), so this needs no bundled character database. The one thing that approach
 * can't give is the character's official *name* ("LATIN SMALL LETTER E WITH ACUTE") —
 * that lives only in a multi-megabyte Unicode names table, which the site's performance
 * budget rules out (the same call already made for the homoglyph table in
 * invisibleChars.ts). ASCII characters keep their name from asciiTable.ts; everything
 * else deliberately shows no name.
 */

export interface UnicodeCharInfo {
  codePoint: number;
  /** Upper-case hex, zero-padded to at least 4 digits (U+0041, U+1F600). */
  hex: string;
  char: string;
  /** Upper-case hex bytes, e.g. ["F0", "9F", "98", "80"]. */
  utf8Bytes: string[];
  /** Upper-case hex code units, one entry for BMP characters, two for a surrogate pair. */
  utf16Units: string[];
  /** Two-letter Unicode General_Category value, e.g. "Lu", "So". */
  category: string;
  categoryLabel: string;
  /** Unicode script name, e.g. "Latin", "Han", "Common". Null only if every candidate script failed to compile in this engine. */
  script: string | null;
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  Lu: 'Uppercase Letter',
  Ll: 'Lowercase Letter',
  Lt: 'Titlecase Letter',
  Lm: 'Modifier Letter',
  Lo: 'Other Letter',
  Mn: 'Nonspacing Mark',
  Mc: 'Spacing Mark',
  Me: 'Enclosing Mark',
  Nd: 'Decimal Number',
  Nl: 'Letter Number',
  No: 'Other Number',
  Pc: 'Connector Punctuation',
  Pd: 'Dash Punctuation',
  Ps: 'Open Punctuation',
  Pe: 'Close Punctuation',
  Pi: 'Initial Punctuation',
  Pf: 'Final Punctuation',
  Po: 'Other Punctuation',
  Sm: 'Math Symbol',
  Sc: 'Currency Symbol',
  Sk: 'Modifier Symbol',
  So: 'Other Symbol',
  Zs: 'Space Separator',
  Zl: 'Line Separator',
  Zp: 'Paragraph Separator',
  Cc: 'Control',
  Cf: 'Format',
  Cs: 'Surrogate',
  Co: 'Private Use',
  Cn: 'Unassigned',
};

/** Categories a raw glyph is safe to render directly — everything invisible, a raw
 *  control byte, or capable of altering surrounding text direction is excluded. */
export const RENDERABLE_CATEGORIES: ReadonlySet<string> = new Set(
  Object.keys(CATEGORY_LABELS).filter((code) => !['Cc', 'Cf', 'Cs', 'Co', 'Zl', 'Zp'].includes(code))
);

/**
 * A broad but not exhaustive set of Unicode scripts — enough to identify almost anything
 * a visitor actually pastes. "Common" and "Inherited" are tried last, since they'd
 * otherwise swallow digits/punctuation/combining marks that belong to a more specific
 * script check first (there is none here) or are genuinely script-neutral.
 */
const SPECIFIC_SCRIPTS = [
  'Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Devanagari',
  'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala',
  'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Georgian', 'Hangul', 'Ethiopic', 'Cherokee',
  'Canadian_Aboriginal', 'Ogham', 'Runic', 'Khmer', 'Mongolian', 'Hiragana', 'Katakana', 'Bopomofo',
  'Han', 'Yi', 'Old_Italic', 'Gothic', 'Deseret', 'Tagalog', 'Hanunoo', 'Buhid', 'Tagbanwa', 'Limbu',
  'Tai_Le', 'Linear_B', 'Ugaritic', 'Shavian', 'Osmanya', 'Cypriot', 'Braille', 'Buginese', 'Coptic',
  'New_Tai_Lue', 'Glagolitic', 'Tifinagh', 'Syloti_Nagri', 'Old_Persian', 'Kharoshthi', 'Balinese',
  'Cuneiform', 'Phoenician', 'Phags_Pa', 'Nko', 'Sundanese', 'Lepcha', 'Ol_Chiki', 'Vai',
  'Saurashtra', 'Kayah_Li', 'Rejang', 'Cham', 'Tai_Tham', 'Tai_Viet', 'Avestan',
  'Egyptian_Hieroglyphs', 'Samaritan', 'Lisu', 'Bamum', 'Javanese', 'Meetei_Mayek',
  'Imperial_Aramaic', 'Old_Turkic', 'Kaithi', 'Batak', 'Brahmi', 'Mandaic', 'Chakma', 'Miao',
  'Sharada', 'Takri', 'Adlam', 'Osage', 'Hanifi_Rohingya', 'Wancho', 'Medefaidrin', 'Nushu',
  'Soyombo', 'Zanabazar_Square', 'Dogra', 'Gunjala_Gondi', 'Makasar', 'Nandinagari', 'Bhaiksuki',
  'Marchen',
];
const FALLBACK_SCRIPTS = ['Common', 'Inherited'];

interface CompiledMatcher<T> {
  value: T;
  regex: RegExp;
}

/** Compiles once at module load — a RegExp per candidate is cheap to build but pointless
 *  to rebuild on every keystroke. An unsupported property value is skipped, not fatal. */
function compileMatchers<T extends string>(values: readonly T[], property: 'General_Category' | 'Script'): CompiledMatcher<T>[] {
  const matchers: CompiledMatcher<T>[] = [];
  for (const value of values) {
    try {
      matchers.push({ value, regex: new RegExp(`^\\p{${property}=${value}}$`, 'u') });
    } catch {
      // Unsupported property value in this engine — skip rather than fail the whole lookup.
    }
  }
  return matchers;
}

const CATEGORY_CODES = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;
const CATEGORY_MATCHERS = compileMatchers(CATEGORY_CODES, 'General_Category');
const SCRIPT_MATCHERS = compileMatchers([...SPECIFIC_SCRIPTS, ...FALLBACK_SCRIPTS], 'Script');

function isValidCodePoint(codePoint: number): boolean {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
}

/** Full detail for a single valid code point, or null if it's out of range or a lone surrogate half. */
export function describeCodePoint(codePoint: number): UnicodeCharInfo | null {
  if (!isValidCodePoint(codePoint)) return null;

  const char = String.fromCodePoint(codePoint);
  const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
  const utf8Bytes = Array.from(new TextEncoder().encode(char), (byte) => byte.toString(16).toUpperCase().padStart(2, '0'));

  const utf16Units: string[] = [];
  for (let i = 0; i < char.length; i += 1) {
    utf16Units.push(char.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'));
  }

  const category = CATEGORY_MATCHERS.find((m) => m.regex.test(char))?.value ?? 'Cn';
  const categoryLabel = CATEGORY_LABELS[category] ?? 'Unassigned';
  const script = SCRIPT_MATCHERS.find((m) => m.regex.test(char))?.value ?? null;

  return { codePoint, hex, char, utf8Bytes, utf16Units, category, categoryLabel, script };
}

/**
 * Parses a search query into a single code point: a literal character (any Unicode
 * character, not just ASCII — correctly handles a surrogate-pair emoji as one code
 * point), a decimal number, or a hex code point as 0x/U+/\u(with or without braces).
 * Returns null for anything else, including multi-character text — this is a single
 * code-point lookup, not a text search.
 */
export function parseCodePointQuery(query: string): number | null {
  const trimmed = query.trim();
  if (trimmed === '') return null;

  const chars = Array.from(trimmed);
  if (chars.length === 1) return chars[0]!.codePointAt(0) ?? null;

  const hexMatch = /^(?:0x|u\+|\\u\{?)([0-9a-f]{1,6})\}?$/i.exec(trimmed);
  if (hexMatch) {
    const codePoint = parseInt(hexMatch[1]!, 16);
    return isValidCodePoint(codePoint) ? codePoint : null;
  }

  if (/^\d+$/.test(trimmed)) {
    const codePoint = parseInt(trimmed, 10);
    return isValidCodePoint(codePoint) ? codePoint : null;
  }

  return null;
}

/** A compact, copy-friendly text block for a single code point's details. */
export function formatUnicodeCharInfo(info: UnicodeCharInfo): string {
  return [
    `char: ${info.char}`,
    `code point: U+${info.hex} (${info.codePoint})`,
    `UTF-8: ${info.utf8Bytes.join(' ')}`,
    `UTF-16: ${info.utf16Units.join(' ')}`,
    `category: ${info.category} (${info.categoryLabel})`,
    `script: ${info.script ?? 'unknown'}`,
  ].join('\n');
}
