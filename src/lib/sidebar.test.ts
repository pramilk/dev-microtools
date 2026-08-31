import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  editDistance,
  tokenize,
  tokenMatches,
  matchTool,
  isMacPlatform,
  isSidebarOpen,
  setSidebarOpen,
  initSidebar,
} from './sidebar';

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('json', 'json', 2)).toBe(0);
  });

  it('counts a substitution, an insertion and a deletion as one edit each', () => {
    expect(editDistance('json', 'jsan', 2)).toBe(1);
    expect(editDistance('jsn', 'json', 2)).toBe(1);
    expect(editDistance('jsonn', 'json', 2)).toBe(1);
  });

  it('counts two swapped adjacent letters as a single edit', () => {
    // The whole reason this is OSA rather than plain Levenshtein: "jsno" for "json" is
    // the most common typo shape there is, and plain Levenshtein scores it 2.
    expect(editDistance('jsno', 'json', 2)).toBe(1);
    expect(editDistance('regxe', 'regex', 2)).toBe(1);
  });

  it('handles an empty string on either side', () => {
    expect(editDistance('', '', 2)).toBe(0);
    expect(editDistance('', 'abc', 5)).toBe(3);
    expect(editDistance('abc', '', 5)).toBe(3);
  });

  it('bails out early on a length gap wider than the budget', () => {
    // The early-out is allowed to over-report; all a threshold test needs is "> max".
    expect(editDistance('a', 'abcdefgh', 2)).toBeGreaterThan(2);
  });

  it('is symmetric', () => {
    expect(editDistance('base64', 'basee4', 2)).toBe(editDistance('basee4', 'base64', 2));
  });
});

describe('tokenize', () => {
  it('lower-cases and splits on whitespace', () => {
    expect(tokenize('  JSON   Formatter ')).toEqual(['json', 'formatter']);
  });

  it('returns nothing for an empty or whitespace-only query', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('    ')).toEqual([]);
  });

  it('splits on tabs and newlines as well as spaces', () => {
    expect(tokenize('json\tto\nyaml')).toEqual(['json', 'to', 'yaml']);
  });
});

describe('tokenMatches', () => {
  const words = 'json formatter format and validate json'.split(' ');

  it('matches the start of a word, including a partial word being typed', () => {
    expect(tokenMatches('form', words)).toBe(true);
    expect(tokenMatches('json', words)).toBe(true);
  });

  it('rejects a token that is not a prefix of any word, rather than fuzzy-matching it', () => {
    // Below four characters almost anything is within one edit of something, which
    // would make short queries match the entire list.
    expect(tokenMatches('xyz', words)).toBe(false);
  });

  it('rejects a short token that only occurs mid-word, not at the start of one', () => {
    // A plain substring search would match "ai" inside "validate" or "format" by pure
    // coincidence — irrelevant to what the tool actually does. Only a word that starts
    // with the token should count.
    expect(tokenMatches('ai', words)).toBe(false);
    expect(tokenMatches('at', ['validate'])).toBe(false);
  });

  it('tolerates one typo in a token of four or five characters', () => {
    expect(tokenMatches('jsno', words)).toBe(true);
    expect(tokenMatches('jsonn', words)).toBe(true);
  });

  it('tolerates two typos only once a token is longer than five characters', () => {
    expect(tokenMatches('formatr', words)).toBe(true);
    expect(tokenMatches('vlidat', words)).toBe(true);
  });

  it('rejects a token too far from anything in the haystack', () => {
    expect(tokenMatches('bcrypt', words)).toBe(false);
  });
});

