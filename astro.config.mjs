// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// Required for @astrojs/sitemap to emit absolute URLs and for canonical link tags.
const SITE = 'https://devmicrotools.com';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Static output: every tool page is pre-rendered HTML at build time.
  // No adapter needed to deploy to Cloudflare Workers static assets.
  output: 'static',
  trailingSlash: 'always',
  // Static build-time redirect: /feedback/ has no content of its own, it just forwards
  // to GitHub Issues so the site can link to a stable internal URL from the nav.
  redirects: {
    '/feedback': 'https://github.com/pramilk/dev-microtools/issues/new',
  },
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
       *
       * This list should stay in sync with every `await import('pkg')` in
       * src/lib/tools/*.ts — add a new dynamically-imported dependency here in the
       * same change that introduces it, not after someone hits the 504.
       */
      include: [
        'diff',
        'blueimp-md5',
        'spark-md5',
        'js-yaml',
        'terser',
        'sql-formatter',
        'bcryptjs',
        'qrcode-generator',
        'svgo/browser',
        'fflate',
        'image-q',
      ],
      /*
       * `@jsquash/oxipng` ships a wasm-bindgen-generated WASM module. Vite's esbuild-based
       * dependency optimizer doesn't handle that shape correctly (it's meant for plain JS
       * packages) — the package's own docs call out excluding it instead, letting Vite's
       * native asset pipeline resolve the `.wasm` file directly.
       */
      exclude: ['@jsquash/oxipng'],
    },
    worker: {
      // Every worker in src/workers/ dynamically import()s its own heavy dependency
      // (terser, svgo/browser, bcryptjs, diff, blueimp-md5/spark-md5, image-q,
      // @jsquash/oxipng) to keep it out of that worker's own initial chunk, the same
      // reason the main thread lazy-loads them. Vite's default worker output is a single
      // IIFE that can't code-split or use dynamic import() at all; 'es' produces a real ES
      // module worker (built with `{ type: 'module' }`, matching every `?worker` import in
      // src/islands/) so those dynamic imports keep working in the production build, not
      // just in dev.
      format: 'es',
    },
  },
});
