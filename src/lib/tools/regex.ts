import { type ToolResult, ok, err, messageFrom } from './result';

export interface RegexMatch {
  /** The full matched text. */
  text: string;
  index: number;
  length: number;
  /** Numbered capture groups, excluding group 0. */
  groups: (string | undefined)[];
  /** Named capture groups, if the pattern uses them. */
  named: Record<string, string | undefined>;
}

export interface RegexRun {
  matches: RegexMatch[];
  /** True when the pattern matched an empty string, which is usually a mistake. */
  hasEmptyMatch: boolean;
}

export const REGEX_FLAGS = [
  { flag: 'g', label: 'global', hint: 'Find all matches, not just the first' },
  { flag: 'i', label: 'ignore case', hint: 'Match regardless of upper/lower case' },
  { flag: 'm', label: 'multiline', hint: '^ and $ match at line breaks' },
  { flag: 's', label: 'dotall', hint: '. also matches newlines' },
  { flag: 'u', label: 'unicode', hint: 'Treat the pattern as Unicode code points' },
  { flag: 'y', label: 'sticky', hint: 'Match only from lastIndex' },
] as const;

export interface PatternPreset {
  id: string;
  label: string;
  pattern: string;
  flags: string;
  /** Sample subject text that demonstrates the preset when loaded. */
  sample: string;
  description: string;
}

/** Ready-to-use patterns for people who would rather start from something working than a blank field. */
export const COMMON_PATTERNS: PatternPreset[] = [
  {
    id: 'email',
    label: 'Email address',
    pattern: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)',
    flags: 'g',
    sample: 'Contact ada@example.com or grace.hopper@navy.mil.\nInvalid: not-an-email@, @nope.com',
    description: 'Captures the user and domain parts of an email address separately.',
  },
  {
    id: 'url',
    label: 'URL',
    pattern: 'https?:\\/\\/[^\\s"\'<>]+',
    flags: 'g',
    sample: 'Visit https://example.com/docs or http://sub.example.org/path?q=1 for details.',
    description: 'Matches http(s) URLs up to the next whitespace or quote.',
  },
  {
    id: 'ipv4',
    label: 'IPv4 address',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    flags: 'g',
    sample: 'Server 192.168.1.1 is reachable; 10.0.0.256 is not a valid address.',
    description: 'Matches four dot-separated number groups; does not validate that each is 0-255.',
  },
  {
    id: 'phone-us',
    label: 'US phone number',
    pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}',
    flags: 'g',
    sample: 'Call (555) 123-4567 or 555.987.6543.',
    description: 'Matches common US phone formats with optional parentheses and separators.',
  },
  {
    id: 'date-iso',
    label: 'ISO date (YYYY-MM-DD)',
    pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
    flags: 'g',
    sample: 'Created on 2026-01-15, updated 2026-08-22.',
    description: 'Captures year, month and day from an ISO 8601 date.',
  },
  {
    id: 'hex-color',
    label: 'Hex color',
    pattern: '#[0-9a-fA-F]{3,8}\\b',
    flags: 'g',
    sample: 'Brand colors: #0b6e80, #fff, and #FF00FF are all valid.',
    description: 'Matches 3, 4, 6 or 8-digit hex color codes, including the leading #.',
  },
  {
    id: 'uuid',
    label: 'UUID',
    pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    flags: 'g',
    sample: 'Request id 550e8400-e29b-41d4-a716-446655440000 failed; retry id 6ba7b810-9dad-11d1-80b4-00c04fd430c8.',
    description: 'Matches a UUID in the standard 8-4-4-4-12 hex format, of any version.',
  },
  {
    id: 'slug',
    label: 'Slug (kebab-case)',
    pattern: '\\b[a-z0-9]+(?:-[a-z0-9]+)*\\b',
    flags: 'g',
    sample: 'Valid slugs: hello-world, regex-tester-tool. Not a slug: Hello_World!',
    description: 'Matches a lowercase, hyphen-separated slug such as "my-blog-post". Also matches plain lowercase words, since a single word is a valid slug too.',
  },
  {
    id: 'html-tag',
    label: 'HTML tag',
    pattern: '<\\/?[a-zA-Z][a-zA-Z0-9]*(?:\\s[^<>]*)?>',
    flags: 'g',
    sample: 'Use <p class="intro">text</p> and a self-closing <br/> tag.',
    description: 'Matches an opening, closing or self-closing HTML tag — a quick check, not a full HTML parser.',
  },
  {
    id: 'hashtag',
    label: 'Hashtag',
    pattern: '#\\w+',
    flags: 'g',
    sample: 'Loving this #regex #tutorial today! Not a tag: a lone # by itself.',
    description: 'Matches a # followed by one or more word characters.',
  },
  {
    id: 'time-24h',
    label: 'Time (24-hour)',
    pattern: '\\b([01]\\d|2[0-3]):[0-5]\\d\\b',
    flags: 'g',
    sample: 'Meeting at 09:30, lunch at 13:00, and the store closes at 23:59. Not valid: 25:61.',
    description: 'Matches an HH:MM 24-hour time, validating that the hour is 00-23 and the minute is 00-59.',
  },
  {
    id: 'mac-address',
    label: 'MAC address',
    pattern: '\\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\\b',
    flags: 'g',
    sample: 'Device MAC is 00:1A:2B:3C:4D:5E, gateway is FF:FF:FF:FF:FF:FF.',
    description: 'Matches a colon-separated MAC address.',
  },
  {
    id: 'credit-card',
    label: 'Credit card number',
    pattern: '\\b(?:\\d[ -]?){13,16}\\b',
    flags: 'g',
    sample: 'Card on file: 4111 1111 1111 1111, backup: 5500-0000-0000-0004.',
    description: 'Matches 13-16 digits with optional spaces or dashes between them. Does not validate the number with a checksum like Luhn.',
  },
  {
    id: 'whitespace-trim',
    label: 'Leading/trailing whitespace',
    pattern: '^[ \\t]+|[ \\t]+$',
    flags: 'gm',
    sample: '  leading spaces\ntrailing spaces  \n\tno extra space here',
    description: 'Matches runs of spaces or tabs at the start or end of each line — useful for a find-and-replace that trims them.',
  },
];

