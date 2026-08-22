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
