import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  THEME_MODES,
  readThemeMode,
  nextThemeMode,
  applyThemeMode,
  initThemeToggle,
} from './theme';

/** The markup `ThemeToggle.astro` renders, which this module drives. */
function renderToggles(count = 1) {
  document.body.innerHTML = Array.from(
    { length: count },
    () => `
      <button type="button" data-theme-toggle aria-label="Change colour theme" title="Change colour theme">
        <span data-theme-icon aria-hidden="true">◐</span>
        <span class="sr-only" data-theme-label>System theme</span>
      </button>`
  ).join('');
  return Array.from(document.querySelectorAll<HTMLElement>('[data-theme-toggle]'));
}

const icon = (button: HTMLElement) => button.querySelector('[data-theme-icon]')!.textContent;
const label = (button: HTMLElement) => button.querySelector('[data-theme-label]')!.textContent;
const themeAttr = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nextThemeMode', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextThemeMode('system')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
  });

  it('returns to its starting point after one full lap of the mode list', () => {
    const start = 'system';
    const end = THEME_MODES.reduce<typeof start | 'light' | 'dark'>((mode) => nextThemeMode(mode), start);
    expect(end).toBe(start);
  });
});

describe('readThemeMode', () => {
  it('defaults to system when nothing is stored', () => {
    expect(readThemeMode()).toBe('system');
  });

  it('reads a stored explicit preference', () => {
    localStorage.setItem('theme', 'dark');
    expect(readThemeMode()).toBe('dark');
  });

  it('ignores a stored value that is not a real mode', () => {
    // "system" is stored as *absence*, so a literal "system" — or anything else that
    // got in there — has to fall back rather than be trusted.
    localStorage.setItem('theme', 'system');
    expect(readThemeMode()).toBe('system');

    localStorage.setItem('theme', 'neon');
    expect(readThemeMode()).toBe('system');
  });

  it('falls back to system when localStorage throws, e.g. private mode', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(readThemeMode()).toBe('system');
  });
});

describe('applyThemeMode', () => {
  it('sets data-theme for an explicit mode and stores it', () => {
    applyThemeMode('dark');

    expect(themeAttr()).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('removes data-theme for system so the CSS falls through to prefers-color-scheme', () => {
    applyThemeMode('light');
    applyThemeMode('system');

    expect(themeAttr()).toBeNull();
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('still applies the theme when persisting throws', () => {
    // A blocked localStorage must cost the visitor the memory, not the feature.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(() => applyThemeMode('dark')).not.toThrow();
    expect(themeAttr()).toBe('dark');
  });

  it('updates the icon, the screen-reader label and the tooltip together', () => {
    const [button] = renderToggles();
    applyThemeMode('dark');

    expect(icon(button!)).toBe('☾');
    expect(label(button!)).toBe('Dark theme');
    expect(button!.getAttribute('title')).toBe('Dark theme — click to change');
  });

  it('updates every toggle on the page, not just the first', () => {
    const buttons = renderToggles(2);
    applyThemeMode('light');

    for (const button of buttons) {
      expect(icon(button)).toBe('☀');
      expect(label(button)).toBe('Light theme');
    }
  });

  it('works with no toggle rendered at all', () => {
    expect(() => applyThemeMode('dark')).not.toThrow();
    expect(themeAttr()).toBe('dark');
  });
});

describe('initThemeToggle', () => {
  it('syncs the control to the stored preference on load', () => {
    localStorage.setItem('theme', 'light');
    const [button] = renderToggles();

    initThemeToggle();

    expect(themeAttr()).toBe('light');
    expect(icon(button!)).toBe('☀');
  });

  it('advances one step per click and wraps around', () => {
    const [button] = renderToggles();
    initThemeToggle();

    button!.click();
    expect(themeAttr()).toBe('light');

    button!.click();
    expect(themeAttr()).toBe('dark');

    button!.click();
    expect(themeAttr()).toBeNull();
    expect(label(button!)).toBe('System theme');
  });

  it('continues the cycle from the stored mode rather than restarting at system', () => {
    localStorage.setItem('theme', 'dark');
    const [button] = renderToggles();
    initThemeToggle();

    button!.click();
    expect(themeAttr()).toBeNull();
  });

  it('keeps several toggles in step when either one is clicked', () => {
    // The header and the mobile menu both render one; they must never disagree.
    const buttons = renderToggles(2);
    initThemeToggle();

    buttons[1]!.click();

    expect(themeAttr()).toBe('light');
    expect(icon(buttons[0]!)).toBe('☀');
    expect(icon(buttons[1]!)).toBe('☀');
  });
});
