// @ts-check
import { cpSync, createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { load as loadYaml } from 'js-yaml';
import { UNLISTED_SLUGS, unlistedRoutes } from './src/lib/unlistedPages';
import { SITE as SITE_CONFIG } from './src/lib/site';

// Required for @astrojs/sitemap to emit absolute URLs and for canonical link tags.
const SITE = 'https://devmicrotools.com';

/**
 * slug -> `updated` date, read directly off each tool's .mdx frontmatter (the same field
 * `[slug].astro` uses for JSON-LD `dateModified`) so the sitemap can carry a real per-page
 * `<lastmod>` instead of none at all. Read here with a plain YAML parse rather than through
 * `astro:content` — that virtual module isn't available yet while the config itself is being
 * evaluated, and this integration option only runs once at build time.
 */
function readToolLastmods() {
  const toolsDir = fileURLToPath(new URL('./src/content/tools/', import.meta.url));
  const lastmods = new Map();
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith('.mdx')) continue;
    const raw = readFileSync(path.join(toolsDir, file), 'utf-8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;
    const frontmatter = /** @type {{ updated?: string | Date }} */ (loadYaml(match[1]));
    if (frontmatter?.updated) {
      lastmods.set(file.slice(0, -'.mdx'.length), new Date(frontmatter.updated).toISOString());
    }
  }
  return lastmods;
}

const toolLastmods = readToolLastmods();

/**
 * pdf.js (Split PDF's page thumbnails) loads a few data files at runtime, only when a PDF
 * needs them: WebAssembly image decoders (JPEG 2000, JBIG2), the 14 standard fonts for PDFs
 * that don't embed theirs, and CMaps for CJK text. They're served same-origin from
 * `/vendor/pdfjs-<version>/` — the island builds the same path from pdf.js's own `version`
 * export, so the two can't drift — copied out of the installed package at build time rather
 * than vendored into the repo, and streamed straight from node_modules in dev. Versioned
 * paths mean an upgrade never serves a stale decoder from cache.
 */
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfjsVersion = JSON.parse(readFileSync(path.join(pdfjsRoot, 'package.json'), 'utf-8')).version;
const PDFJS_ASSET_BASE = `/vendor/pdfjs-${pdfjsVersion}/`;
const PDFJS_ASSET_DIRS = ['wasm', 'standard_fonts', 'cmaps'];

/** @type {import('astro').AstroIntegration} */
const pdfjsAssets = {
  name: 'pdfjs-assets',
  hooks: {
    'astro:config:setup': ({ updateConfig }) => {
      updateConfig({
        vite: {
          plugins: [
            {
              name: 'pdfjs-assets-dev',
              configureServer(server) {
                server.middlewares.use(PDFJS_ASSET_BASE, (req, res, next) => {
                  const relative = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
                  const file = path.resolve(pdfjsRoot, relative);
                  const inAllowedDir = PDFJS_ASSET_DIRS.some((dir) => file.startsWith(path.join(pdfjsRoot, dir) + path.sep));
                  if (!inAllowedDir || path.basename(file).startsWith('quickjs') || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
                  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
                  createReadStream(file).pipe(res);
                });
              },
            },
          ],
        },
      });
    },
    'astro:build:done': ({ dir }) => {
      for (const assetDir of PDFJS_ASSET_DIRS) {
        cpSync(path.join(pdfjsRoot, assetDir), fileURLToPath(new URL(`.${PDFJS_ASSET_BASE}${assetDir}/`, dir)), {
          recursive: true,
          // QuickJS only runs JavaScript embedded in a PDF (pdf.js "scripting"), which the
          // thumbnails never enable — no reason to deploy a JS engine nobody can reach.
          filter: (source) => !path.basename(source).startsWith('quickjs'),
        });
      }
    },
  },
};

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Static output: every tool page is pre-rendered HTML at build time.
  // No adapter needed to deploy to Cloudflare Workers static assets.
  output: 'static',
  trailingSlash: 'always',
  // Static build-time redirect: /feedback/ has no content of its own, it just forwards
  // to GitHub Issues so the site can link to a stable internal URL from the nav.
  // Toggled by SITE.feedbackEnabled in src/lib/site.ts.
  redirects: SITE_CONFIG.feedbackEnabled
    ? { '/feedback': 'https://github.com/pramilk/dev-microtools/issues/new' }
    : {},
  integrations: [
    preact(),
    pdfjsAssets,
    mdx(),
    // Routes the unlisted, direct-link-only pages that are switched on in
    // src/lib/unlistedPages.ts — the one place to enable or disable them.
    {
      name: 'unlisted-pages',
      hooks: {
        'astro:config:setup': ({ injectRoute }) => {
          for (const route of unlistedRoutes()) injectRoute(route);
        },
      },
    },
    sitemap({
      // Unlisted pages (src/lib/unlistedPages.ts) stay out of the sitemap.
      filter: (page) => !UNLISTED_SLUGS.some((slug) => new URL(page).pathname === `/${slug}/`),
      // Gives Google/Bing a real recrawl signal per tool page instead of a bare <loc> —
      // reuses the same `updated` frontmatter date [slug].astro's JSON-LD `dateModified`
      // already relies on. Non-tool pages (home, about, privacy) are left without
      // <lastmod> rather than guessing one.
      serialize(item) {
        const slugMatch = new URL(item.url).pathname.match(/^\/([^/]+)\/$/);
        const lastmod = slugMatch ? toolLastmods.get(slugMatch[1]) : undefined;
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
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
        'mermaid',
        // Imported by the PDF Compressor's worker, which is only created on first use.
        'pdf-lib',
        // Split PDF's page thumbnails (src/islands/shared/pdfThumbnails.ts).
        'pdfjs-dist',
        // AES Encrypt / Decrypt's pure-JS engine (src/lib/tools/aesJsEngine.ts).
        '@noble/ciphers/aes.js',
        '@noble/hashes/pbkdf2.js',
        '@noble/hashes/sha2.js',
      ],
      /*
       * `@jsquash/oxipng` ships a wasm-bindgen-generated WASM module. Vite's esbuild-based
       * dependency optimizer doesn't handle that shape correctly (it's meant for plain JS
       * packages) — the package's own docs call out excluding it instead, letting Vite's
       * native asset pipeline resolve the `.wasm` file directly.
       *
       * `onnxruntime-web` (Background Remover) ships its own Emscripten-generated WASM
       * loader with `import.meta.url`-relative asset references — the same shape esbuild's
       * optimizer mishandles, so it's excluded for the same reason.
       *
       * `@huggingface/transformers` (Sentence Case's NER model) bundles `onnxruntime-web`
       * itself as its inference backend, so it ships the identical WASM-loader shape and
       * needs the same exclusion.
       */
      exclude: ['@jsquash/oxipng', 'onnxruntime-web', '@huggingface/transformers'],
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
