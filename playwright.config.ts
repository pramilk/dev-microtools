import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These tests run against `astro preview` — the *built* site in `dist/` — not the dev
 * server. That is deliberate: the whole point of this suite is to catch hydration and
 * island-loading regressions, and those only exist in the production bundle. The dev
 * server serves unbundled modules through Vite and would hide exactly the class of bug
 * this suite is here to find.
 *
 * `npm run test:e2e` builds first. Use `npm run test:e2e:fast` to re-run against an
 * existing `dist/` while iterating on a test.
 */
/*
 * Deliberately NOT Astro's default 4321: `astro dev` usually owns that port during a
 * working session, and a `reuseExistingServer` hit against it would run the whole suite
 * against the dev server's unbundled modules — the exact thing this suite exists to
 * avoid, and silently, since every test would still pass.
 */
const PORT = 4331;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A stray `test.only` should fail CI rather than silently skip the rest of the suite.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    /*
     * Every tool has a copy-to-clipboard control and the suite asserts the clipboard
     * actually received the text, not just that the button changed label. Chromium
     * needs both permissions granted for `navigator.clipboard.readText()` to resolve.
     */
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  // Chromium only. The tools are plain DOM + Preact with no engine-specific APIs, and a
  // three-browser matrix would triple CI time for close to no extra signal. Add WebKit
  // here if a tool ever reaches for something with real cross-engine divergence.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Not `astro preview` directly: its CLI daemonises itself under an AI coding agent
    // and refuses to start while an old lock file exists, both of which Playwright sees
    // as "the web server exited early". scripts/preview-server.mjs is the same server
    // without that process management. See the comment at the top of that file.
    command: 'node scripts/preview-server.mjs',
    env: { PREVIEW_PORT: String(PORT) },
    url: BASE_URL,
    // Always start a fresh preview: a server left running from an earlier session would
    // be serving a stale `dist/`, and the suite would quietly test the previous build.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
