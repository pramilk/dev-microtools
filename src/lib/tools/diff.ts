import { type ToolResult, ok, err, messageFrom } from './result';

export type DiffMode = 'line' | 'word' | 'char';

export interface DiffPart {
  value: string;
  type: 'added' | 'removed' | 'unchanged';
}

export interface DiffSummary {
  parts: DiffPart[];
  added: number;
  removed: number;
  unchanged: number;
  identical: boolean;
}

/**
 * Compares two texts.
 *
 * The `diff` library is loaded dynamically so its weight only lands on people who
 * actually open this tool, not on every page of the site.
 */
export async function compareTexts(
  left: string,
  right: string,
  mode: DiffMode = 'line',
  options: { ignoreCase?: boolean; ignoreWhitespace?: boolean } = {}
): Promise<ToolResult<DiffSummary>> {
  if (left === '' && right === '') {
    return err('Paste text into both panes to compare them.');
  }

  // Loaded separately from the comparison itself so a failed module fetch reports
  // something actionable rather than the bundler's internal error text.
  let diff: typeof import('diff');
  try {
    diff = await import('diff');
  } catch {
    return err(
      'Could not load the comparison engine. Check your connection and reload the page.'
    );
  }

  try {
    const config = { ignoreCase: options.ignoreCase ?? false };
    const changes =
      mode === 'line'
        ? diff.diffLines(left, right, {
            ...config,
            ignoreWhitespace: options.ignoreWhitespace ?? false,
          })
        : mode === 'word'
          ? diff.diffWords(left, right, config)
          : diff.diffChars(left, right, config);

    let added = 0;
    let removed = 0;
    let unchanged = 0;

    const parts: DiffPart[] = changes.map((change) => {
      // `count` is the number of lines/words/chars this change covers.
      const size = change.count ?? 0;
      if (change.added) {
        added += size;
        return { value: change.value, type: 'added' as const };
      }
      if (change.removed) {
        removed += size;
        return { value: change.value, type: 'removed' as const };
      }
      unchanged += size;
      return { value: change.value, type: 'unchanged' as const };
    });

    return ok({ parts, added, removed, unchanged, identical: added === 0 && removed === 0 });
  } catch (error) {
    return err(messageFrom(error, 'Could not compare those texts.'));
  }
}

/**
 * Normalises both sides as JSON before diffing, so formatting-only differences
 * (key order, indentation) do not show up as changes.
 */
export async function compareJson(
  left: string,
  right: string
): Promise<ToolResult<DiffSummary>> {
  const normalise = (input: string, side: string): ToolResult<string> => {
    if (input.trim() === '') return err(`The ${side} side is empty — paste JSON into both panes.`);
    try {
      const sortKeys = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(sortKeys);
        if (value !== null && typeof value === 'object') {
          const source = value as Record<string, unknown>;
          const sorted: Record<string, unknown> = {};
          for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
          return sorted;
        }
        return value;
      };
      return ok(JSON.stringify(sortKeys(JSON.parse(input)), null, 2));
    } catch (error) {
      return err(`The ${side} side is not valid JSON: ${messageFrom(error, 'parse failed')}`);
    }
  };

  const a = normalise(left, 'left');
  if (!a.ok) return err(a.error);
  const b = normalise(right, 'right');
  if (!b.ok) return err(b.error);

  return compareTexts(a.value, b.value, 'line');
}

/**
 * Renders diff parts as a single plain-text export, marking removed text as
 * `[-removed-]` and added text as `{+added+}` (the common wdiff-style convention).
 *
 * Naively concatenating `part.value` for every part reproduces both the removed and
 * added content back to back with nothing distinguishing which is which — this keeps
 * the two sides legible in a copy/paste or a downloaded file, where there is no colour
 * to fall back on.
 */
export function toAnnotatedText(parts: DiffPart[]): string {
  return parts
    .map((part) => {
      if (part.type === 'added') return `{+${part.value}+}`;
      if (part.type === 'removed') return `[-${part.value}-]`;
      return part.value;
    })
    .join('');
}

export interface SideBySideRow {
  left: string | null;
  right: string | null;
  /** Line numbers on each side, `null` where that side has no line (a pure add/remove). */
  leftLine: number | null;
  rightLine: number | null;
  type: 'unchanged' | 'added' | 'removed' | 'changed';
}

/** Splits a diffLines value into its lines, dropping the trailing empty line a trailing newline produces. */
const splitLines = (value: string): string[] => {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/**
 * Rearranges a flat unified diff into aligned left/right rows for a two-column view.
 *
 * A removed part immediately followed by an added part is treated as one "changed"
 * block and paired line-by-line, so an edited line reads as a replacement rather than
 * a deletion stacked on top of an unrelated-looking insertion.
 */
export function toSideBySideRows(parts: DiffPart[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let leftLine = 0;
  let rightLine = 0;
  let i = 0;

  while (i < parts.length) {
    const part = parts[i]!;

    if (part.type === 'unchanged') {
      for (const line of splitLines(part.value)) {
        leftLine += 1;
        rightLine += 1;
        rows.push({ left: line, right: line, leftLine, rightLine, type: 'unchanged' });
      }
      i += 1;
      continue;
    }

    if (part.type === 'removed' && parts[i + 1]?.type === 'added') {
      const removedLines = splitLines(part.value);
      const addedLines = splitLines(parts[i + 1]!.value);
      const max = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < max; j += 1) {
        const l = removedLines[j] ?? null;
        const r = addedLines[j] ?? null;
        if (l !== null) leftLine += 1;
        if (r !== null) rightLine += 1;
        rows.push({
          left: l,
          right: r,
          leftLine: l !== null ? leftLine : null,
          rightLine: r !== null ? rightLine : null,
          type: 'changed',
        });
      }
      i += 2;
      continue;
    }

    if (part.type === 'removed') {
      for (const line of splitLines(part.value)) {
        leftLine += 1;
        rows.push({ left: line, right: null, leftLine, rightLine: null, type: 'removed' });
      }
      i += 1;
      continue;
    }

    for (const line of splitLines(part.value)) {
      rightLine += 1;
      rows.push({ left: null, right: line, leftLine: null, rightLine, type: 'added' });
    }
    i += 1;
  }

  return rows;
}
