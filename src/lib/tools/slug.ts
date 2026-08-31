import { type ToolResult, ok, err } from './result';

export interface SlugOptions {
  separator: '-' | '_';
  /** Off preserves the case of surviving letters instead of forcing lowercase. */
  lowercase: boolean;
  /** 0 means no limit. Truncation never cuts a word in half. */
  maxLength: number;
}

export const DEFAULT_SLUG_OPTIONS: SlugOptions = {
  separator: '-',
  lowercase: true,
  maxLength: 0,
};

/** Upper bound on the `maxLength` option itself, not on the input text. */
export const MAX_SLUG_LENGTH = 200;

// Common shorthand people expect preserved as words rather than dropped outright.
const WORD_SUBSTITUTIONS: [RegExp, string][] = [
  [/&/g, ' and '],
  [/@/g, ' at '],
  [/%/g, ' percent '],
];

/** Strips combining diacritical marks left behind by NFKD normalization, e.g. turns "é" (e + ´) into "e". */
const COMBINING_MARKS = /[̀-ͯ]/g;

function stripDiacritics(text: string): string {
  return text.normalize('NFKD').replace(COMBINING_MARKS, '');
}

function validateOptions(options: SlugOptions): string | null {
  if (!Number.isInteger(options.maxLength) || options.maxLength < 0 || options.maxLength > MAX_SLUG_LENGTH) {
    return `Max length must be a whole number between 0 (no limit) and ${MAX_SLUG_LENGTH}.`;
  }
  return null;
}

/** Truncates to at most `maxLength` characters without cutting a word in half. */
function truncateAtSeparator(slug: string, maxLength: number, separator: string): string {
  if (maxLength <= 0 || slug.length <= maxLength) return slug;

  const cut = slug.slice(0, maxLength);
  const lastSeparator = cut.lastIndexOf(separator);
  const truncated = lastSeparator > 0 ? cut.slice(0, lastSeparator) : cut;
  return truncated.replace(new RegExp(`\\${separator}+$`), '');
}

/**
 * Converts arbitrary text into a URL-friendly slug: strips accents, substitutes a
 * few common symbols with words, and replaces every other run of non-alphanumeric
 * characters with a single separator.
 */
export function generateSlug(input: string, options: SlugOptions = DEFAULT_SLUG_OPTIONS): ToolResult<string> {
  if (input.trim() === '') {
    return err('Enter some text to turn into a slug.');
  }

  const optionsError = validateOptions(options);
  if (optionsError) return err(optionsError);

  let text = stripDiacritics(input);
  for (const [pattern, replacement] of WORD_SUBSTITUTIONS) {
    text = text.replace(pattern, replacement);
  }
  if (options.lowercase) text = text.toLowerCase();

  const sep = options.separator;
  const escapedSep = `\\${sep}`;
  let slug = text
    .replace(/[^a-zA-Z0-9]+/g, sep)
    .replace(new RegExp(`${escapedSep}{2,}`, 'g'), sep)
    .replace(new RegExp(`^${escapedSep}+|${escapedSep}+$`, 'g'), '');

  slug = truncateAtSeparator(slug, options.maxLength, sep);

  if (slug === '') {
    return err(
      'This text has no characters left after slugifying. Accented Latin letters are converted, but scripts like Chinese, Arabic, Cyrillic or Japanese are not transliterated into Latin letters.'
    );
  }

  return ok(slug);
}