describe('matchTool', () => {
  const NAME = 'unix timestamp converter';
  const SUMMARY = 'convert between epoch seconds and human dates';

  it('matches everything when the query is empty', () => {
    expect(matchTool(NAME, SUMMARY, [])).toEqual({ match: true, weak: false });
  });

  it('requires every token to match, not merely one of them', () => {
    expect(matchTool(NAME, SUMMARY, ['unix', 'converter']).match).toBe(true);
    expect(matchTool(NAME, SUMMARY, ['unix', 'bcrypt']).match).toBe(false);
  });

  it('is order-independent across tokens', () => {
    expect(matchTool(NAME, SUMMARY, ['converter', 'unix']).match).toBe(true);
  });

  it('lets tokens match across the title and the summary together', () => {
    expect(matchTool(NAME, SUMMARY, ['unix', 'epoch']).match).toBe(true);
  });

  it('ranks a title hit above a summary-only hit', () => {
    expect(matchTool(NAME, SUMMARY, ['timestamp'])).toEqual({ match: true, weak: false });
    expect(matchTool(NAME, SUMMARY, ['epoch'])).toEqual({ match: true, weak: true });
  });

  it('treats a mixed title-and-summary query as a weak match', () => {
    // Only an all-title match earns top ranking; anything leaning on the description
    // sorts below the tools whose names actually say it.
    expect(matchTool(NAME, SUMMARY, ['unix', 'epoch']).weak).toBe(true);
  });

  it('never reports a weak non-match', () => {
    expect(matchTool(NAME, SUMMARY, ['nonsensequery'])).toEqual({ match: false, weak: false });
  });

  it('copes with a tool that has an empty summary', () => {
    expect(matchTool('uuid generator', '', ['uuid']).match).toBe(true);
    expect(matchTool('uuid generator', '', ['epoch']).match).toBe(false);
  });
});

describe('isMacPlatform', () => {
  it('prefers userAgentData.platform when the browser exposes it', () => {
    expect(isMacPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' } as unknown as Navigator)).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' } as unknown as Navigator)).toBe(false);
  });

  it('falls back to navigator.platform where userAgentData is missing', () => {
    expect(isMacPlatform({ platform: 'MacIntel' } as unknown as Navigator)).toBe(true);
    expect(isMacPlatform({ platform: 'Linux x86_64' } as unknown as Navigator)).toBe(false);
  });
});

/* ------------------------------------------------------------------ DOM */

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

/** The markup `ToolsSidebar.astro` renders, reduced to what the script actually reads. */
function renderSidebar(): void {
  const categories = [...new Set(TOOLS.map((tool) => tool.category))];
  document.documentElement.setAttribute('data-sidebar', 'open');
  document.body.innerHTML = `
    <button type="button" data-sidebar-toggle aria-expanded="true"></button>
    <input type="search" data-sidebar-search />
    <kbd data-sidebar-search-kbd>Ctrl K</kbd>
    <button type="button" data-sidebar-search-clear aria-label="Clear search">×</button>
    <nav>
      ${categories
        .map(
          (category) => `
        <div data-sidebar-group>
          <ul class="sidebar__list">
            ${TOOLS.filter((tool) => tool.category === category)
              .map(
                (tool) =>
                  // A hash href rather than the real `/<slug>/`: the click handler never
                  // reads it, and jsdom logs a "navigation not implemented" error for a
                  // cross-document link.
                  `<li data-sidebar-item data-tool-name="${tool.name}" data-tool-summary="${tool.summary}" data-tool-category="${tool.category}"><a href="#${tool.name.replace(/\s+/g, '-')}">${tool.name}</a></li>`
              )
              .join('')}
          </ul>
        </div>`
        )
        .join('')}
      <p data-sidebar-empty hidden>No tools match your search.</p>
    </nav>
    <div data-sidebar-backdrop></div>`;
}

const search = () => document.querySelector<HTMLInputElement>('[data-sidebar-search]')!;
const items = () => Array.from(document.querySelectorAll<HTMLLIElement>('[data-sidebar-item]'));
const visibleNames = () =>
  items()
    .filter((item) => !item.hidden)
    .map((item) => item.dataset.toolName);
