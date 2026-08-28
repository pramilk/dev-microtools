import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared helpers for the tool smoke tests.
 *
 * Kept deliberately thin: each spec should still read as "open the page, use the tool,
 * check what a visitor would see". Anything that hides *what is being asserted* belongs
 * in the spec, not here.
 */

/**
 * Open a tool page and wait until its island has actually hydrated.
 *
 * Every tool is pre-rendered at build time, so the widget's markup is in the HTML before
 * a single byte of JS runs — asserting on it proves nothing. Astro's client runtime
 * removes the `ssr` attribute from `<astro-island>` once the component has taken over,
 * so `astro-island:not([ssr])` is the one signal that separates "HTML shipped" from
 * "the tool works". Every spec starts here, which is what makes this suite catch the
 * island-loading regressions unit tests cannot see.
 */
export async function gotoTool(page: Page, slug: string): Promise<void> {
  await page.goto(`/${slug}/`);
  await expect(page.locator('astro-island:not([ssr])').first()).toBeAttached();
}

/** The tool widget's container, so specs never match content-page prose by accident. */
export function widget(page: Page): Locator {
  return page.locator('.tool-page__widget');
}

/** Set on `window` by {@link expectCopies}; see the comment there for why. */
type CopyProbeWindow = Window & typeof globalThis & { __copyConfirmed?: boolean };

/**
 * Click a copy control and assert both halves of the contract: the visible confirmation
 * the user gets, and the text that actually landed on the clipboard.
 *
 * The confirmation cannot be checked with a normal polled assertion. `CopyButton` shows
 * "Copied" for 1.6s and `navigator.clipboard.writeText()` can take over a second to
 * resolve in headless Chromium, so the visible window drifts and a poll misses it often
 * enough to be flaky. A MutationObserver installed before the click records the
 * transition permanently, which makes the check deterministic regardless of when it
 * happens.
 */
export async function expectCopies(
  page: Page,
  button: Locator,
  expected: string | RegExp
): Promise<void> {
  await expect(button).toBeEnabled();

  await button.evaluate((element) => {
    (window as CopyProbeWindow).__copyConfirmed = false;
    new MutationObserver(() => {
      if ((element.textContent ?? '').toLowerCase().includes('copied')) {
        (window as CopyProbeWindow).__copyConfirmed = true;
      }
    }).observe(element, { subtree: true, childList: true, characterData: true });
  });

  await button.click();

  await expect
    .poll(() => page.evaluate(() => (window as CopyProbeWindow).__copyConfirmed === true), {
      message: 'the copy button never showed its "Copied" confirmation',
    })
    .toBe(true);

  // Windows normalises line endings on the way through the system clipboard, so compare
  // on a substring rather than expecting the copied text back byte for byte.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  if (typeof expected === 'string') {
    expect(clipboard).toContain(expected);
  } else {
    expect(clipboard).toMatch(expected);
  }
}
