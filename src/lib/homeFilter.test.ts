import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyHomeFilter, initHomeFilter } from './homeFilter';

interface ToolFixture {
  name: string;
  summary: string;
  category: string;
}

const TOOLS: ToolFixture[] = [
  { name: 'json formatter', summary: 'format and validate json', category: 'Format' },
  { name: 'sql formatter', summary: 'pretty-print sql queries', category: 'Format' },
  { name: 'uuid generator', summary: 'generate random identifiers and short codes', category: 'Generate' },
  { name: 'qr code generator', summary: 'build a qr code from json or text', category: 'Generate' },
  { name: 'llm token counter', summary: 'count tokens across gpt, claude and gemini models', category: 'AI' },
];

/** The markup `index.astro` renders, reduced to what the script actually reads. */
function renderHome(): void {
  const categories = [...new Set(TOOLS.map((tool) => tool.category))];
  document.body.innerHTML = `
    <div>
      <input type="search" data-home-search />
      <kbd data-home-search-kbd>Ctrl K</kbd>
      <button type="button" data-home-search-clear aria-label="Clear search">×</button>
      <div data-home-category-filter>
        <button type="button" data-category="all" aria-pressed="true">All</button>
        ${categories.map((category) => `<button type="button" data-category="${category}" aria-pressed="false">${category}</button>`).join('')}
      </div>
      ${categories
        .map(
          (category) => `
        <section data-category-section="${category}">
          ${TOOLS.filter((tool) => tool.category === category)
            .map(
              (tool) =>
                `<a href="#${tool.name.replace(/\s+/g, '-')}" data-home-tool data-tool-name="${tool.name}" data-tool-summary="${tool.summary}" data-tool-category="${tool.category}">${tool.name}</a>`
            )
            .join('')}
        </section>`
        )
        .join('')}
      <p data-home-empty hidden>No tools match your search.</p>
    </div>`;
}

const search = () => document.querySelector<HTMLInputElement>('[data-home-search]')!;
const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-home-tool]'));
const visibleNames = () =>
  cards()
    .filter((card) => !card.hidden)
    .map((card) => card.dataset.toolName);
const emptyMessage = () => document.querySelector<HTMLElement>('[data-home-empty]')!;
const categoryButton = (category: string) =>
  document.querySelector<HTMLButtonElement>(`[data-category="${category}"]`)!;
const clearButton = () => document.querySelector<HTMLButtonElement>('[data-home-search-clear]')!;

function type(value: string): void {
  search().value = value;
  search().dispatchEvent(new Event('input'));
}

