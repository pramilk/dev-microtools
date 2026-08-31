/**
 * Per-browser "pin to top" — shared between the homepage's own tool grid and the
 * persistent sidebar's tool list, extracted so it can be tested. Pins are stored in
 * `localStorage` only: this site has no backend and no accounts, so there is nowhere
 * else for a per-visitor preference to live.
 */

const STORAGE_KEY = 'pinnedTools';

/** The stored list of pinned tool ids, or an empty list if nothing is stored or valid. */
export function getPinnedTools(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // Corrupt JSON or localStorage blocked (private mode) — treat as no pins.
    return [];
  }
}

function setPinnedTools(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Persisting is best-effort; the toggle still applies for this page view.
  }
}

export function isPinned(id: string, pinned: string[] = getPinnedTools()): boolean {
  return pinned.includes(id);
}

/** Adds or removes `id` from the pinned list and persists the result. */
export function togglePinned(id: string): string[] {
  const pinned = getPinnedTools();
  const next = pinned.includes(id) ? pinned.filter((existing) => existing !== id) : [...pinned, id];
  setPinnedTools(next);
  return next;
}

function updatePinButton(button: HTMLElement, pinned: boolean, name: string): void {
  button.setAttribute('aria-pressed', String(pinned));
  button.title = pinned ? 'Unpin' : 'Pin to top';
  button.setAttribute('aria-label', pinned ? `Unpin ${name}` : `Pin ${name} to the top`);
}

/**
 * Rebuilds the pinned section from scratch: clones each pinned tool's list item (in the
 * order pinned) into `[data-pinned-list]`, and hides the whole section when there are
 * none. Works on either host unchanged — the homepage's grid and the sidebar's list both
 * mark their tool items with `data-tool-id` on an `<li>`, which is all this reads.
 *
 * A clone rather than a move, so a pin never disturbs the item's real position in its
 * category group or that group's own search-filter bookkeeping — and the clone drops
 * `data-home-tool`/`data-sidebar-item` so neither filter's queries pick it up. Pins are a
 * fixed set of shortcuts, not something the active search should be able to hide.
 */
function renderPinnedSection(pinnedIds: string[]): void {
  const section = document.querySelector<HTMLElement>('[data-pinned-section]');
  const list = document.querySelector<HTMLElement>('[data-pinned-list]');
  if (!section || !list) return;

  list.innerHTML = '';
  for (const id of pinnedIds) {
    const original = document.querySelector<HTMLElement>(`li[data-tool-id="${id}"]`);
    if (!original) continue;
    const clone = original.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-home-tool');
    clone.removeAttribute('data-sidebar-item');
    clone.hidden = false;
    list.appendChild(clone);
  }
  section.hidden = pinnedIds.length === 0;
}

let wired = false;

/**
 * Wires every pin button on the page, including ones cloned into the pinned section.
 * Idempotent — safe to call more than once (e.g. from both a test and a hot reload)
 * without stacking up duplicate `document` click listeners, which would otherwise
 * toggle a pin's stored state more than once per click.
 */
export function initPinnedTools(): void {
  const pinned = getPinnedTools();
  for (const button of document.querySelectorAll<HTMLElement>('[data-pin-toggle]')) {
    updatePinButton(button, isPinned(button.dataset.toolId ?? '', pinned), button.dataset.toolTitle ?? '');
  }
  renderPinnedSection(pinned);

  if (wired) return;
  wired = true;

  // Delegated on `document`, not each button individually — the pinned-section clones
  // are (re)created after this runs, so they'd otherwise never get a click handler.
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-pin-toggle]');
    const id = button?.dataset.toolId;
    if (!button || !id) return;

    const next = togglePinned(id);
    const nowPinned = next.includes(id);
    for (const match of document.querySelectorAll<HTMLElement>(`[data-pin-toggle][data-tool-id="${id}"]`)) {
      updatePinButton(match, nowPinned, match.dataset.toolTitle ?? '');
    }
    renderPinnedSection(next);
  });
}
