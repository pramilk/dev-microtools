// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// Update this to the real domain once it is registered. It is required for
// @astrojs/sitemap to emit absolute URLs and for canonical link tags.
const SITE = 'https://example.com';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Static output: every tool page is pre-rendered HTML at build time.
  // No adapter needed to deploy to Cloudflare Workers static assets.
  output: 'static',
  trailingSlash: 'always',
  integrations: [preact(), mdx(), sitemap()],
  build: {
    // Emit `/tools/foo/index.html` so URLs stay trailing-slash consistent.
    format: 'directory',
    // Inline small stylesheets to cut render-blocking requests (LCP).
    inlineStylesheets: 'auto',
  },
  prefetch: {
    // Prefetch tool pages on link hover so navigation between tools feels instant.
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  vite: {
    optimizeDeps: {
      /*
       * These are loaded with a dynamic import() so they stay out of the initial
       * bundle. In dev that means Vite does not see them at startup, discovers them
       * the first time a user triggers the import, and then re-optimizes — which
       * invalidates the module URL the browser is mid-way through fetching and
       * surfaces as "Failed to fetch dynamically imported module".
       *
       * Listing them here pre-bundles them when the dev server boots instead.
       * Production builds are unaffected; this is purely a dev-server fix.
       */
      include: ['diff', 'blueimp-md5', 'spark-md5'],
    },
  },
});
