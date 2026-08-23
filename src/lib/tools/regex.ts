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
 * Runs a pattern over the subject text and collects every match.
 *
 * Zero-length matches are handled explicitly: without advancing `lastIndex` manually,
 * a pattern like `a*` would loop forever on a global regex.
 */
export function runRegex(pattern: string, flags: string, subject: string): ToolResult<RegexRun> {
  const compiled = compileRegex(pattern, flags);
  if (!compiled.ok) return compiled;

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

/** Applies a replacement pattern, supporting $1 / $<name> back-references. */
export function applyReplace(
  pattern: string,
  flags: string,
  subject: string,
  replacement: string
): ToolResult<string> {
  const compiled = compileRegex(pattern, flags);
  if (!compiled.ok) return compiled;

  try {
    return ok(subject.replace(compiled.value, replacement));
  } catch (error) {
    return err(messageFrom(error, 'Could not apply that replacement.'));
  }
}