const emptyMessage = () => document.querySelector<HTMLElement>('[data-sidebar-empty]')!;
const searchClear = () => document.querySelector<HTMLButtonElement>('[data-sidebar-search-clear]')!;

function type(value: string): void {
  search().value = value;
  search().dispatchEvent(new Event('input'));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  renderSidebar();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-sidebar');
  document.body.innerHTML = '';
});

describe('setSidebarOpen / isSidebarOpen', () => {
  it('round-trips through the data-sidebar attribute the pre-paint script sets', () => {
    setSidebarOpen(false);
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('closed');
    expect(isSidebarOpen()).toBe(false);

    setSidebarOpen(true);
    expect(isSidebarOpen()).toBe(true);
  });

  it('remembers the choice', () => {
    setSidebarOpen(false);
    expect(localStorage.getItem('sidebarOpen')).toBe('0');

    setSidebarOpen(true);
    expect(localStorage.getItem('sidebarOpen')).toBe('1');
  });

  it('still toggles when persisting throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(() => setSidebarOpen(false)).not.toThrow();
    expect(isSidebarOpen()).toBe(false);
  });

  it('keeps every toggle button announcing the right state', () => {
    setSidebarOpen(false);
    expect(document.querySelector('[data-sidebar-toggle]')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('initSidebar — open/close controls', () => {
  it('toggles on the collapse button', () => {
    initSidebar();
    const toggle = document.querySelector<HTMLElement>('[data-sidebar-toggle]')!;

    toggle.click();
    expect(isSidebarOpen()).toBe(false);

    toggle.click();
    expect(isSidebarOpen()).toBe(true);
  });

  it('closes on the backdrop', () => {
    initSidebar();
    document.querySelector<HTMLElement>('[data-sidebar-backdrop]')!.click();
    expect(isSidebarOpen()).toBe(false);
  });

  it('closes on Escape while open, and does nothing while already closed', () => {
    initSidebar();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isSidebarOpen()).toBe(false);

    localStorage.removeItem('sidebarOpen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(localStorage.getItem('sidebarOpen')).toBeNull();
  });

  it('closes on a tool link only while the sidebar is an overlay', () => {
    const link = () => document.querySelector<HTMLAnchorElement>('.sidebar__list a')!;
    initSidebar();

    link().click();
    expect(isSidebarOpen()).toBe(true);

    document.body.innerHTML = '';
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderSidebar();
    initSidebar();

    link().click();
    expect(isSidebarOpen()).toBe(false);
  });
});

describe('initSidebar — keyboard shortcut', () => {
  it('focuses and selects the search field on Ctrl+K', () => {
    initSidebar();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

    expect(document.activeElement).toBe(search());
  });

  it('accepts Cmd+K as well, and is case-insensitive', () => {
    initSidebar();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', metaKey: true }));

    expect(document.activeElement).toBe(search());
  });

  it('opens a collapsed sidebar before focusing, so the field is actually reachable', () => {
    setSidebarOpen(false);
    initSidebar();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

    expect(isSidebarOpen()).toBe(true);
    expect(document.activeElement).toBe(search());
  });

  it('suppresses the browser default so the shortcut is not stolen', () => {
    initSidebar();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a bare "k" so typing in the field is not hijacked', () => {
    initSidebar();
    const event = new KeyboardEvent('keydown', { key: 'k', cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('shows the Mac shortcut label on a Mac', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    initSidebar();

    expect(document.querySelector('[data-sidebar-search-kbd]')!.textContent).toBe('⌘ K');
  });

  it('leaves the Ctrl label alone elsewhere', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    initSidebar();

    expect(document.querySelector('[data-sidebar-search-kbd]')!.textContent).toBe('Ctrl K');
  });
});

describe('initSidebar — clear button', () => {
  it('empties the field, reapplies the filter and refocuses the input', () => {
    initSidebar();
    type('formatter');

    searchClear().click();

    expect(search().value).toBe('');
    expect(visibleNames()).toHaveLength(TOOLS.length);
    expect(document.activeElement).toBe(search());
  });

  it('does nothing if the search input is missing', () => {
    document.body.innerHTML = '<button data-sidebar-search-clear></button>';
    initSidebar();
    expect(() => searchClear().click()).not.toThrow();
  });
});

describe('initSidebar — search filtering', () => {
  it('shows everything before a query is typed', () => {
    initSidebar();
    expect(visibleNames()).toHaveLength(TOOLS.length);
    expect(emptyMessage().hidden).toBe(true);
  });

  it('filters to matching tools', () => {
    initSidebar();
    type('formatter');

    expect(visibleNames()).toEqual(['json formatter', 'sql formatter']);
  });

  it('requires every word to match', () => {
    initSidebar();
    type('json formatter');

    expect(visibleNames()).toEqual(['json formatter']);
  });

  it('matches on the summary as well as the title', () => {
    initSidebar();
    type('identifiers');

    expect(visibleNames()).toEqual(['uuid generator']);
  });

  it('tolerates a typo', () => {
    initSidebar();
    type('jsno');

    expect(visibleNames()).toContain('json formatter');
  });

  it('floats title matches above summary-only matches within a group', () => {
    // "qr code generator" mentions json only in its summary, so it must sort below
    // "json formatter" — which is in a different group, so check the flag instead.
    initSidebar();
    type('json');

    const byName = new Map(items().map((item) => [item.dataset.toolName, item]));
    expect(byName.get('json formatter')!.classList.contains('sidebar__item--weak-match')).toBe(false);
    expect(byName.get('qr code generator')!.classList.contains('sidebar__item--weak-match')).toBe(true);
  });

  it('reorders a group so its strong matches come first', () => {
    // "code" is in the uuid tool's summary but in the QR tool's *name*, and the uuid
    // tool sits first in the markup — so a correct ranking has to physically move it.
    initSidebar();
    type('code');

    expect(visibleNames()).toEqual(['qr code generator', 'uuid generator']);
  });

  it('hides a group with no visible items', () => {
    initSidebar();
    type('formatter');

    const [formatGroup, generateGroup] = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-group]'));
    expect(formatGroup!.hidden).toBe(false);
    expect(generateGroup!.hidden).toBe(true);
  });

  it('shows the empty message when nothing matches at all', () => {
    initSidebar();
    type('nonsensequery');

    expect(visibleNames()).toEqual([]);
    expect(emptyMessage().hidden).toBe(false);
  });

  it('restores the original order and full list when the query is cleared', () => {
    const original = items().map((item) => item.dataset.toolName);
    initSidebar();

    type('json');
    type('');

    expect(items().map((item) => item.dataset.toolName)).toEqual(original);
    expect(visibleNames()).toHaveLength(TOOLS.length);
    expect(emptyMessage().hidden).toBe(true);
    for (const item of items()) {
      expect(item.classList.contains('sidebar__item--weak-match')).toBe(false);
    }
  });

  it('treats a whitespace-only query as no query', () => {
    initSidebar();
    type('   ');

    expect(visibleNames()).toHaveLength(TOOLS.length);
    expect(emptyMessage().hidden).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    initSidebar();
    type('  JSON  ');

    expect(visibleNames()).toContain('json formatter');
  });

  it('shows every tool in a category whose own name matches the query, even ones whose text does not', () => {
    // "llm token counter" doesn't say "ai" anywhere in its own title or summary, but it
    // belongs to the AI category, which the query names directly — same rule the
    // homepage search applies, via the shared `categoryMatchesTokens`.
    initSidebar();
    type('ai');

    expect(visibleNames()).toContain('llm token counter');
  });

  it('does not boost a category the query does not name', () => {
    initSidebar();
    type('generate');

    expect(visibleNames()).not.toContain('llm token counter');
  });
});