/** Guards against catastrophic backtracking locking up the tab. */
const MAX_MATCHES = 10_000;

/** Compiles a pattern, turning syntax errors into readable messages. */
export function compileRegex(pattern: string, flags: string): ToolResult<RegExp> {
  if (pattern === '') return err('Enter a regular expression to test.');

  try {
    return ok(new RegExp(pattern, flags));
  } catch (error) {
    return err(messageFrom(error, 'That is not a valid regular expression.'));
  }
}

/**
 * Text length past which a flagged pattern is refused rather than run. JS regex
 * execution is synchronous and cannot be interrupted once started — there is no
 * `setTimeout`-based abort for a single blocking `RegExp.exec` call on the main
 * thread, so the only way to stop a catastrophic pattern from freezing the tab is to
 * never start it. 20 is a deliberately low margin: `(a+)+$` against 20 "a"s runs in
 * ~15ms, but the cost roughly doubles every 2 characters after that (measured ~220ms
 * at 24 chars, ~3.4s at 28, ~14s at 30) — so the guard has to bite well before the
 * curve gets steep, not once it is already slow.
 */
export const REDOS_LENGTH_GUARD = 20;

function isUnboundedQuantifier(description: string): boolean {
  return / or more times/.test(description);
}

function unwrapGroupChild(node: RegexNode): RegexNode | null {
  return node.type === 'group' || node.type === 'lookaround' ? node.child : null;
}

/**
 * True for the "bare repeated atom, repeated again" shape — `(a+)+`, `(\d*)+`,
 * `([a-zA-Z]+)*`, `(.*)+` and so on — the textbook catastrophic-backtracking pattern
 * anyone testing this tool with a ReDoS cheatsheet will reach for. Every character in
 * the input can be attributed to the inner or the outer repetition interchangeably, so
 * the engine explores an exponential number of equivalent splits.
 *
 * Deliberately narrow, to avoid false-flagging ordinary patterns: it only fires when
 * the *entire* body of the outer repeated group is one unbounded quantified atom, with
 * nothing else alongside it. A group like the slug preset's `(?:-[a-z0-9]+)*` is not
 * flagged, because the literal "-" glueing each repetition together removes the
 * ambiguity — there is exactly one way to split "a-b-c", not exponentially many. This
 * is a heuristic for the well-known worst case, not a full ambiguity analysis: it will
 * not catch every catastrophic pattern (e.g. overlapping alternation like `(a|a)*`).
 */
function hasBareNestedRepetition(node: RegexNode): boolean {
  if (node.type === 'quantified') {
    if (isUnboundedQuantifier(node.description)) {
      const inner = unwrapGroupChild(node.child);
      if (inner?.type === 'quantified' && isUnboundedQuantifier(inner.description)) return true;
    }
    return hasBareNestedRepetition(node.child);
  }
  switch (node.type) {
    case 'group':
    case 'lookaround':
      return hasBareNestedRepetition(node.child);
    case 'alternation':
      return node.options.some(hasBareNestedRepetition);
    case 'sequence':
      return node.items.some(hasBareNestedRepetition);
    default:
      return false;
  }
}

/** True when `pattern` has the nested-repetition shape known to cause catastrophic backtracking. */
export function hasCatastrophicBacktrackingRisk(pattern: string): boolean {
  try {
    return hasBareNestedRepetition(new RegexExplainer(pattern).parseAlternation());
  } catch {
    return false; // Malformed pattern: let compileRegex's real parser produce the syntax error instead.
  }
}

/**
 * Refuses to run a flagged pattern once the text it would run against is long enough
 * for catastrophic backtracking to actually hang the tab. Short text is let through
 * even for a flagged pattern, since it finishes near-instantly regardless — this only
 * blocks the combination that is actually dangerous.
 */
function reDoSGuardMessage(pattern: string, textLength: number): string | null {
  if (textLength < REDOS_LENGTH_GUARD) return null;
  if (!hasCatastrophicBacktrackingRisk(pattern)) return null;
  return (
    'This pattern repeats a group that can itself repeat (like "(a+)+"), which can make ' +
    'matching take exponentially longer as the text grows — with text this long it would ' +
    'likely freeze the tab. Simplify it (e.g. "a+" instead of "(a+)+") to continue.'
  );
}

/**
 * Runs a pattern over the subject text and collects every match.
 *
 * Zero-length matches are handled explicitly: without advancing `lastIndex` manually,
 * a pattern like `a*` would loop forever on a global regex.
 */
