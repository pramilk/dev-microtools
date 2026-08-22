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
});
