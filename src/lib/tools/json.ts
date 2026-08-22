import { type ToolResult, ok, err, messageFrom } from './result';

export type IndentStyle = 2 | 4 | 'tab';

export interface JsonStats {
  /** Total number of keys across all objects. */
  keys: number;
  /** Maximum nesting depth. A scalar at the root is depth 0. */
  depth: number;
  /** Number of array/object nodes plus scalar leaves. */
  nodes: number;
}

const indentOf = (style: IndentStyle): string | number => (style === 'tab' ? '\t' : style);

/**
 * Parses JSON, returning a readable error rather than throwing.
 *
 * Native `JSON.parse` messages vary by engine but all name the position; we surface
 * them as-is because "Unexpected token } in JSON at position 42" is genuinely the most
 * useful thing we can tell someone debugging a payload.
 */
export function parseJson(input: string): ToolResult<unknown> {
  if (input.trim() === '') return err('Nothing to parse — paste some JSON first.');

  try {
    return ok(JSON.parse(input) as unknown);
  } catch (error) {
    return err(messageFrom(error, 'That is not valid JSON.'));
  }
}

/** Pretty-prints JSON with the requested indentation. */
export function formatJson(input: string, indent: IndentStyle = 2): ToolResult<string> {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;

  try {
    return ok(JSON.stringify(parsed.value, null, indentOf(indent)));
  } catch (error) {
    // Reachable for structures JSON.parse accepts but stringify rejects (e.g. BigInt
    // is impossible here, but circular refs are if we are ever handed a live object).
    return err(messageFrom(error, 'Could not format that JSON.'));
  }
}

/** Collapses JSON to a single line with no insignificant whitespace. */
export function minifyJson(input: string): ToolResult<string> {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;

  try {
    return ok(JSON.stringify(parsed.value));
  } catch (error) {
    return err(messageFrom(error, 'Could not minify that JSON.'));
  }
}

/**
 * Recursively sorts object keys alphabetically. Array order is preserved, since
 * array order is meaningful data and reordering it would corrupt the document.
 */
export function sortJsonKeys(input: string, indent: IndentStyle = 2): ToolResult<string> {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;

  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value !== null && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        sorted[key] = sortValue(source[key]);
      }
      return sorted;
    }
    return value;
  };

  try {
    return ok(JSON.stringify(sortValue(parsed.value), null, indentOf(indent)));
  } catch (error) {
    return err(messageFrom(error, 'Could not sort that JSON.'));
  }
}

/** Structural statistics, shown so the tool does something a text editor cannot. */
export function analyseJson(value: unknown): JsonStats {
  let keys = 0;
  let nodes = 0;

  const walk = (node: unknown, depth: number): number => {
    nodes += 1;

    if (Array.isArray(node)) {
      let deepest = depth;
      for (const item of node) {
        deepest = Math.max(deepest, walk(item, depth + 1));
      }
      return deepest;
    }

    if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      keys += entries.length;
      let deepest = depth;
      for (const [, item] of entries) {
        deepest = Math.max(deepest, walk(item, depth + 1));
      }
      return deepest;
    }

    return depth;
  };

  const depth = walk(value, 0);
  return { keys, depth, nodes };
}