export function runRegex(pattern: string, flags: string, subject: string): ToolResult<RegexRun> {
  const compiled = compileRegex(pattern, flags);
  if (!compiled.ok) return compiled;

  const guardMessage = reDoSGuardMessage(pattern, subject.length);
  if (guardMessage) return err(guardMessage);

  const regex = compiled.value;
  const matches: RegexMatch[] = [];
  let hasEmptyMatch = false;

  try {
    if (!regex.global) {
      const match = regex.exec(subject);
      if (match) {
        if (match[0] === '') hasEmptyMatch = true;
        matches.push(toMatch(match));
      }
      return ok({ matches, hasEmptyMatch });
    }

    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(subject)) !== null) {
      if (match[0] === '') {
        hasEmptyMatch = true;
        regex.lastIndex += 1; // Prevent an infinite loop on zero-length matches.
      }
      matches.push(toMatch(match));

      if (matches.length >= MAX_MATCHES) {
        return err(
          `This pattern produced more than ${MAX_MATCHES.toLocaleString()} matches. Narrow it down to see results.`
        );
      }
    }

    return ok({ matches, hasEmptyMatch });
  } catch (error) {
    return err(messageFrom(error, 'Something went wrong running that pattern.'));
  }
}

const toMatch = (match: RegExpExecArray): RegexMatch => ({
  text: match[0],
  index: match.index,
  length: match[0].length,
  groups: match.slice(1),
  named: match.groups ? { ...match.groups } : {},
});

export interface Segment {
  text: string;
  isMatch: boolean;
  /** 1-based match number, for alternating highlight colours. */
  matchNumber?: number;
}

/**
 * Splits the subject into matched and unmatched runs so the UI can highlight without
 * building HTML strings — keeps the rendering path free of injection risk.
 */
export function toSegments(subject: string, matches: RegexMatch[]): Segment[] {
  if (matches.length === 0) return subject === '' ? [] : [{ text: subject, isMatch: false }];

  const segments: Segment[] = [];
  let cursor = 0;

  matches.forEach((match, i) => {
    // Overlapping or out-of-order matches cannot happen with exec, but guard anyway.
    if (match.index < cursor) return;

    if (match.index > cursor) {
      segments.push({ text: subject.slice(cursor, match.index), isMatch: false });
    }
    if (match.length > 0) {
      segments.push({
        text: subject.slice(match.index, match.index + match.length),
        isMatch: true,
        matchNumber: i + 1,
      });
    }
    cursor = match.index + match.length;
  });

  if (cursor < subject.length) {
    segments.push({ text: subject.slice(cursor), isMatch: false });
  }

  return segments;
}

export interface LineTestResult {
  line: string;
  matched: boolean;
  matchCount: number;
}

/** Tests a pattern against each line of `subject` independently — useful for validating a list. */
export function testLines(pattern: string, flags: string, subject: string): ToolResult<LineTestResult[]> {
  if (subject === '') return err('Paste one item per line to test them.');

  // Force `g` locally so `String.match` returns every match on the line rather than
  // just the first — this never mutates the flags the caller passed in.
  const compiled = compileRegex(pattern, flags.includes('g') ? flags : `${flags}g`);
  if (!compiled.ok) return compiled;

  // Each line is matched independently, so the risk is the longest single line, not
  // the total pasted length — a list of many short lines is no more dangerous than one.
  const longestLine = Math.max(...subject.split('\n').map((line) => line.length));
  const guardMessage = reDoSGuardMessage(pattern, longestLine);
  if (guardMessage) return err(guardMessage);

  try {
    const results = subject.split('\n').map((line) => {
      const matches = line.match(compiled.value);
      return { line, matched: matches !== null, matchCount: matches?.length ?? 0 };
    });
    return ok(results);
  } catch (error) {
    return err(messageFrom(error, 'Something went wrong testing those lines.'));
  }
}

type RegexNode =
  | { type: 'literal'; text: string }
  | { type: 'anyChar' }
  | { type: 'charClass'; description: string }
  | { type: 'anchorStart' }
  | { type: 'anchorEnd' }
  | { type: 'wordBoundary'; negated: boolean }
  | { type: 'group'; kind: 'capturing' | 'nonCapturing' | 'named'; name?: string; index?: number; child: RegexNode }
  | { type: 'lookaround'; kind: 'ahead' | 'behind'; negated: boolean; child: RegexNode }
  | { type: 'quantified'; child: RegexNode; description: string }
  | { type: 'alternation'; options: RegexNode[] }
  | { type: 'sequence'; items: RegexNode[] };

const CHAR_CLASS_ESCAPES: Record<string, string> = {
  d: 'a digit (0-9)',
  D: 'a non-digit character',
  w: 'a word character (letter, digit or underscore)',
  W: 'a non-word character',
  s: 'a whitespace character',
  S: 'a non-whitespace character',
  n: 'a newline',
  t: 'a tab',
  r: 'a carriage return',
  '0': 'a null character',
};

const CLASS_MEMBER_ESCAPES: Record<string, string> = {
  d: 'digits',
  D: 'non-digits',
  w: 'word characters',
  W: 'non-word characters',
  s: 'whitespace',
  S: 'non-whitespace',
  n: 'newline',
  t: 'tab',
};

/**
 * A small hand-written recursive-descent parser over JS regex syntax, walking the
 * pattern once to build a tree the renderer below turns into plain English. It
 * covers the constructs people actually reach for — literals, character classes,
 * quantifiers, groups, lookaround and alternation — rather than the full grammar
 * (Unicode property escapes and a few rarer forms fall back to a literal reading).
 */
class RegexExplainer {
  private pos = 0;
  private groupIndex = 0;

  constructor(private readonly pattern: string) {}

