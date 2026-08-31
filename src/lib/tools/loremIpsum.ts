import { type ToolResult, ok, err } from './result';

export type LoremUnit = 'paragraphs' | 'sentences' | 'words';

export interface LoremIpsumOptions {
  unit: LoremUnit;
  count: number;
  /** When off, generation starts partway through the passage instead of with the classic opening. */
  startWithLorem: boolean;
  /** Wraps the output in `<p>` tags — one per paragraph in paragraphs mode, one overall otherwise. */
  asHtml: boolean;
}

export const DEFAULT_LOREM_OPTIONS: LoremIpsumOptions = {
  unit: 'paragraphs',
  count: 5,
  startWithLorem: true,
  asHtml: false,
};

export const LOREM_LIMITS: Record<LoremUnit, { min: number; max: number }> = {
  paragraphs: { min: 1, max: 50 },
  sentences: { min: 1, max: 300 },
  words: { min: 1, max: 3000 },
};

// The classic Lorem Ipsum passage, split into its individual sentences. Generation cycles
// through this fixed list rather than drawing randomly, so the same settings always produce
// the same output — required for the share link to reproduce a result exactly.
const SENTENCES: string[] = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur adipisci velit.',
  'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam.',
  'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum.',
  'Et harum quidem rerum facilis est et expedita distinctio.',
  'Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus.',
  'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet.',
  'Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores.',
  'Curabitur pretium tincidunt lacus, ut interdum tellus elementum tincidunt.',
  'Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.',
  'Praesent commodo cursus magna, vel scelerisque nisl consectetur et.',
  'Cras mattis consectetur purus sit amet fermentum, sed posuere consectetur est at lobortis.',
  'Aenean lacinia bibendum nulla sed consectetur, donec ullamcorper nulla non metus auctor fringilla.',
];

// Word bank flattened from the same passage, punctuation stripped and lowercased, so words
// mode reads as filler text drawn from the same source rather than an unrelated word list.
const WORDS: string[] = SENTENCES.flatMap((sentence) =>
  sentence
    .toLowerCase()
    .replace(/[.,]/g, '')
    .split(/\s+/)
);

/** Starting offset used when `startWithLorem` is off, so the output visibly doesn't begin with the classic opening. */
const ALT_SENTENCE_OFFSET = 5;
const ALT_WORD_OFFSET = 12;

function cyclicSlice<T>(pool: T[], start: number, count: number): T[] {
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]!);
}

function validateCount(unit: LoremUnit, count: number): string | null {
  const { min, max } = LOREM_LIMITS[unit];
  if (!Number.isInteger(count) || count < min || count > max) {
    return `For ${unit}, enter a whole number between ${min} and ${max}.`;
  }
  return null;
}

function generateParagraphs(count: number, startWithLorem: boolean): string[] {
  let cursor = startWithLorem ? 0 : ALT_SENTENCE_OFFSET;
  return Array.from({ length: count }, (_, i) => {
    const sentenceCount = 3 + (i % 3);
    const sentences = cyclicSlice(SENTENCES, cursor, sentenceCount);
    cursor += sentenceCount;
    return sentences.join(' ');
  });
}

/** Generates filler text from the classic Lorem Ipsum passage, cycled deterministically to fill the requested count. */
export function generateLoremIpsum(options: LoremIpsumOptions): ToolResult<string> {
  const countError = validateCount(options.unit, options.count);
  if (countError) return err(countError);

  if (options.unit === 'words') {
    const offset = options.startWithLorem ? 0 : ALT_WORD_OFFSET;
    const text = cyclicSlice(WORDS, offset, options.count).join(' ');
    return ok(options.asHtml ? `<p>${text}</p>` : text);
  }

  if (options.unit === 'sentences') {
    const offset = options.startWithLorem ? 0 : ALT_SENTENCE_OFFSET;
    const text = cyclicSlice(SENTENCES, offset, options.count).join(' ');
    return ok(options.asHtml ? `<p>${text}</p>` : text);
  }

  const paragraphs = generateParagraphs(options.count, options.startWithLorem);
  const text = options.asHtml
    ? paragraphs.map((p) => `<p>${p}</p>`).join('\n\n')
    : paragraphs.join('\n\n');
  return ok(text);
}
