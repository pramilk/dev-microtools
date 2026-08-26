/**
 * One-shot, same-session handoff of a payload from one tool's page to another — entirely
 * client-side via `sessionStorage`, no backend and no size cap like a URL-encoded share
 * link has. Meant for "open this other tool with what I'm looking at" actions (e.g. a
 * "View diff" button), not for the general share-link feature every tool already has —
 * that stays URL-based since it needs to work when pasted somewhere else entirely
 * (a different browser, a different machine), which `sessionStorage` can't do.
 *
 * `sessionStorage` written just before a same-origin `window.open()` call is copied into
 * the new browsing context, per the HTML Living Standard (implemented by every major
 * browser) — this works whether the destination opens in a new tab or the same one, as
 * long as `window.open` isn't called with `noopener`, which severs the browsing-context-
 * group relationship that copying depends on. Safe here since the destination is always
 * our own first-party page, not a third party `noopener` would need to protect against.
 */
const PREFIX = 'dmt:handoff:';

/** Returns false if storage was unavailable or full, so callers can fall back. */
export function writeHandoff(toolSlug: string, payload: unknown): boolean {
  try {
    sessionStorage.setItem(`${PREFIX}${toolSlug}`, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Reads and immediately clears the handoff, so a later refresh doesn't replay it. */
export function consumeHandoff<T>(toolSlug: string): T | null {
  try {
    const key = `${PREFIX}${toolSlug}`;
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
