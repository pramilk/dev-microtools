import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { UNLISTED_PAGES, isUnlistedPageEnabled } from '../src/lib/unlistedPages';

// Unlisted pages (src/lib/unlistedPages.ts) must only be reachable by typing their URL:
// no link, sitemap entry, robots.txt rule, llms.txt line or script anywhere else in the
// built site may mention them. Scans every text file in dist/ except each page's own HTML.
const DIST = path.resolve('dist');
const TEXT_FILES = /\.(html|js|mjs|css|xml|txt|json|webmanifest)$/;

function textFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return textFiles(full);
    return TEXT_FILES.test(entry.name) ? [full] : [];
  });
}

test.describe('Unlisted pages', () => {
  for (const { slug } of UNLISTED_PAGES) {
    test(`/${slug}/ isn't mentioned anywhere else in the built site`, () => {
      const ownPage = path.join(DIST, slug, 'index.html');
      // `/<slug>/` or `/<slug>` followed by a quote, #, ? or end — never the start of a longer slug.
      const mention = new RegExp(`/${slug}(?:/|["'#?\s]|$)`, 'm');
      const leaks = textFiles(DIST).filter((file) => file !== ownPage && mention.test(readFileSync(file, 'utf-8')));
      expect(leaks.map((file) => path.relative(DIST, file))).toEqual([]);
    });

    test(`/${slug}/ is still reachable by typing its URL`, async ({ page }) => {
      const response = await page.goto(`/${slug}/`);
      expect(response?.status()).toBe(200);
      if (isUnlistedPageEnabled(slug)) {
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      } else {
        // Disabled: the Markdown Previewer renders in place, credited to its own URL.
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/markdown-previewer\/$/);
        expect(new URL(page.url()).pathname).toBe(`/${slug}/`);
      }
    });
  }
});
