/**
 * The standard 7-bit ASCII table (0-127). Deliberately not extended past 127: "extended
 * ASCII" (128-255) is not one standard — it varies by code page (Latin-1, Windows-1252,
 * DOS/OEM, ...), so any single 128-255 table would be presenting one vendor's choice as
 * "the" answer. True ASCII stops at 127 and is unambiguous.
 */

export type AsciiCategory = 'control' | 'printable';

export interface AsciiEntry {
  dec: number;
  hex: string;
  oct: string;
  bin: string;
  /** The literal character, for printable entries. Empty for control codes, which have no visible glyph. */
  char: string;
  /** Caret-notation control sequence (e.g. "^I" for Tab) for control codes; the character itself otherwise. */
  symbol: string;
  name: string;
  /** Short mnemonic (NUL, HT, DEL, ...) for control codes; null for printable characters. */
  abbr: string | null;
  category: AsciiCategory;
}

const CONTROL_NAMES: ReadonlyArray<readonly [abbr: string, name: string]> = [
  ['NUL', 'Null'],
  ['SOH', 'Start of Heading'],
  ['STX', 'Start of Text'],
  ['ETX', 'End of Text'],
  ['EOT', 'End of Transmission'],
  ['ENQ', 'Enquiry'],
  ['ACK', 'Acknowledge'],
  ['BEL', 'Bell'],
  ['BS', 'Backspace'],
  ['HT', 'Horizontal Tab'],
  ['LF', 'Line Feed'],
  ['VT', 'Vertical Tab'],
  ['FF', 'Form Feed'],
  ['CR', 'Carriage Return'],
  ['SO', 'Shift Out'],
  ['SI', 'Shift In'],
  ['DLE', 'Data Link Escape'],
  ['DC1', 'Device Control 1 (XON)'],
  ['DC2', 'Device Control 2'],
  ['DC3', 'Device Control 3 (XOFF)'],
  ['DC4', 'Device Control 4'],
  ['NAK', 'Negative Acknowledge'],
  ['SYN', 'Synchronous Idle'],
  ['ETB', 'End of Transmission Block'],
  ['CAN', 'Cancel'],
  ['EM', 'End of Medium'],
  ['SUB', 'Substitute'],
  ['ESC', 'Escape'],
  ['FS', 'File Separator'],
  ['GS', 'Group Separator'],
  ['RS', 'Record Separator'],
  ['US', 'Unit Separator'],
];

const PUNCTUATION_NAMES: Readonly<Record<number, string>> = {
  33: 'Exclamation Mark',
  34: 'Quotation Mark',
  35: 'Number Sign',
  36: 'Dollar Sign',
  37: 'Percent Sign',
  38: 'Ampersand',
  39: 'Apostrophe',
  40: 'Left Parenthesis',
  41: 'Right Parenthesis',
  42: 'Asterisk',
  43: 'Plus Sign',
  44: 'Comma',
  45: 'Hyphen-Minus',
  46: 'Full Stop',
  47: 'Solidus',
  58: 'Colon',
  59: 'Semicolon',
  60: 'Less-Than Sign',
  61: 'Equals Sign',
  62: 'Greater-Than Sign',
  63: 'Question Mark',
  64: 'Commercial At',
  91: 'Left Square Bracket',
  92: 'Reverse Solidus',
  93: 'Right Square Bracket',
  94: 'Circumflex Accent',
  95: 'Low Line',
  96: 'Grave Accent',
  123: 'Left Curly Bracket',
  124: 'Vertical Line',
  125: 'Right Curly Bracket',
  126: 'Tilde',
};

const DIGIT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function buildEntry(dec: number): AsciiEntry {
  const hex = dec.toString(16).toUpperCase().padStart(2, '0');
  const oct = dec.toString(8).padStart(3, '0');
  const bin = dec.toString(2).padStart(8, '0');

  if (dec === 32) {
    return { dec, hex, oct, bin, char: ' ', symbol: 'SP', name: 'Space', abbr: 'SP', category: 'printable' };
  }
  if (dec === 127) {
    return { dec, hex, oct, bin, char: '', symbol: '^?', name: 'Delete', abbr: 'DEL', category: 'control' };
  }
  if (dec < 32) {
    const entry = CONTROL_NAMES[dec];
    if (!entry) throw new Error(`No control-character name defined for code ${dec}.`);
    const [abbr, name] = entry;
    // Standard caret notation: Ctrl+<letter> maps to code (letter - 64).
    return { dec, hex, oct, bin, char: '', symbol: `^${String.fromCharCode(dec + 64)}`, name, abbr, category: 'control' };
  }

  const char = String.fromCharCode(dec);
  let name: string;
  if (dec >= 48 && dec <= 57) name = `Digit ${DIGIT_WORDS[dec - 48]}`;
  else if (dec >= 65 && dec <= 90) name = `Latin Capital Letter ${char}`;
  else if (dec >= 97 && dec <= 122) name = `Latin Small Letter ${char.toUpperCase()}`;
  else name = PUNCTUATION_NAMES[dec] ?? char;

  return { dec, hex, oct, bin, char, symbol: char, name, abbr: null, category: 'printable' };
}

export const ASCII_TABLE: readonly AsciiEntry[] = Array.from({ length: 128 }, (_, dec) => buildEntry(dec));

/**
 * Searches the table by exact character, decimal/hex/Unicode-style code, or a substring
 * of the character's name/mnemonic. Empty query returns the full table.
 */
export function searchAsciiTable(query: string): AsciiEntry[] {
  const trimmed = query.trim();
  if (trimmed === '') return [...ASCII_TABLE];

  if (trimmed.length === 1) {
    const exact = ASCII_TABLE.filter((entry) => entry.char === trimmed);
    if (exact.length > 0) return exact;
  }

  const hexMatch = /^(?:0x|u\+|\\u)([0-9a-f]{1,4})$/i.exec(trimmed);
  if (hexMatch) {
    const dec = parseInt(hexMatch[1]!, 16);
    return ASCII_TABLE.filter((entry) => entry.dec === dec);
  }

  if (/^\d+$/.test(trimmed)) {
    const dec = parseInt(trimmed, 10);
    return ASCII_TABLE.filter((entry) => entry.dec === dec);
  }

  const lower = trimmed.toLowerCase();
  return ASCII_TABLE.filter(
    (entry) => entry.name.toLowerCase().includes(lower) || (entry.abbr?.toLowerCase().includes(lower) ?? false)
  );
}

/** A compact, copy-friendly one-line summary of a single entry. */
export function formatAsciiEntry(entry: AsciiEntry): string {
  const glyph = entry.category === 'control' ? `${entry.abbr} (${entry.symbol})` : entry.char;
  return `${glyph} — dec ${entry.dec}, hex ${entry.hex}, oct ${entry.oct}, bin ${entry.bin} (${entry.name})`;
}

/** Tab-separated table of the given entries, with a header row — for a bulk "copy results" action. */
export function formatAsciiTable(entries: readonly AsciiEntry[]): string {
  const header = ['Dec', 'Hex', 'Oct', 'Bin', 'Char', 'Name'].join('\t');
  const rows = entries.map((entry) =>
    [entry.dec, entry.hex, entry.oct, entry.bin, entry.category === 'control' ? entry.abbr : entry.char, entry.name].join('\t')
  );
  return [header, ...rows].join('\n');
}
