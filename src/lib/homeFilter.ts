/**
 * The homepage's search-and-category filter, extracted from `index.astro` so it can be
 * tested — an inline `<script>` in a `.astro` file has no test harness. The component
 * keeps the markup and CSS.
 *
 * The fuzzy text matching is the sidebar's — reused rather than duplicated, since the
 * two do the same "does this tool match this query" job on the same tool data.
 */

import { tokenize, matchTool, categoryMatchesTokens, isMacPlatform } from './sidebar';

/** Every category (from its section markup) whose own name matches every search token. */
function matchedCategoryNames(sections: NodeListOf<HTMLElement>, tokens: string[]): Set<string> {
  const matched = new Set<string>();
  for (const section of sections) {
    const category = section.dataset.categorySection;
    if (category && categoryMatchesTokens(category, tokens)) matched.add(category);
  }
  return matched;
}

/** Applies the current search text and category selection to every tool card. */
export function applyHomeFilter(): void {
  const searchInput = document.querySelector<HTMLInputElement>('[data-home-search]');
  const filterBar = document.querySelector<HTMLElement>('[data-home-category-filter]');
  const cards = document.querySelectorAll<HTMLElement>('[data-home-tool]');
  const sections = document.querySelectorAll<HTMLElement>('[data-category-section]');
  const empty = document.querySelector<HTMLElement>('[data-home-empty]');
  if (!searchInput || !filterBar) return;

  const activeButton = filterBar.querySelector<HTMLButtonElement>('[data-category][aria-pressed="true"]');
  const activeCategory = activeButton?.dataset.category ?? 'all';
  const tokens = tokenize(searchInput.value);
  const boostedCategories = matchedCategoryNames(sections, tokens);

  let anyVisible = false;
  for (const card of cards) {
    const category = card.dataset.toolCategory ?? '';
    const categoryOk = activeCategory === 'all' || category === activeCategory;
    const { match } = matchTool(card.dataset.toolName ?? '', card.dataset.toolSummary ?? '', tokens);
    const visible = categoryOk && (match || boostedCategories.has(category));
    card.hidden = !visible;
    if (visible) anyVisible = true;
  }

  for (const section of sections) {
    const sectionCards = section.querySelectorAll<HTMLElement>('[data-home-tool]');
    section.hidden = Array.from(sectionCards).every((card) => card.hidden);
  }

  if (empty) empty.hidden = anyVisible;
}

/** Wires the homepage search box and category chips. Called once, from `index.astro`. */
export function initHomeFilter(): void {
  const searchInput = document.querySelector<HTMLInputElement>('[data-home-search]');
  const searchKbd = document.querySelector<HTMLElement>('[data-home-search-kbd]');
  const clearButton = document.querySelector<HTMLButtonElement>('[data-home-search-clear]');
  const filterBar = document.querySelector<HTMLElement>('[data-home-category-filter]');
  if (!searchInput || !filterBar) return;

  if (isMacPlatform(navigator)) searchKbd && (searchKbd.textContent = '⌘ K');

  // Lets `/?q=...` (and the `/search?q=...` redirect in public/_redirects, which Google
  // probes for automatically when looking for a site's search feature) land on a
  // pre-filtered homepage instead of a generic one.
  const query = new URLSearchParams(window.location.search).get('q');
  if (query) {
    searchInput.value = query;
    applyHomeFilter();
  }

  searchInput.addEventListener('input', applyHomeFilter);

  clearButton?.addEventListener('click', () => {
    searchInput.value = '';
    applyHomeFilter();
    searchInput.focus();
  });

  for (const button of filterBar.querySelectorAll<HTMLButtonElement>('[data-category]')) {
    button.addEventListener('click', () => {
      for (const other of filterBar.querySelectorAll<HTMLButtonElement>('[data-category]')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      applyHomeFilter();
    });
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
}