beforeEach(() => {
  renderHome();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('applyHomeFilter — no-op guards', () => {
  it('does nothing when the search input is missing', () => {
    document.body.innerHTML = '<div data-home-category-filter></div>';
    expect(() => applyHomeFilter()).not.toThrow();
  });

  it('does nothing when the category filter bar is missing', () => {
    document.body.innerHTML = '<input data-home-search />';
    expect(() => applyHomeFilter()).not.toThrow();
  });
});

describe('initHomeFilter — search filtering', () => {
  it('shows everything before a query is typed', () => {
    initHomeFilter();
    expect(visibleNames()).toHaveLength(TOOLS.length);
    expect(emptyMessage().hidden).toBe(true);
  });

  it('filters to matching tools', () => {
    initHomeFilter();
    type('formatter');

    expect(visibleNames()).toEqual(['json formatter', 'sql formatter']);
  });

  it('matches on the summary as well as the title', () => {
    initHomeFilter();
    type('identifiers');

    expect(visibleNames()).toEqual(['uuid generator']);
  });

  it('tolerates a typo', () => {
    initHomeFilter();
    type('jsno');

    expect(visibleNames()).toContain('json formatter');
  });

  it('hides a section with no visible cards', () => {
    initHomeFilter();
    type('formatter');

    const formatSection = document.querySelector<HTMLElement>('[data-category-section="Format"]')!;
    const generateSection = document.querySelector<HTMLElement>('[data-category-section="Generate"]')!;
    expect(formatSection.hidden).toBe(false);
    expect(generateSection.hidden).toBe(true);
  });

  it('shows the empty message when nothing matches at all', () => {
    initHomeFilter();
    type('nonsensequery');

    expect(visibleNames()).toEqual([]);
    expect(emptyMessage().hidden).toBe(false);
  });

  it('restores the full list when the query is cleared', () => {
    initHomeFilter();
    type('json');
    type('');

    expect(visibleNames()).toHaveLength(TOOLS.length);
    expect(emptyMessage().hidden).toBe(true);
  });
});

describe('initHomeFilter — category filtering', () => {
  it('shows only tools in the selected category', () => {
    initHomeFilter();
    categoryButton('Format').click();

    expect(visibleNames()).toEqual(['json formatter', 'sql formatter']);
  });

  it('marks the clicked chip pressed and every other chip unpressed', () => {
    initHomeFilter();
    categoryButton('Generate').click();

    expect(categoryButton('Generate')).toHaveAttribute('aria-pressed', 'true');
    expect(categoryButton('Format')).toHaveAttribute('aria-pressed', 'false');
    expect(categoryButton('all')).toHaveAttribute('aria-pressed', 'false');
  });

  it('returns to the full list on "All"', () => {
    initHomeFilter();
    categoryButton('Format').click();
    categoryButton('all').click();

    expect(visibleNames()).toHaveLength(TOOLS.length);
  });

  it('combines with the search query', () => {
    initHomeFilter();
    categoryButton('Generate').click();
    type('json');

    // "qr code generator" mentions json in its summary; "json formatter" is Format-only
    // so the category filter alone should have already excluded it.
    expect(visibleNames()).toEqual(['qr code generator']);
  });

  it('shows the empty message when a category and query combine to match nothing', () => {
    initHomeFilter();
    categoryButton('Format').click();
    type('identifiers');

    expect(visibleNames()).toEqual([]);
    expect(emptyMessage().hidden).toBe(false);
  });
});

describe('initHomeFilter — category-name matches', () => {
  it('shows every tool in a category whose own name matches the query, even ones whose text does not', () => {
    // "llm token counter" doesn't say "ai" anywhere in its own title or summary, but it
    // belongs to the AI category, which the query names directly — it should still show.
    initHomeFilter();
    type('ai');

    expect(visibleNames()).toContain('llm token counter');
  });

  it('does not boost a category the query does not name', () => {
    initHomeFilter();
    type('generate');

    expect(visibleNames()).not.toContain('llm token counter');
  });

  it('still requires every token to match when the query has more than one word', () => {
    initHomeFilter();
    type('ai nonsense');

    expect(visibleNames()).toEqual([]);
  });
});

describe('initHomeFilter — clear button', () => {
  it('empties the field, reapplies the filter and refocuses the input', () => {
    initHomeFilter();
    type('formatter');
    categoryButton('Format').click();

    clearButton().click();

    expect(search().value).toBe('');
    expect(visibleNames()).toEqual(['json formatter', 'sql formatter']); // category selection persists
    expect(document.activeElement).toBe(search());
  });

  it('does nothing if the search input is missing', () => {
    document.body.innerHTML = '<button data-home-search-clear></button><div data-home-category-filter></div>';
    expect(() => initHomeFilter()).not.toThrow();
  });
});

describe('initHomeFilter — keyboard shortcut', () => {
  it('focuses and selects the search field on Ctrl+K', () => {
    initHomeFilter();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

    expect(document.activeElement).toBe(search());
  });

  it('accepts Cmd+K as well, and is case-insensitive', () => {
    initHomeFilter();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', metaKey: true }));

    expect(document.activeElement).toBe(search());
  });

  it('suppresses the browser default so the shortcut is not stolen', () => {
    initHomeFilter();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a bare "k" so typing in the field is not hijacked', () => {
    initHomeFilter();
    const event = new KeyboardEvent('keydown', { key: 'k', cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('shows the Mac shortcut label on a Mac', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    initHomeFilter();

    expect(document.querySelector('[data-home-search-kbd]')!.textContent).toBe('⌘ K');
  });

  it('leaves the Ctrl label alone elsewhere', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    initHomeFilter();

    expect(document.querySelector('[data-home-search-kbd]')!.textContent).toBe('Ctrl K');
  });
});
