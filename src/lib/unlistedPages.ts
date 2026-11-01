/**
 * Unlisted, direct-link-only pages. Each one lives in `src/unlisted/` (not `src/pages/`,
 * so it isn't routed automatically) and is injected as a route by the `unlisted-pages`
 * integration in astro.config.mjs while `enabled` is true — flip the flag to publish or
 * withdraw a page. While disabled, its URL serves `fallbackEntrypoint` instead (at the same
 * URL, no redirect), or 404s if it has none.
 *
 * Every page here, enabled or not, is also kept out of the sitemap and reserved against
 * tool slugs in `[slug].astro`, so a tool can never take over its URL.
 */
export interface UnlistedPage {
  /** URL path segment: the page is served at `/<slug>/`. */
  slug: string;
  /** Page component, relative to the project root. */
  entrypoint: string;
  enabled: boolean;
  /** Page served at the same URL while disabled. Omit to let the URL 404. */
  fallbackEntrypoint?: string;
}

/** The regular Markdown Previewer tool page, canonical to /markdown-previewer/. */
const MARKDOWN_PREVIEWER_FALLBACK = './src/unlisted/markdown-previewer-fallback.astro';

export const UNLISTED_PAGES: readonly UnlistedPage[] = [
  // Markdown Previewer content around the AES Encrypt / Decrypt widget.
  { slug: 'markdown', entrypoint: './src/unlisted/markdown.astro', enabled: false, fallbackEntrypoint: MARKDOWN_PREVIEWER_FALLBACK },
  // File ⇄ PNG converter.
  { slug: 'markdown-v2', entrypoint: './src/unlisted/markdown-v2.astro', enabled: false, fallbackEntrypoint: MARKDOWN_PREVIEWER_FALLBACK },
];

export const UNLISTED_SLUGS: readonly string[] = UNLISTED_PAGES.map((page) => page.slug);

/** The routes to inject: each page's own entrypoint while enabled, its fallback while not. */
export function unlistedRoutes(pages: readonly UnlistedPage[] = UNLISTED_PAGES): { pattern: string; entrypoint: string }[] {
  return pages.flatMap((page) => {
    const entrypoint = page.enabled ? page.entrypoint : page.fallbackEntrypoint;
    return entrypoint ? [{ pattern: `/${page.slug}`, entrypoint }] : [];
  });
}

export const isUnlistedPageEnabled = (slug: string): boolean =>
  UNLISTED_PAGES.some((page) => page.slug === slug && page.enabled);
