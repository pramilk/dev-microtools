/**
 * The tools sidebar's behaviour — open/close state, the search filter, and the
 * keyboard shortcuts — extracted from `ToolsSidebar.astro` so it can be tested. An
 * inline `<script>` in a `.astro` file has no test harness, and this is the largest
 * piece of hand-written DOM code on the site. The component keeps the markup and CSS.
 */

/* --------------------------------------------------------------- search */

/**
 * Optimal-string-alignment edit distance (Levenshtein plus adjacent-transposition as a
 * single edit) so the single most common typo shape — two swapped letters, e.g. "jsno"
 * for "json" — counts as distance 1, not 2. Strings here are short tool words over a
 * small list, so the full O(n*m) table is cheap.
 *
 * `max` is an early-out only: anything further away than that may be reported as
 * `max + 1` rather than its true distance, which is all a threshold test needs.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Splits a raw query into lower-cased search words. */
export function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * A search token matches a haystack if it's a plain substring (handles partial words
 * like "form" -> "formatter"), or, for tokens long enough that typos are meaningful, if
 * it's within a small edit distance of some word in the haystack (so "regeex"/"csvv"
 * still find "Regex Tester"/"CSV to JSON").
 */
export function tokenMatches(token: string, haystack: string, words: string[]): boolean {
  if (haystack.includes(token)) return true;
  if (token.length < 4) return false;
  const maxDistance = token.length <= 5 ? 1 : 2;
  return words.some((word) => editDistance(token, word, maxDistance) <= maxDistance);
}

export interface ToolMatch {
  /** Whether the tool should be shown at all. */
  match: boolean;
  /** A match on the summary only — ranked below title matches. */
  weak: boolean;
}

/**
 * Scores one tool against a tokenised query. Every search word must match something
 * (title or description) — order-independent, so "converter unix" still finds "Unix
 * Timestamp Converter". Title hits outrank description-only hits so e.g. searching
 * "json" surfaces "JSON Formatter" before a tool whose summary merely mentions JSON.
 *
 * `name` and `summary` are expected already lower-cased, as the markup renders them.
 */
export function matchTool(name: string, summary: string, tokens: string[]): ToolMatch {
  const haystack = `${name} ${summary}`;
  const words = haystack.split(/\s+/).filter(Boolean);
  const match = tokens.length === 0 || tokens.every((token) => tokenMatches(token, haystack, words));
  const weak = match && tokens.length > 0 && !tokens.every((token) => name.includes(token));
  return { match, weak };
}

/**
 * Whether to show the Mac shortcut label. Browsers reserve Ctrl+T/Cmd+T (new tab), so
 * Ctrl+K/Cmd+K is used instead, matching the convention GitHub/Linear/Slack/Vercel all
 * use for "focus site search".
 */
export function isMacPlatform(nav: Navigator): boolean {
  return /mac/i.test(
    (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? nav.platform
  );
}

/* ------------------------------------------------------------ open/close */

/**
 * Reads the `data-sidebar` attribute BaseLayout's no-FOUC inline script already applies
 * before first paint — every open/close control on the page funnels through this pair.
 */
export function isSidebarOpen(): boolean {
  return document.documentElement.getAttribute('data-sidebar') === 'open';
}

export function setSidebarOpen(open: boolean): void {
  document.documentElement.setAttribute('data-sidebar', open ? 'open' : 'closed');
  try {
    localStorage.setItem('sidebarOpen', open ? '1' : '0');
  } catch {
    // Persisting is best-effort; the sidebar still toggles for this page view.
  }
  for (const button of document.querySelectorAll<HTMLElement>('[data-sidebar-toggle]')) {
    button.setAttribute('aria-expanded', String(open));
  }
}

/* ----------------------------------------------------------------- wiring */

/** Wires every sidebar control on the page. Called once, from `ToolsSidebar.astro`. */
export function initSidebar(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-sidebar-toggle]')) {
    button.setAttribute('aria-expanded', String(isSidebarOpen()));
    button.addEventListener('click', () => setSidebarOpen(!isSidebarOpen()));
  }

  const input = document.querySelector<HTMLInputElement>('[data-sidebar-search]');
  const searchKbd = document.querySelector<HTMLElement>('[data-sidebar-search-kbd]');
  if (searchKbd && isMacPlatform(navigator)) searchKbd.textContent = '⌘ K';

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!isSidebarOpen()) setSidebarOpen(true);
      input?.focus();
      input?.select();
    }
  });

  const items = document.querySelectorAll<HTMLLIElement>('[data-sidebar-item]');
  const groups = document.querySelectorAll<HTMLElement>('[data-sidebar-group]');
  const empty = document.querySelector<HTMLElement>('[data-sidebar-empty]');

  // Original (category, then `order`) DOM position of every item, so search can freely
  // reorder items to float better matches to the top and still put them back exactly
  // where they started once the query is cleared.
  const originalOrder = new Map<HTMLElement, HTMLLIElement[]>();
  for (const group of groups) {
    const list = group.querySelector<HTMLElement>('.sidebar__list');
    if (list) originalOrder.set(list, Array.from(list.querySelectorAll<HTMLLIElement>('[data-sidebar-item]')));
  }

  input?.addEventListener('input', () => {
    const tokens = tokenize(input.value);
    let anyVisible = false;

    for (const item of items) {
      const { match, weak } = matchTool(item.dataset.toolName ?? '', item.dataset.toolSummary ?? '', tokens);
      item.hidden = !match;
      item.classList.toggle('sidebar__item--weak-match', weak);
      if (match) anyVisible = true;
    }

    for (const group of groups) {
      const list = group.querySelector<HTMLElement>('.sidebar__list');
      const order = list ? originalOrder.get(list) : undefined;
      if (list && order) {
        if (tokens.length === 0) {
          // No query: restore the original order exactly, undoing any reorder from a
          // previous search.
          for (const item of order) list.appendChild(item);
        } else {
          // Float title matches above description-only matches within the group.
          const sorted = [...order].sort(
            (a, b) =>
              Number(a.classList.contains('sidebar__item--weak-match')) -
              Number(b.classList.contains('sidebar__item--weak-match'))
          );
          for (const item of sorted) list.appendChild(item);
        }
      }
      group.hidden = order ? order.every((item) => item.hidden) : true;
    }

    if (empty) empty.hidden = anyVisible || tokens.length === 0;
  });

  // Mobile only: clicking the backdrop or pressing Escape closes the overlay.
  const backdrop = document.querySelector<HTMLElement>('[data-sidebar-backdrop]');
  backdrop?.addEventListener('click', () => setSidebarOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isSidebarOpen()) setSidebarOpen(false);
  });

  // Picking a tool while the sidebar is an overlay (same breakpoint as the component's
  // CSS) should close it — it's a full-page navigation either way, but without this the
  // sidebar would still be sitting open, covering the new page, until the next full
  // reload happens to pick up a "closed" default.
  const overlayBreakpoint = window.matchMedia('(max-width: 63.99rem)');
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.sidebar__list a')) {
    link.addEventListener('click', () => {
      if (overlayBreakpoint.matches) setSidebarOpen(false);
    });
  }
}
