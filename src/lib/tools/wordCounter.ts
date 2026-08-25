/**
 * Word/character counting, case conversion, and literal find/replace — all pure text
 * transforms with no DOM or framework dependency, per this repo's lib/tools layering.
 */

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const READING_WPM = 200;
const SPEAKING_WPM = 150;
const TOP_WORDS_LIMIT = 10;

export interface TopWord {
  word: string;
  count: number;
}

export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  uniqueWords: number;
  avgWordLength: number;
  avgSentenceLength: number;
  syllables: number;
  readingTimeSeconds: number;
  speakingTimeSeconds: number;
  topWords: TopWord[];
}

function tokenizeWords(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** Vowel-group heuristic — an estimate, not a dictionary lookup. */
function countSyllablesInWord(word: string): number {
  const lower = word.toLowerCase();
  const groups = lower.match(/[aeiouy]+/g) ?? [];
  let count = groups.length;
  if (count > 1 && lower.endsWith('e') && !lower.endsWith('le')) count -= 1;
  return Math.max(count, 1);
}

function countSentences(trimmed: string): number {
  if (trimmed === '') return 0;
  const runs = trimmed.match(/[^.!?]*[.!?]+|[^.!?]+$/g) ?? [];
  return runs.filter((run) => run.trim() !== '').length;
}

function countParagraphs(trimmed: string): number {
  if (trimmed === '') return 0;
  return trimmed.split(/\n\s*\n+/).filter((p) => p.trim() !== '').length;
}

export function computeStats(text: string): TextStats {
  const words = tokenizeWords(text);
  const lowerWords = words.map((w) => w.toLowerCase());
  const trimmed = text.trim();

  const frequency = new Map<string, number>();
  for (const w of lowerWords) frequency.set(w, (frequency.get(w) ?? 0) + 1);
  const topWords = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_WORDS_LIMIT)
    .map(([word, count]) => ({ word, count }));

  const sentences = countSentences(trimmed);

  return {
    words: words.length,
    characters: Array.from(text).length,
    charactersNoSpaces: Array.from(text.replace(/\s/g, '')).length,
    sentences,
    paragraphs: countParagraphs(trimmed),
    lines: text === '' ? 0 : text.split('\n').length,
    uniqueWords: new Set(lowerWords).size,
    avgWordLength: words.length > 0 ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0,
    avgSentenceLength: sentences > 0 ? words.length / sentences : 0,
    syllables: words.reduce((sum, w) => sum + countSyllablesInWord(w), 0),
    readingTimeSeconds: Math.ceil((words.length / READING_WPM) * 60),
    speakingTimeSeconds: Math.ceil((words.length / SPEAKING_WPM) * 60),
    topWords,
  };
}

/**
 * Deliberately excludes 'sentence' — every type here is a synchronous, deterministic string
 * transform, which a dictionary-free sentence case can't be (it needs proper-noun judgment).
 * See applySentenceCase in ./sentenceCase.ts for that: a separate, async, NLP-backed feature
 * with its own UI treatment (loading state, low-confidence highlighting, limitations
 * warning) rather than shoehorned into this array's plain-button interface.
 */
export const CASE_TYPES = ['upper', 'lower', 'title', 'camel', 'pascal', 'snake', 'constant', 'kebab', 'dot'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_LABELS: Record<CaseType, string> = {
  upper: 'UPPERCASE',
  lower: 'lowercase',
  title: 'Title Case',
  camel: 'camelCase',
  pascal: 'PascalCase',
  snake: 'snake_case',
  constant: 'CONSTANT_CASE',
  kebab: 'kebab-case',
  dot: 'dot.case',
};

/**
 * Splits text into identifier-style words: on whitespace/`_`/`-`/`.`, and on existing
 * camelCase/PascalCase boundaries (including acronym runs like "XMLParser" -> "XML",
 * "Parser") — so re-casing already-cased identifiers produces the expected words.
 */
function splitIdentifierWords(text: string): string[] {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[\s_.-]+/u)
    .filter((w) => w !== '');
}

const capitalize = (word: string): string => word[0]!.toUpperCase() + word.slice(1).toLowerCase();

/**
 * Short articles, coordinating conjunctions and prepositions that real Title Case leaves
 * lowercase — matching how every mainstream style guide (AP, Chicago) and every other
 * "Title Case" converter actually behaves. Capitalizing every single word is a common
 * mistake, not a style choice, so this list is applied unconditionally except at the very
 * start and end of the text, which are always capitalized regardless.
 */
const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'en', 'for', 'if', 'in', 'nor', 'of', 'on',
  'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs', 'yet', 'from', 'into', 'than', 'off',
]);

export function convertCase(text: string, type: CaseType): string {
  switch (type) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title': {
      // Preserves original whitespace/punctuation — only prose-style cases do this;
      // the identifier-style cases below have no concept of whitespace to preserve. Uses
      // the same WORD_RE as everywhere else in this file, so a contraction like "don't"
      // is matched as one token ("Don't") instead of being split on the apostrophe and
      // capitalized on both sides ("Don'T").
      const matches = [...text.matchAll(WORD_RE)];
      if (matches.length === 0) return text;

      const lastIndex = matches.length - 1;
      let result = '';
      let cursor = 0;
      matches.forEach((match, i) => {
        const word = match[0];
        const start = match.index;
        result += text.slice(cursor, start);
        const isMinor = i !== 0 && i !== lastIndex && TITLE_CASE_MINOR_WORDS.has(word.toLowerCase());
        result += isMinor ? word.toLowerCase() : capitalize(word);
        cursor = start + word.length;
      });
      return result + text.slice(cursor);
    }
    case 'camel':
      return splitIdentifierWords(text)
        .map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w)))
        .join('');
    case 'pascal':
      return splitIdentifierWords(text).map(capitalize).join('');
    case 'snake':
      return splitIdentifierWords(text)
        .map((w) => w.toLowerCase())
        .join('_');
    case 'constant':
      return splitIdentifierWords(text)
        .map((w) => w.toUpperCase())
        .join('_');
    case 'kebab':
      return splitIdentifierWords(text)
        .map((w) => w.toLowerCase())
        .join('-');
    case 'dot':
      return splitIdentifierWords(text)
        .map((w) => w.toLowerCase())
        .join('.');
  }
}

export interface TextMatch {
  start: number;
  end: number;
}

/** Literal (non-regex) substring search — regex find/replace is Regex Tester's job. */
export function findMatches(text: string, query: string, caseSensitive: boolean): TextMatch[] {
  if (query === '') return [];

  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];

  let cursor = 0;
  let index = haystack.indexOf(needle, cursor);
  while (index !== -1) {
    matches.push({ start: index, end: index + needle.length });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  return matches;
}

export function replaceAll(text: string, query: string, replacement: string, caseSensitive: boolean): string {
  const matches = findMatches(text, query, caseSensitive);
  if (matches.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }
  return result + text.slice(cursor);
}

export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

/** Splits text into matched/unmatched runs so the UI can highlight without building HTML strings. */
export function toHighlightSegments(text: string, matches: TextMatch[]): HighlightSegment[] {
  if (matches.length === 0) return text === '' ? [] : [{ text, isMatch: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), isMatch: false });
    segments.push({ text: text.slice(match.start, match.end), isMatch: true });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), isMatch: false });
  return segments;
}