  private peek(offset = 0): string {
    return this.pattern[this.pos + offset] ?? '';
  }

  parseAlternation(): RegexNode {
    const branches = [this.parseSequence()];
    while (this.peek() === '|') {
      this.pos += 1;
      branches.push(this.parseSequence());
    }
    return branches.length === 1 ? branches[0]! : { type: 'alternation', options: branches };
  }

  private parseSequence(): RegexNode {
    const items: RegexNode[] = [];
    while (this.pos < this.pattern.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseQuantified());
    }

    // Merge adjacent, unquantified literal atoms into one readable run — otherwise a
    // quantifier that follows would (correctly) bind to only the last character, but
    // an unquantified run like "cat" would render as three separate bullet points.
    const merged: RegexNode[] = [];
    for (const item of items) {
      const last = merged[merged.length - 1];
      if (item.type === 'literal' && last?.type === 'literal') {
        last.text += item.text;
      } else {
        merged.push(item.type === 'literal' ? { ...item } : item);
      }
    }

    return merged.length === 1 ? merged[0]! : { type: 'sequence', items: merged };
  }

  private parseQuantified(): RegexNode {
    const atom = this.parseAtom();
    const quantifier = this.tryParseQuantifier();
    return quantifier ? { type: 'quantified', child: atom, description: quantifier } : atom;
  }

  private tryParseQuantifier(): string | null {
    const ch = this.peek();
    let description: string | null = null;

    if (ch === '*') {
      this.pos += 1;
      description = 'zero or more times';
    } else if (ch === '+') {
      this.pos += 1;
      description = 'one or more times';
    } else if (ch === '?') {
      this.pos += 1;
      description = 'zero or one time (optional)';
    } else if (ch === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(this.pattern.slice(this.pos));
      if (match) {
        this.pos += match[0].length;
        if (match[2] === undefined) description = `exactly ${match[1]} times`;
        else if (match[3] === '') description = `${match[1]} or more times`;
        else description = `between ${match[1]} and ${match[3]} times`;
      }
    }

    if (description && this.peek() === '?') {
      this.pos += 1;
      description += ', as few as possible';
    }
    return description;
  }

  private parseAtom(): RegexNode {
    const ch = this.peek();
    if (ch === '^') {
      this.pos += 1;
      return { type: 'anchorStart' };
    }
    if (ch === '$') {
      this.pos += 1;
      return { type: 'anchorEnd' };
    }
    if (ch === '.') {
      this.pos += 1;
      return { type: 'anyChar' };
    }
    if (ch === '(') return this.parseGroup();
    if (ch === '[') return this.parseCharClass();
    if (ch === '\\') return this.parseEscape();

    this.pos += 1;
    return { type: 'literal', text: ch };
  }

  private parseEscape(): RegexNode {
    this.pos += 1; // consume backslash
    const ch = this.peek();
    this.pos += 1;

    if (ch === 'b') return { type: 'wordBoundary', negated: false };
    if (ch === 'B') return { type: 'wordBoundary', negated: true };
    if (CHAR_CLASS_ESCAPES[ch]) return { type: 'charClass', description: CHAR_CLASS_ESCAPES[ch]! };
    if (/[1-9]/.test(ch)) return { type: 'literal', text: `(whatever group ${ch} matched)` };
    return { type: 'literal', text: ch };
  }

  private parseCharClass(): RegexNode {
    this.pos += 1; // consume '['
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos += 1;
    }

    const parts: string[] = [];
    while (this.pos < this.pattern.length && this.peek() !== ']') {
      if (this.peek() === '\\') {
        this.pos += 1;
        const ch = this.peek();
        this.pos += 1;
        parts.push(CLASS_MEMBER_ESCAPES[ch] ?? `"${ch}"`);
        continue;
      }

      const start = this.peek();
      this.pos += 1;
      if (this.peek() === '-' && this.peek(1) !== ']' && this.pos + 1 < this.pattern.length) {
        this.pos += 1; // consume '-'
        const end = this.peek();
        this.pos += 1;
        parts.push(`"${start}" to "${end}"`);
      } else {
        parts.push(`"${start}"`);
      }
    }
    if (this.peek() === ']') this.pos += 1;

    const list = parts.length > 0 ? parts.join(', ') : 'nothing';
    return {
      type: 'charClass',
      description: negated ? `any character except ${list}` : `one of ${list}`,
    };
  }

  private expectClose(): void {
    if (this.peek() === ')') this.pos += 1;
  }

  private parseGroup(): RegexNode {
    this.pos += 1; // consume '('
    const rest = this.pattern.slice(this.pos);

    if (rest.startsWith('?:')) {
      this.pos += 2;
      const child = this.parseAlternation();
      this.expectClose();
      return { type: 'group', kind: 'nonCapturing', child };
    }
    if (rest.startsWith('?=')) {
      this.pos += 2;
      const child = this.parseAlternation();
      this.expectClose();
      return { type: 'lookaround', kind: 'ahead', negated: false, child };
    }
    if (rest.startsWith('?!')) {
      this.pos += 2;
      const child = this.parseAlternation();
      this.expectClose();
      return { type: 'lookaround', kind: 'ahead', negated: true, child };
    }
    if (rest.startsWith('?<=')) {
      this.pos += 3;
      const child = this.parseAlternation();
      this.expectClose();
      return { type: 'lookaround', kind: 'behind', negated: false, child };
    }
    if (rest.startsWith('?<!')) {
      this.pos += 3;
      const child = this.parseAlternation();
      this.expectClose();
      return { type: 'lookaround', kind: 'behind', negated: true, child };
    }

    const named = /^\?<([^>]+)>/.exec(rest);
    if (named) {
      this.pos += named[0].length;
      this.groupIndex += 1;
      const index = this.groupIndex;
      const child = this.parseAlternation();
      this.expectClose();
      return { type: 'group', kind: 'named', name: named[1], index, child };
    }

    this.groupIndex += 1;
    const index = this.groupIndex;
    const child = this.parseAlternation();
    this.expectClose();
    return { type: 'group', kind: 'capturing', index, child };
  }
}

