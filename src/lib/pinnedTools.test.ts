import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPinnedTools, isPinned, togglePinned, initPinnedTools } from './pinnedTools';

/** The markup `index.astro` renders for one tool card, reduced to what the script reads. */
function renderCard(id: string, title: string): string {
  return `
    <li data-home-tool data-tool-id="${id}" data-tool-name="${title.toLowerCase()}" data-tool-category="Format">
      <a href="#${id}" class="card tool-card">${title}</a>
      <button
        type="button"
        data-pin-toggle
        data-tool-id="${id}"
        data-tool-title="${title}"
        aria-pressed="false"
        aria-label="Pin ${title} to the top"
      >📌</button>
    </li>`;
}

function renderHome(): void {
  document.body.innerHTML = `
    <section data-pinned-section hidden>
      <ul data-pinned-list></ul>
    </section>
    <ul>
      ${renderCard('json-formatter', 'JSON Formatter')}
      ${renderCard('uuid-generator', 'UUID Generator')}
    </ul>`;
}

const pinButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-pin-toggle][data-tool-id="${id}"]`)!;
const pinnedSection = () => document.querySelector<HTMLElement>('[data-pinned-section]')!;
const pinnedList = () => document.querySelector<HTMLElement>('[data-pinned-list]')!;

beforeEach(() => {
  localStorage.clear();
  renderHome();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('getPinnedTools', () => {
  it('is empty when nothing is stored', () => {
    expect(getPinnedTools()).toEqual([]);
  });

  it('reads back a stored list', () => {
    localStorage.setItem('pinnedTools', JSON.stringify(['json-formatter']));
    expect(getPinnedTools()).toEqual(['json-formatter']);
  });

  it('ignores corrupt JSON rather than throwing', () => {
    localStorage.setItem('pinnedTools', '{not json');
    expect(getPinnedTools()).toEqual([]);
  });

  it('ignores a stored value that is not an array', () => {
    localStorage.setItem('pinnedTools', JSON.stringify({ oops: true }));
    expect(getPinnedTools()).toEqual([]);
  });

  it('drops non-string entries from a stored array', () => {
    localStorage.setItem('pinnedTools', JSON.stringify(['json-formatter', 42, null]));
    expect(getPinnedTools()).toEqual(['json-formatter']);
  });

  it('falls back to empty when localStorage throws, e.g. private mode', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(getPinnedTools()).toEqual([]);
  });
});

describe('isPinned', () => {
  it('reflects the stored list', () => {
    localStorage.setItem('pinnedTools', JSON.stringify(['json-formatter']));
    expect(isPinned('json-formatter')).toBe(true);
    expect(isPinned('uuid-generator')).toBe(false);
  });
});

describe('togglePinned', () => {
  it('adds an id that is not yet pinned', () => {
    expect(togglePinned('json-formatter')).toEqual(['json-formatter']);
    expect(getPinnedTools()).toEqual(['json-formatter']);
  });

  it('removes an id that is already pinned', () => {
    togglePinned('json-formatter');
    expect(togglePinned('json-formatter')).toEqual([]);
    expect(getPinnedTools()).toEqual([]);
  });

  it('preserves pin order across multiple toggles', () => {
    togglePinned('json-formatter');
    expect(togglePinned('uuid-generator')).toEqual(['json-formatter', 'uuid-generator']);
  });

  it('still toggles when persisting throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(() => togglePinned('json-formatter')).not.toThrow();
  });
});

describe('initPinnedTools', () => {
  it('leaves the pinned section hidden and every button unpressed with nothing pinned', () => {
    initPinnedTools();

    expect(pinnedSection().hidden).toBe(true);
    expect(pinButton('json-formatter')).toHaveAttribute('aria-pressed', 'false');
  });

  it('syncs button state and shows the pinned section for an already-stored pin', () => {
    localStorage.setItem('pinnedTools', JSON.stringify(['uuid-generator']));

    initPinnedTools();

    expect(pinButton('uuid-generator')).toHaveAttribute('aria-pressed', 'true');
    expect(pinnedSection().hidden).toBe(false);
    expect(pinnedList().textContent).toContain('UUID Generator');
  });

  it('pins a tool on click: presses the button, reveals the section, clones the card', () => {
    initPinnedTools();

    pinButton('json-formatter').click();

    expect(pinButton('json-formatter')).toHaveAttribute('aria-pressed', 'true');
    expect(pinnedSection().hidden).toBe(false);
    expect(pinnedList().textContent).toContain('JSON Formatter');
    expect(getPinnedTools()).toEqual(['json-formatter']);
  });

  it('the cloned card in the pinned section is not picked up by the search/category filter', () => {
    initPinnedTools();
    pinButton('json-formatter').click();

    const clone = pinnedList().querySelector('[data-tool-id="json-formatter"]')!.closest('li')!;
    expect(clone.hasAttribute('data-home-tool')).toBe(false);
  });

  it('unpins from the button inside the pinned section itself', () => {
    initPinnedTools();
    pinButton('json-formatter').click();

    // Two buttons now share this id: the original card's, and the clone's. Either one
    // toggling off must clear the pin everywhere.
    const clonedButton = pinnedList().querySelector<HTMLButtonElement>('[data-pin-toggle]')!;
    clonedButton.click();

    expect(pinButton('json-formatter')).toHaveAttribute('aria-pressed', 'false');
    expect(pinnedSection().hidden).toBe(true);
    expect(getPinnedTools()).toEqual([]);
  });

  it('rebuilds the pinned list in pin order when multiple tools are pinned', () => {
    initPinnedTools();

    pinButton('uuid-generator').click();
    pinButton('json-formatter').click();

    const titles = Array.from(pinnedList().querySelectorAll('.tool-card')).map((el) => el.textContent);
    expect(titles).toEqual(['UUID Generator', 'JSON Formatter']);
  });

  it('ignores clicks that are not on a pin toggle', () => {
    initPinnedTools();
    expect(() => document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(getPinnedTools()).toEqual([]);
  });
});

describe('initPinnedTools — sidebar markup', () => {
  // The sidebar marks its tool rows with `data-sidebar-item` instead of the homepage's
  // `data-home-tool`, and nests the pin button inside the `<li>` as a link sibling
  // rather than a link sibling at the top level — the shared logic needs to work
  // against this shape unchanged, since both `ToolsSidebar.astro` and `index.astro`
  // call `initPinnedTools()`.
  function renderSidebarItem(id: string, title: string): string {
    return `
      <li data-sidebar-item data-tool-id="${id}" data-tool-name="${title.toLowerCase()}" data-tool-category="Format">
        <a href="/${id}/">${title}</a>
        <button
          type="button"
          data-pin-toggle
          data-tool-id="${id}"
          data-tool-title="${title}"
          aria-pressed="false"
          aria-label="Pin ${title} to the top"
        >📌</button>
      </li>`;
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div data-pinned-section hidden>
        <ul data-pinned-list></ul>
      </div>
      <ul>
        ${renderSidebarItem('json-formatter', 'JSON Formatter')}
      </ul>`;
  });

  it('pins from sidebar-shaped markup and clones without the sidebar-search marker', () => {
    initPinnedTools();

    pinButton('json-formatter').click();

    expect(pinnedSection().hidden).toBe(false);
    expect(pinnedList().textContent).toContain('JSON Formatter');
    const clone = pinnedList().querySelector('li')!;
    expect(clone.hasAttribute('data-sidebar-item')).toBe(false);
  });
});
