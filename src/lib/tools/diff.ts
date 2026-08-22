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