function describeNode(node: RegexNode): string {
  switch (node.type) {
    case 'literal':
      return `the text "${node.text}"`;
    case 'anyChar':
      return 'any character';
    case 'charClass':
      return node.description;
    case 'anchorStart':
      return 'the start of the string';
    case 'anchorEnd':
      return 'the end of the string';
    case 'wordBoundary':
      return node.negated ? 'a position that is not a word boundary' : 'a word boundary';
    case 'quantified':
      return `${describeNode(node.child)}, repeated ${node.description}`;
    case 'group': {
      const inner = describeNode(node.child);
      if (node.kind === 'named') return `a group named "${node.name}" matching ${inner}`;
      if (node.kind === 'nonCapturing') return `a group (not captured) matching ${inner}`;
      return `group ${node.index}, matching ${inner}`;
    }
    case 'lookaround': {
      const inner = describeNode(node.child);
      const prefix =
        node.kind === 'ahead'
          ? node.negated
            ? 'not followed by'
            : 'followed by'
          : node.negated
            ? 'not preceded by'
            : 'preceded by';
      return `${prefix} ${inner}`;
    }
    case 'alternation':
      return node.options.map(describeNode).join(', or ');
    case 'sequence':
      return node.items.map(describeNode).join(', then ');
  }
}

const capitalize = (text: string): string => (text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text);

/** Breaks a pattern down into plain-English bullet points, for a "what does this do?" view. */
export function explainRegex(pattern: string, flags: string): ToolResult<string[]> {
  const compiled = compileRegex(pattern, flags);
  if (!compiled.ok) return compiled;

  try {
    const ast = new RegexExplainer(pattern).parseAlternation();
    const lines =
      ast.type === 'sequence' ? ast.items.map((item) => capitalize(describeNode(item))) : [capitalize(describeNode(ast))];

    if (flags.includes('i')) lines.push('Matching ignores upper/lower case');
    if (flags.includes('g')) lines.push('Finds every match in the text, not just the first');
    if (flags.includes('m')) lines.push('^ and $ match the start/end of each line, not just the whole string');
    if (flags.includes('s')) lines.push('The . also matches line breaks');

    return ok(lines);
  } catch (error) {
    return err(messageFrom(error, 'Could not break this pattern down further.'));
  }
}

export type PatternSegmentNode =
  | { type: 'text'; text: string }
  | { type: 'group'; index: number; name?: string; children: PatternSegmentNode[] };

/** Non-capturing/lookaround openers JS parses as `(?…` but that do not consume a capture slot. */
const NON_CAPTURING_OPENERS = ['(?:', '(?=', '(?!', '(?<=', '(?<!'];

/**
 * Walks a pattern's parentheses and character classes to build a tree that mirrors its
 * nesting, so the UI can render each capturing group as its own highlighted region without
 * re-implementing full regex parsing. Deliberately tolerant of malformed input (unterminated
 * classes/groups) since it also runs while the user is mid-edit.
 */
