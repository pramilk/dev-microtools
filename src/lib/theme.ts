/**
 * The three-state theme control's behaviour, extracted from `ThemeToggle.astro` so it
 * can be tested — an inline `<script>` in a `.astro` file has no test harness at all.
 * The component keeps the markup and the styles; this owns what happens when the button
 * is pressed.
 */

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_ICONS: Record<ThemeMode, string> = { system: '◐', light: '☀', dark: '☾' };
export const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

/** The stored preference, or `system` when nothing valid is stored. */
export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage blocked (private mode) — fall through to the system default.
  }
  return 'system';
}

/** The next mode in the system -> light -> dark -> system cycle. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]!;
}

/**
 * Applies a mode to the document: the `data-theme` attribute the stylesheet keys off,
 * the stored preference, and every toggle button's icon, label and tooltip.
 *
 * `system` is expressed as the *absence* of `data-theme`, so the CSS falls through to
 * `prefers-color-scheme` rather than freezing whichever theme was current at the time.
 */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }

  try {
    if (mode === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', mode);
  } catch {
    // Persisting is best-effort; the theme still applies for this page view.
  }

  for (const button of document.querySelectorAll<HTMLElement>('[data-theme-toggle]')) {
    const icon = button.querySelector<HTMLElement>('[data-theme-icon]');
    const label = button.querySelector<HTMLElement>('[data-theme-label]');
    if (icon) icon.textContent = THEME_ICONS[mode];
    if (label) label.textContent = THEME_LABELS[mode];
    button.setAttribute('title', `${THEME_LABELS[mode]} — click to change`);
  }
}

/** Wires every theme toggle on the page and syncs the controls to the stored mode. */
export function initThemeToggle(): void {
  let current: ThemeMode = readThemeMode();
  applyThemeMode(current);

  for (const button of document.querySelectorAll<HTMLElement>('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      current = nextThemeMode(current);
      applyThemeMode(current);
    });
  }
}
