/**
 * Search helpers for the JSON formatter's result pane.
 *
 * Kept separate from the island so the matching logic — plain text search and the
 * tree-path walk — is testable without rendering anything.
 */

export interface TextSearchSegment {
  text: string;
  /** 0-based ordinal of this match among all matches, or null for non-matching text. */
  matchIndex: number | null;
}

/** Finds every case-insensitive occurrence of `query` in `text`, as start offsets. */
export function findTextMatches(text: string, query: string): number[] {
  if (query === '') return [];

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const positions: number[] = [];

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    positions.push(index);
    index = haystack.indexOf(needle, index + needle.length);
  }
  return positions;
}

/** Splits `text` into segments alternating matched/unmatched runs, for highlighting. */
export function toTextSearchSegments(
  text: string,
  positions: number[],
  queryLength: number
): TextSearchSegment[] {
  if (positions.length === 0) return [{ text, matchIndex: null }];

  const segments: TextSearchSegment[] = [];
  let cursor = 0;

  positions.forEach((start, matchIndex) => {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), matchIndex: null });
    segments.push({ text: text.slice(start, start + queryLength), matchIndex });
    cursor = start + queryLength;
  });

  if (cursor < text.length) segments.push({ text: text.slice(cursor), matchIndex: null });
  return segments;
}

export interface JsonTreeSearchResult {
  /** Every node path that must stay visible: matches themselves, plus their ancestors. */
  keepPaths: Set<string>;
  /** How many nodes actually matched, as opposed to being kept for ancestor context. */
  matchCount: number;
}

/**
 * Walks a parsed JSON value and finds every node whose key or value contains `query`
 * (case-insensitive), plus every ancestor of a match — so the tree view can filter down
 * to just the relevant branches without losing the path that leads to them.
 */
export function searchJsonTree(value: unknown, query: string): JsonTreeSearchResult {
  const keepPaths = new Set<string>();
  const matchPaths = new Set<string>();

  if (query.trim() === '') return { keepPaths, matchCount: 0 };
  const needle = query.toLowerCase();

  const walk = (node: unknown, path: string, label: string | null): boolean => {
    const labelMatches = label !== null && label.toLowerCase().includes(needle);
    const isContainer = node !== null && typeof node === 'object';

    if (!isContainer) {
      const valueMatches = JSON.stringify(node).toLowerCase().includes(needle);
      const matches = labelMatches || valueMatches;
      if (matches) {
        keepPaths.add(path);
        matchPaths.add(path);
      }
      return matches;
    }

    const isArray = Array.isArray(node);
    const entries: [string, unknown][] = isArray
      ? node.map((item, index) => [String(index), item] as [string, unknown])
      : Object.entries(node as Record<string, unknown>);

    let anyDescendantMatches = false;
    for (const [key, item] of entries) {
      if (walk(item, `${path}/${key}`, isArray ? null : key)) anyDescendantMatches = true;
    }

    const matches = labelMatches || anyDescendantMatches;
    if (matches) {
      keepPaths.add(path);
      if (labelMatches) matchPaths.add(path);
    }
    return matches;
  };

  walk(value, '$', null);
  return { keepPaths, matchCount: matchPaths.size };
}
