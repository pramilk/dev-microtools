/**
 * List helpers shared by the tools that build one output from an ordered batch of files
 * (Merge PDF, Image to PDF): reordering, natural sorting, the batch caps, and turning a typed
 * name into a safe download name. Framework-free and import-free, so islands can use it on
 * page load.
 */

/** "3 files" style pluralisation, with thousands grouped. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/** Moves one item to a new index, returning a new array. Out-of-range moves are no-ops. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural sort by file name — "chapter 2" before "chapter 10", which a plain string sort
 *  gets wrong and which is exactly how numbered scans, photos and chapters are named. Stable. */
export function sortByName<T>(items: readonly T[], nameOf: (item: T) => string, direction: 'asc' | 'desc' = 'asc'): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => sign * nameCollator.compare(nameOf(a.item), nameOf(b.item)) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Turns whatever was typed into a file-name box into a safe download name: strips path
 * separators and characters Windows forbids, collapses whitespace, and makes sure it ends
 * in `.pdf`. Falls back to `fallback` when nothing usable is left.
 */
export function normalizePdfName(input: string, fallback: string): string {
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  return cleaned ? `${cleaned.slice(0, 200)}.pdf` : fallback;
}

export interface BatchLimits {
  maxFiles: number;
  maxBytes: number;
  /** Names the tool in the count-cap message ("Merge PDF takes up to…"). */
  toolName: string;
  /** What the batch holds, singular ("file", "image"). */
  noun: string;
  /** What to do instead when the size cap is hit. */
  sizeAdvice: string;
}

/** Checks a batch being added against the file-count and total-size caps. Returns how many
 *  of the candidates fit, plus a message explaining any that don't. */
export function batchRoom(existing: { count: number; bytes: number }, candidateSizes: number[], limits: BatchLimits): { accepted: number; error: string | null } {
  const leftOut = (n: number) => `${plural(n, limits.noun)} ${n === 1 ? 'wasn’t' : 'weren’t'} added`;
  let count = existing.count;
  let bytes = existing.bytes;
  let accepted = 0;
  for (const size of candidateSizes) {
    if (count + 1 > limits.maxFiles) {
      return { accepted, error: `${limits.toolName} takes up to ${limits.maxFiles} ${limits.noun}s at once — ${leftOut(candidateSizes.length - accepted)}.` };
    }
    if (bytes + size > limits.maxBytes) {
      return {
        accepted,
        error: `Those ${limits.noun}s would take the batch past ${limits.maxBytes / (1024 * 1024)} MB in total — ${leftOut(candidateSizes.length - accepted)}. ${limits.sizeAdvice}`,
      };
    }
    count += 1;
    bytes += size;
    accepted += 1;
  }
  return { accepted, error: null };
}
