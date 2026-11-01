import { describe, it, expect } from 'vitest';
import { UNLISTED_PAGES, UNLISTED_SLUGS, isUnlistedPageEnabled, unlistedRoutes, type UnlistedPage } from './unlistedPages';

const page = (overrides: Partial<UnlistedPage>): UnlistedPage => ({ slug: 'x', entrypoint: './x.astro', enabled: true, ...overrides });

describe('unlistedRoutes', () => {
  it('routes an enabled page to its own entrypoint', () => {
    expect(unlistedRoutes([page({ fallbackEntrypoint: './fallback.astro' })])).toEqual([{ pattern: '/x', entrypoint: './x.astro' }]);
  });

  it('routes a disabled page to its fallback at the same URL', () => {
    expect(unlistedRoutes([page({ enabled: false, fallbackEntrypoint: './fallback.astro' })])).toEqual([{ pattern: '/x', entrypoint: './fallback.astro' }]);
  });

  it('drops a disabled page with no fallback, so its URL 404s', () => {
    expect(unlistedRoutes([page({ enabled: false })])).toEqual([]);
  });
});

describe('UNLISTED_PAGES', () => {
  it('lists markdown and markdown-v2, both falling back to the Markdown Previewer', () => {
    expect(UNLISTED_SLUGS).toEqual(['markdown', 'markdown-v2']);
    for (const entry of UNLISTED_PAGES) expect(entry.fallbackEntrypoint).toMatch(/markdown-previewer-fallback\.astro$/);
  });

  it('reports whether a page is enabled', () => {
    expect(isUnlistedPageEnabled('no-such-page')).toBe(false);
    for (const entry of UNLISTED_PAGES) expect(isUnlistedPageEnabled(entry.slug)).toBe(entry.enabled);
  });
});
