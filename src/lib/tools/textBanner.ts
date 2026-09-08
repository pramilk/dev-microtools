import { type ToolResult, ok, err } from './result';

/**
 * A 5-column × 7-row dot-matrix font, hand-authored for this tool: '#' is ink, '.' is
 * blank, and every glyph is exactly `GLYPH_HEIGHT` strings of `GLYPH_WIDTH` characters.
 * Keys are always uppercase — lowercase input is upper-cased before lookup, the same
 * convention every classic text-banner tool (figlet included) uses, since a serif-free
 * 5-wide cell has no real room for ascenders/descenders to read as genuinely lowercase.
 */
export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

const FONT: Record<string, string[]> = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '..##.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  ':': ['.....', '..#..', '.....', '.....', '..#..', '.....', '.....'],
  ';': ['.....', '..#..', '.....', '.....', '..#..', '.#...', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['....#', '...#.', '..#..', '..#..', '..#..', '.#...', '#....'],
  '\\': ['#....', '.#...', '..#..', '..#..', '..#..', '...#.', '....#'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '*': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '@': ['.###.', '#...#', '#.##.', '#.#.#', '#.##.', '#....', '.###.'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '<': ['....#', '...#.', '..#..', '.#...', '..#..', '...#.', '....#'],
  '>': ['#....', '.#...', '..#..', '...#.', '..#..', '.#...', '#....'],
};

/** Every character (other than space) this font can render, for the FAQ/hint copy. */
export const SUPPORTED_CHARACTERS = Object.keys(FONT)
  .filter((char) => char !== ' ')
  .join('');

export interface FillPreset {
  id: string;
  label: string;
  char: string;
  description: string;
}

export const FILL_PRESETS: readonly FillPreset[] = [
  { id: 'block', label: 'Block', char: '█', description: 'Solid Unicode block — reads as a poster at a glance.' },
  { id: 'hash', label: 'Hash', char: '#', description: 'Classic plain-ASCII banner style, like early figlet output.' },
  { id: 'star', label: 'Star', char: '*', description: 'A lighter, more open look than a solid block.' },
  { id: 'at', label: 'At', char: '@', description: 'Dense but still plain ASCII.' },
];

/** Sentinel id for "the visitor typed their own fill character". */
export const CUSTOM_FILL_ID = 'custom';

export const DEFAULT_FILL_ID = 'block';

export const MIN_SCALE = 1;
export const MAX_SCALE = 3;
export const DEFAULT_SCALE = 1;

export const MIN_LETTER_SPACING = 0;
export const MAX_LETTER_SPACING = 3;
export const DEFAULT_LETTER_SPACING = 1;

/**
 * Caps per-line length and line count. Both are small on purpose: this is a banner, not a
 * paragraph — a longer line is still legible, but at 3x scale it stops fitting anywhere a
 * banner is actually used (a README, a terminal MOTD, a commit message) and starts being
 * awkward to even preview. Multiplied together with `MAX_SCALE`, the worst case is a
 * comfortably small few hundred rows/columns, so no separate total-cell guard is needed.
 */
export const MAX_LINE_LENGTH = 24;
export const MAX_LINES = 6;

export interface TextBannerOptions {
  /** Exactly one character, used for every "ink" cell. */
  fillChar: string;
  /** 1-3. Each glyph cell is repeated `scale` times in both directions. */
  scale: number;
  /** 0-3 blank columns inserted between adjacent letters. */
  letterSpacing: number;
}

export const DEFAULT_TEXT_BANNER_OPTIONS: TextBannerOptions = {
  fillChar: FILL_PRESETS[0]!.char,
  scale: DEFAULT_SCALE,
  letterSpacing: DEFAULT_LETTER_SPACING,
};

export interface TextBannerResult {
  output: string;
  /** Original-case characters that aren't in this font, deduplicated, in first-seen order —
   *  each was rendered as a blank cell rather than silently dropped. */
  unsupportedCharacters: string[];
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A fill character must be exactly one grapheme and can't be blank — a space would make
 *  every "ink" cell invisible, silently producing empty-looking output. */
export function validateFillChar(fillChar: string): ToolResult<string> {
  const chars = Array.from(fillChar);
  if (chars.length !== 1) {
    return err('The fill character must be exactly one character.');
  }
  if (chars[0] === ' ') {
    return err('The fill character can’t be a blank space — pick a visible character.');
  }
  return ok(chars[0]!);
}

/**
 * Renders arbitrary text as big block-letter ASCII art, one stacked banner per input line.
 *
 * Each character is looked up in the built-in 5×7 font (upper-cased first, since the font
 * has no separate lowercase forms), scaled up by repeating cells, and separated from its
 * neighbours by `letterSpacing` blank columns. A character with no glyph — anything outside
 * `SUPPORTED_CHARACTERS` and a plain space — renders as a blank cell rather than breaking
 * alignment, and is reported back in `unsupportedCharacters` so the caller can surface it
 * rather than have it silently vanish.
 */
export function renderTextBanner(text: string, options: TextBannerOptions): ToolResult<TextBannerResult> {
  if (text.trim() === '') {
    return err('Type some text to convert.');
  }

  const fillCheck = validateFillChar(options.fillChar);
  if (!fillCheck.ok) return err(fillCheck.error);
  const fillChar = fillCheck.value;

  const lines = text.split('\n');
  if (lines.length > MAX_LINES) {
    return err(`This tool supports up to ${MAX_LINES} lines at once (got ${lines.length}). Remove some line breaks.`);
  }
  const longLine = lines.find((line) => line.length > MAX_LINE_LENGTH);
  if (longLine !== undefined) {
    return err(
      `One of your lines is ${longLine.length} characters — this tool supports up to ${MAX_LINE_LENGTH} per line so the banner stays a reasonable size. Shorten it or split it across more lines.`
    );
  }

  const scale = clamp(Math.round(options.scale), MIN_SCALE, MAX_SCALE);
  const spacing = clamp(Math.round(options.letterSpacing), MIN_LETTER_SPACING, MAX_LETTER_SPACING);

  const unsupported: string[] = [];
  const seenUnsupported = new Set<string>();
  const outputLines: string[] = [];

  for (const line of lines) {
    if (line === '') {
      outputLines.push('');
      continue;
    }

    const characters = Array.from(line);
    const glyphRows: string[] = new Array(GLYPH_HEIGHT).fill('');

    characters.forEach((rawChar, index) => {
      const glyph = FONT[rawChar.toUpperCase()];
      if (!glyph && rawChar !== ' ' && !seenUnsupported.has(rawChar)) {
        seenUnsupported.add(rawChar);
        unsupported.push(rawChar);
      }
      const rows = glyph ?? FONT[' ']!;
      const gap = index < characters.length - 1 ? '.'.repeat(spacing) : '';
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        glyphRows[row] += rows[row] + gap;
      }
    });

    for (const cellRow of glyphRows) {
      const scaledRow = Array.from(cellRow)
        .map((cell) => (cell === '#' ? fillChar : ' ').repeat(scale))
        .join('')
        .replace(/\s+$/, '');
      for (let repeat = 0; repeat < scale; repeat += 1) {
        outputLines.push(scaledRow);
      }
    }
  }

  return ok({ output: outputLines.join('\n'), unsupportedCharacters: unsupported });
}