export function buildPatternTree(pattern: string): PatternSegmentNode[] {
  let pos = 0;
  let groupCounter = 0;

  const parseCharClass = (): string => {
    const start = pos;
    pos += 1; // consume '['
    if (pattern[pos] === '^') pos += 1;
    if (pattern[pos] === ']') pos += 1; // a ']' right after '[' or '[^' is literal
    while (pos < pattern.length && pattern[pos] !== ']') {
      pos += pattern[pos] === '\\' ? 2 : 1;
    }
    if (pattern[pos] === ']') pos += 1;
    return pattern.slice(start, pos);
  };

  const parseSequence = (stopAtCloseParen: boolean): PatternSegmentNode[] => {
    const nodes: PatternSegmentNode[] = [];
    let textBuf = '';
    const flush = () => {
      if (textBuf !== '') {
        nodes.push({ type: 'text', text: textBuf });
        textBuf = '';
      }
    };

    while (pos < pattern.length) {
      const ch = pattern[pos];

      if (ch === ')' && stopAtCloseParen) {
        flush();
        return nodes;
      }
      if (ch === '\\') {
        textBuf += pattern.slice(pos, pos + 2);
        pos += 2;
        continue;
      }
      if (ch === '[') {
        textBuf += parseCharClass();
        continue;
      }
      if (ch === '(') {
        const rest = pattern.slice(pos);
        const nonCapturing = NON_CAPTURING_OPENERS.find((opener) => rest.startsWith(opener));
        const named = /^\(\?<([^>]+)>/.exec(rest);

        if (nonCapturing) {
          textBuf += nonCapturing;
          pos += nonCapturing.length;
          const inner = parseSequence(true);
          flush();
          nodes.push(...inner);
          if (pattern[pos] === ')') {
            nodes.push({ type: 'text', text: ')' });
            pos += 1;
          }
          continue;
        }

        const opener = named ? named[0] : '(';
        pos += opener.length;
        groupCounter += 1;
        const index = groupCounter;
        const children = parseSequence(true);
        children.unshift({ type: 'text', text: opener });
        if (pattern[pos] === ')') {
          children.push({ type: 'text', text: ')' });
          pos += 1;
        }
        flush();
        nodes.push({ type: 'group', index, name: named?.[1], children });
        continue;
      }

      textBuf += ch;
      pos += 1;
    }

    flush();
    return nodes;
  };

  return parseSequence(false);
}

/** Flattens a pattern tree into a left-to-right list of its capturing groups. */
export function flattenPatternGroups(nodes: PatternSegmentNode[]): { index: number; name?: string }[] {
  const result: { index: number; name?: string }[] = [];
  for (const node of nodes) {
    if (node.type === 'group') {
      result.push({ index: node.index, name: node.name });
      result.push(...flattenPatternGroups(node.children));
    }
  }
  return result;
}

/** Number of distinct tint levels the UI cycles through when color-coding groups. */
export const GROUP_TINT_COUNT = 5;

interface FlavorHint {
  test: RegExp;
  message: string;
}

/**
 * Syntax that is common in other regex flavours (PCRE, Python) but is either invalid or
 * silently means something different in JavaScript. These are heuristic substring checks,
 * not a parser for other flavours — the goal is a helpful nudge, not a guarantee.
 */
const FLAVOR_HINTS: FlavorHint[] = [
  {
    test: /\(\?P<[^>]+>/,
    message:
      '(?P<name>...) is Python/PCRE syntax for a named group — JavaScript uses (?<name>...), without the P.',
  },
  {
    test: /\(\?P=\w+\)/,
    message: "(?P=name) is Python's syntax for a named back-reference — JavaScript uses \\k<name> instead.",
  },
  {
    test: /\(\?>/,
    message: '(?>...) is an atomic group, which JavaScript does not support. Restructure the pattern to avoid relying on it.',
  },
  {
    test: /(?:[*+?]|\{\d+(?:,\d*)?\})\+/,
    message:
      'Possessive quantifiers (like *+ or ++) are not supported in JavaScript. Use a normal quantifier, or restructure the pattern to avoid the backtracking they were preventing.',
  },
  {
    test: /\[\[:\w+:\]\]/,
    message:
      '[[:alpha:]]-style POSIX classes are not valid in JavaScript. Use a character class like [a-zA-Z], or a Unicode property escape such as \\p{L} with the u flag.',
  },
  {
    test: /\(\?[a-zA-Z]+[):]/,
    message: 'Inline mode modifiers like (?i) are not supported in JavaScript. Use the flag checkboxes above instead.',
  },
  {
    test: /\\[AZz](?![a-zA-Z])/,
    message:
      '\\A, \\Z and \\z are Perl/PCRE anchors for the very start or end of the string. JavaScript does not support them — \\A matches a literal "A" instead. Use ^ and $ instead.',
  },
];

/** Flags syntax in `pattern` that belongs to another regex flavour and behaves differently (or fails) in JavaScript. */
export function detectFlavorHints(pattern: string): string[] {
  return FLAVOR_HINTS.filter(({ test }) => test.test(pattern)).map(({ message }) => message);
}

// -------------------------------------------------------------- Regex flavours

export type RegexFlavor = 'javascript' | 'pcre' | 'python' | 'java' | 'dotnet' | 'go';

export interface RegexFlavorInfo {
  id: RegexFlavor;
  label: string;
  hint: string;
}

/**
 * The engine actually running is always JavaScript's `RegExp` — there is no PCRE, Python,
 * Java, .NET or Go engine available client-side, and shipping one (e.g. a WASM PCRE2
 * build) would be a large dependency for a single tool's secondary feature. Instead, the
 * non-JS flavours translate the well-known *syntax* differences (named groups, POSIX
 * classes, `\A`/`\Z` anchors, possessive quantifiers, atomic groups...) into their
 * JavaScript equivalent before running, and surface a note wherever the translation is an
 * approximation rather than an exact match. This is honest about what it is: a syntax
 * bridge with behavioural caveats, not five real engines.
 */
export const REGEX_FLAVORS: RegexFlavorInfo[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    hint: 'The engine this tool actually runs — no translation applied.',
  },
  {
    id: 'pcre',
    label: 'PCRE (PHP / Perl)',
    hint: 'PCRE-only syntax (named groups, POSIX classes, \\A/\\Z...) is translated to its JavaScript equivalent before running.',
  },
  {
    id: 'python',
    label: 'Python (re)',
    hint: "Python's re-only syntax is translated to its JavaScript equivalent before running.",
  },
  {
    id: 'java',
    label: 'Java',
    hint: "Java-only syntax — POSIX \\p{Alpha}-style classes, possessive quantifiers, atomic groups — is translated to its JavaScript equivalent before running.",
  },
  {
    id: 'dotnet',
    label: '.NET (C#)',
    hint: 'Most .NET syntax already matches JavaScript; quote-style named groups are translated, and balancing groups (no JavaScript equivalent exists) are rejected rather than mistranslated.',
  },
  {
    id: 'go',
    label: 'Go (RE2)',
    hint: "RE2 guarantees linear-time matching by forbidding backtracking constructs — lookaround and back-references are rejected, not approximated, because Go's regexp package genuinely cannot run them.",
  },
];

const POSIX_CLASS_MAP: Record<string, string> = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9a-fA-F',
  blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f',
  print: '\\x20-\\x7e',
  graph: '\\x21-\\x7e',
  ascii: '\\x00-\\x7f',
};

/** Flavours that spell a named group the Python/PCRE way — `(?P<name>...)`, `(?P=name)`, `\g<name>` — rather than JavaScript's own `(?<name>...)`/`\k<name>`. Java and .NET already use JavaScript's own angle-bracket syntax, so they're not in this list. */
const PYTHON_STYLE_NAMED_GROUP_FLAVORS: RegexFlavor[] = ['pcre', 'python', 'go'];

/** Flavours whose `[:alpha:]`-style POSIX bracket classes match JavaScript's `[a-zA-Z]`-style ranges one-for-one. Python and .NET don't have this syntax at all; Java spells the same idea `\p{Alpha}` instead. */
const POSIX_BRACKET_CLASS_FLAVORS: RegexFlavor[] = ['pcre', 'go'];

function findInvalidPosixBracketUsage(pattern: string, flavor: RegexFlavor): string | null {
  if (POSIX_BRACKET_CLASS_FLAVORS.includes(flavor)) return null;
  if (!/\[:[a-z]+:\]/.test(pattern)) return null;
  const label = REGEX_FLAVORS.find((f) => f.id === flavor)?.label ?? flavor;
  const suggestion = flavor === 'java' ? 'Use a \\p{Alpha}-style class instead.' : 'Use a character range like [a-zA-Z] instead.';
  return `[:name:]-style POSIX classes are PCRE/POSIX syntax and are not valid in ${label}. ${suggestion}`;
}

function translatePosixClasses(pattern: string, flavor: RegexFlavor, notes: string[]): string {
  let out = pattern;
  if (POSIX_BRACKET_CLASS_FLAVORS.includes(flavor) && /\[:[a-z]+:\]/.test(out)) {
    notes.push('POSIX classes such as [:alpha:] were translated to an equivalent JavaScript character range.');
    out = out.replace(/\[:([a-z]+):\]/g, (full, name: string) => POSIX_CLASS_MAP[name] ?? full);
  }

  const JAVA_POSIX_PROPERTY = /\\p\{(Lower|Upper|Alpha|Digit|Alnum|Punct|Graph|Print|Blank|Cntrl|XDigit|ASCII)\}/gi;
  if (flavor === 'java' && JAVA_POSIX_PROPERTY.test(out)) {
    notes.push(
      "Java's POSIX \\p{Alpha}-style classes were translated to an equivalent JavaScript character class. If one appeared inside a larger [...] class rather than on its own, double-check the translated pattern still does what you expect."
    );
    out = out.replace(JAVA_POSIX_PROPERTY, (full, name: string) => `[${POSIX_CLASS_MAP[name.toLowerCase()] ?? full}]`);
  }

  return out;
}

function translateNamedGroupSyntax(pattern: string, flavor: RegexFlavor, notes: string[]): string {
  let out = pattern;
  if (PYTHON_STYLE_NAMED_GROUP_FLAVORS.includes(flavor)) {
    if (/\(\?P</.test(out)) {
      notes.push('(?P<name>...) named groups were translated to JavaScript’s (?<name>...) syntax.');
      out = out.replace(/\(\?P</g, '(?<');
    }
    if (/\(\?P=\w+\)/.test(out)) {
      notes.push('(?P=name) named back-references were translated to \\k<name>.');
      out = out.replace(/\(\?P=(\w+)\)/g, '\\k<$1>');
    }
    if (/\\g<\w+>/.test(out)) {
      notes.push('\\g<name> named back-references were translated to \\k<name>.');
      out = out.replace(/\\g<(\w+)>/g, '\\k<$1>');
    }
  }

  if (flavor === 'dotnet') {
    if (/\(\?'[^']+'/.test(out)) {
      notes.push("(?'name'...) named groups were translated to JavaScript’s (?<name>...) syntax.");
      out = out.replace(/\(\?'([^']+)'/g, '(?<$1>');
    }
    if (/\\k'[^']+'/.test(out)) {
      notes.push("\\k'name' named back-references were translated to \\k<name>.");
      out = out.replace(/\\k'([^']+)'/g, '\\k<$1>');
    }
  }

  return out;
}

function translateAtomicAndPossessive(pattern: string, notes: string[]): string {
  let out = pattern;
  if (/\(\?>/.test(out)) {
    notes.push(
      'Atomic groups (?>...) are not supported in JavaScript; treated as an ordinary group, so backtracking behaviour may differ on pathological input.'
    );
    out = out.replace(/\(\?>/g, '(?:');
  }
  if (/[*+?}]\+/.test(out)) {
    notes.push(
      'Possessive quantifiers (like *+ or ++) are not supported in JavaScript; treated as ordinary greedy quantifiers.'
    );
    out = out.replace(/([*+?}])\+/g, '$1');
  }
  return out;
}

/** `\A` is start-of-string in every flavour here. The end anchor differs enough to need per-flavour handling. */
function translateAnchors(pattern: string, flavor: RegexFlavor, hasMultiline: boolean, notes: string[]): string {
  let out = pattern;
  if (/\\A/.test(out)) {
    out = out.replace(/\\A/g, '^');
    notes.push(
      '\\A (start of string) was translated to ^.' +
        (hasMultiline ? ' With multiline mode on, ^ also matches the start of each line, which \\A would not.' : '')
    );
  }

  const endAnchor = flavor === 'go' ? /\\z/ : /\\Z|\\z/;
  if (endAnchor.test(out)) {
    const label = flavor === 'python' ? '\\Z' : flavor === 'go' ? '\\z' : '\\Z or \\z';
    out = out.replace(/\\Z|\\z/g, '$');
    notes.push(
      `${label} (absolute end of string) was translated to $.` +
        (hasMultiline ? ' With multiline mode on, $ also matches the end of each line, which this anchor would not.' : '')
    );
  }
  return out;
}

function translateLeadingInlineFlags(pattern: string, notes: string[]): { pattern: string; addFlags: string } {
  const match = /^\(\?([a-zA-Z]+)\)/.exec(pattern);
  if (!match) return { pattern, addFlags: '' };

  const letters = match[1]!;
  const flagFor: Record<string, string> = { i: 'i', m: 'm', s: 's' };
  const addFlags = [...letters]
    .map((letter) => flagFor[letter])
    .filter((flag): flag is string => Boolean(flag))
    .join('');

  if (letters.includes('x')) {
    notes.push(
      'Verbose/extended mode (x) is not supported; whitespace and # comments inside the pattern are treated literally, not stripped.'
    );
  }
  if (addFlags) {
    notes.push(`The inline modifier (?${letters}) at the start of the pattern was converted to the matching flag checkbox.`);
  }

  return { pattern: pattern.slice(match[0].length), addFlags };
}

/** RE2 (Go) refuses these outright rather than approximating them, because it genuinely cannot execute them. */
function findUnsupportedRE2Construct(pattern: string): string | null {
  if (/\(\?<?[=!]/.test(pattern)) {
    return "Lookahead/lookbehind is not supported by Go's RE2 engine, which guarantees linear-time matching by disallowing backtracking constructs. Remove it to test a pattern Go can actually run.";
  }
  if (/\\k<\w+>|\\[1-9]\d*/.test(pattern)) {
    return "Back-references are not supported by Go's RE2 engine, for the same reason: they require backtracking. Remove it to test a pattern Go can actually run.";
  }
  if (/\(\?>/.test(pattern)) {
    return "Atomic groups are not a concept in Go's RE2 engine, which never backtracks in the first place. Remove it to test a pattern Go can actually run.";
  }
  if (/[*+?}]\+/.test(pattern)) {
    return "Possessive quantifiers are not valid syntax in Go's RE2 engine. Use an ordinary quantifier instead.";
  }
  return null;
}

/** .NET balancing groups have no JavaScript equivalent at all — rejected outright rather than silently mistranslated. */
function findUnsupportedDotNetConstruct(pattern: string): string | null {
  if (/\(\?<\w*-\w+>/.test(pattern)) {
    return "Balancing groups like (?<name1-name2>...) have no equivalent in JavaScript's regex engine — there is no construct that tracks nested group counts the way .NET's does. Rewrite the pattern without them to test it here.";
  }
  return null;
}

export interface FlavorResolution {
  /** The JavaScript-compatible pattern actually compiled and run. */
  pattern: string;
  /** `flags`, plus any flags implied by a translated inline modifier like `(?i)`. */
  flags: string;
  /** Approximations made during translation, shown to the user as informational notes. */
  notes: string[];
}

/**
 * Translates `pattern` from `flavor`'s syntax into the JavaScript syntax this tool can
 * actually execute, collecting a human-readable note for every approximation made. Two
 * kinds of construct are rejected outright instead of approximated, because there is no
 * JavaScript equivalent to fall back on at all: Go/RE2's backtracking constructs
 * (lookaround, back-references, atomic groups, possessive quantifiers — genuinely
 * unrunnable, not just differently-spelled) and .NET's balancing groups (a nested-count
 * tracker JavaScript's engine has no concept of). See {@link REGEX_FLAVORS}'s doc comment
 * for why approximation is the right default everywhere else.
 */
export function resolveFlavorPattern(pattern: string, flags: string, flavor: RegexFlavor): ToolResult<FlavorResolution> {
  if (flavor === 'javascript') return ok({ pattern, flags, notes: [] });

  const invalidPosix = findInvalidPosixBracketUsage(pattern, flavor);
  if (invalidPosix) return err(invalidPosix);

  if (flavor === 'dotnet') {
    const unsupportedDotNet = findUnsupportedDotNetConstruct(pattern);
    if (unsupportedDotNet) return err(unsupportedDotNet);
  }

  const notes: string[] = [];
  const inline = translateLeadingInlineFlags(pattern, notes);
  const mergedFlags = Array.from(new Set([...flags, ...inline.addFlags])).join('');

  let working = translateNamedGroupSyntax(inline.pattern, flavor, notes);
  working = translatePosixClasses(working, flavor, notes);
  working = translateAnchors(working, flavor, mergedFlags.includes('m'), notes);

  if (flavor === 'go') {
    const unsupported = findUnsupportedRE2Construct(working);
    if (unsupported) return err(unsupported);
  } else {
    working = translateAtomicAndPossessive(working, notes);
  }

  return ok({ pattern: working, flags: mergedFlags, notes });
}

/** Applies a replacement pattern, supporting $1 / $<name> back-references. */
export function applyReplace(
  pattern: string,
  flags: string,
  subject: string,
  replacement: string
): ToolResult<string> {
  const compiled = compileRegex(pattern, flags);
  if (!compiled.ok) return compiled;

  const guardMessage = reDoSGuardMessage(pattern, subject.length);
  if (guardMessage) return err(guardMessage);

  try {
    return ok(subject.replace(compiled.value, replacement));
  } catch (error) {
    return err(messageFrom(error, 'Could not apply that replacement.'));
  }
}
