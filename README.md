# DevMicroTools

[devmicrotools.com](https://devmicrotools.com) — free developer utilities (JSON formatter,
regex tester, Base64, JWT decoder, hashing, diff checker, QR codes, and more) that run
entirely in your browser.

There is no backend. Every tool is client-side JavaScript — nothing you paste into a tool
is ever transmitted anywhere. You can verify this yourself: open DevTools → Network while
using any tool and you'll see no outbound request carrying your input.

## Stack

- [Astro](https://astro.build) — static output, zero JS shipped by default
- [Preact](https://preactjs.com) islands for the interactive part of each tool page only
- TypeScript in strict mode
- [Vitest](https://vitest.dev) + `@testing-library/preact` for unit and component tests
- Deployed as static assets on Cloudflare Workers

## Architecture

```
src/
  layouts/BaseLayout.astro   # head/meta/JSON-LD, header, footer, analytics
  components/                # Header, Footer, ToolCard, RelatedTools, AdSlot, ToolIsland, ...
  content/tools/<slug>.mdx   # per-tool metadata + written content (required by content.config.ts)
  islands/<Tool>.tsx         # one Preact component per tool — the interactive widget
  lib/tools/<name>.ts        # pure, framework-free, unit-tested logic
  lib/toolRegistry.ts        # slug -> component registration
  pages/
    index.astro              # tool directory
    [slug].astro              # dynamic route over the content collection (tools live at /<slug>/)
public/                      # robots.txt, ads.txt, favicon
```

Each tool keeps three concerns separate: pure logic (`lib/tools/`), UI/state (`islands/`),
and content (`content/tools/`). Adding a new tool is additive — one file in each of those
three places, plus a registry entry — never a change to another tool's code.

See [AGENTS.md](AGENTS.md) for the full set of engineering conventions this project follows
(performance budget, testing requirements, SOLID layering, SEO requirements) — the same file
guides both human contributors and AI coding agents working in this repo.

## Development

```sh
npm install
npm run dev          # dev server at localhost:4321
npm run build        # production build to dist/
npm run preview      # serve the built site locally
npm run test         # unit + component tests
```

## License

[MIT](LICENSE)
