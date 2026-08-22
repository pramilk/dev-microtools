# dev-microtools

A collection of free, client-side developer utility tools (JSON formatter, regex tester,
base64, UUID, JWT, hashing, etc.), built as a static Astro site, deployed to Cloudflare,
and monetized with Google AdSense.

The full build plan and progress tracker lives in [.assets/PLAN.md](.assets/PLAN.md) — read
it before starting work, and update its status checkboxes as items are completed.

---

## Non-negotiable requirements

These are project requirements, not preferences. Work that violates them is not done.

### 1. The site must be fast

Performance is a hard requirement, not an optimization pass at the end. Every tool page
must stay in Google's "good" Core Web Vitals range: **LCP < 2.5s, INP < 200ms, CLS < 0.1**.

Rules that follow from this:

- **Ship as little JavaScript as possible.** Astro sends zero JS by default — keep it that
  way for anything static. Only the interactive tool widget on a page becomes an island.
- **Never make a page-wide island.** Hydrate the smallest component that actually needs
  interactivity, never a whole layout or page wrapper.
- **Pick the cheapest hydration directive that works**: `client:visible` for anything below
  the fold, `client:idle` as the default, `client:load` only for the primary widget that is
  the reason the user opened the page. Never `client:only` unless SSR genuinely cannot run.
- **Dynamically `import()` heavy per-tool libraries** from inside the island (diff engines,
  MD5, parsers) so a visitor to the UUID generator never downloads the diff library.
- **Prefer native browser APIs over dependencies**: `crypto.randomUUID()`, `SubtleCrypto`,
  `Intl`, `TextEncoder`, `structuredClone`. Every added dependency needs a real
  justification — there is no such thing as a free npm package on a performance budget.
- **Reserve space for anything that loads late** (ads, images, embeds) with CSS
  `min-height`/`aspect-ratio`. A late-loading ad shifting the layout is a CLS bug.
- **No web fonts unless justified**, and if used: `font-display: swap`, `preconnect`, and a
  real fallback stack. A font that blocks first paint is a performance bug.
- **No client-side routing framework, no jQuery, no UI kit.** The site is static HTML.

Verify, don't assume: run Lighthouse against the built site before declaring perf work done.

### 2. It must look professional

The bar is "a tool a developer would bookmark," not "a template with ads on it."

- Use the project's design tokens consistently — one accent color, a deliberate type
  pairing, a monospace face for all tool input/output. Do not introduce ad-hoc colors,
  spacing values, or font sizes outside the token system.
- Every tool must have complete, consistent states: **default, focused, filled, empty,
  loading, error, and copied**. A tool that silently does nothing on bad input is unfinished.
- Every tool has visible, working **copy-to-clipboard** and **clear/reset** controls, and
  they behave identically across all tools.
- **Dark mode is required** — this audience expects it. Both themes get equal care.
- Accessibility is part of "professional": semantic HTML, labeled inputs, visible keyboard
  focus states, sufficient contrast, and full keyboard operability of every tool.
- **Never fabricate social proof.** No fake testimonials, fake user counts, fake ratings, or
  `aggregateRating` structured data. It is dishonest and it is an actual AdSense and
  Google structured-data policy violation.

### 3. No bugs

- **Every pure function in `src/lib/tools/` needs unit tests** covering: valid input,
  malformed input, empty input, very large input, and Unicode/edge cases (especially for
  base64, URL encoding, and hashing). Use published test vectors where they exist.
- **Every tool island needs a component test**: typing produces output, invalid input
  produces a visible error state (never a silent failure or a raw stack trace in the UI),
  and copy/clear controls work.
- **Every tool needs an end-to-end smoke test** against the built site to catch hydration
  and island-loading regressions that unit tests cannot see.
- **Handle errors explicitly.** No empty `catch` blocks, no swallowed exceptions. An error
  the user caused gets a helpful message explaining what is wrong and how to fix it.
- **TypeScript strict mode stays on.** No `any`, no `@ts-ignore`, no non-null `!` assertions
  to silence the compiler — fix the actual type.
- Tests must pass before anything is considered complete or deployable.

### 4. Code quality: OOP and SOLID

Applied pragmatically — this is a static site, not an enterprise application. The goal is
code that stays easy to extend as the tool count grows from 10 to 30+.

- **Single Responsibility** — the load-bearing one here. Keep three layers strictly separate:
  - `src/lib/tools/*.ts` — pure logic. No DOM, no Preact, no framework imports. Testable in
    isolation.
  - `src/islands/*.tsx` — UI and state only. Calls into `lib/`, never reimplements logic.
  - `src/content/tools/*.mdx` — content and metadata only. No logic.
- **Open/Closed** — adding tool #25 must not require editing tool #1. New tools are added by
  creating files, not by modifying shared code. If adding a tool forces a change to a shared
  component, that component's abstraction is wrong — fix the abstraction.
- **Liskov Substitution** — anything implementing a shared tool interface must be usable
  interchangeably by the shared UI shell without special-casing.
- **Interface Segregation** — prefer small, focused interfaces and props. A tool that only
  transforms text should not be handed a props object designed for the diff viewer.
- **Dependency Inversion** — UI components depend on interfaces/types, not on concrete
  implementations. Pass logic functions in rather than importing a specific implementation
  deep inside a component.
- Favor composition over inheritance; deep class hierarchies are not appropriate here.
- **DRY, but not prematurely.** Extract a shared component on the second or third real
  repetition, not on the first — a wrong abstraction is more expensive than duplication.

### 5. SEO compliance

- Every tool page ships **real written content**, not just the widget: what it is, when to
  use it, how to use it, a worked example, and a genuine FAQ (~500-800 words). This is
  enforced by required fields in the content collection schema — do not make them optional.
- Unique `<title>` and meta description per page. Canonical URL on every page.
- Valid `WebApplication` + `BreadcrumbList` JSON-LD. `FAQPage` only where the FAQ is real.
- `sitemap.xml` and `robots.txt` must stay valid and reachable.
- Internal linking: every tool links to related tools; every page reaches the full tool index.

### 6. Ads must not dominate the page

- Maximum **two** manually-placed ad units per tool page. Never above the fold before any
  content, never adjacent to the tool's own inputs or buttons (accidental-click policy).
- No interstitials, no auto-playing video, no mobile anchor ads that cover content.
- Every ad slot reserves its space in CSS so it cannot cause layout shift.
- The tool is the product; the ad is secondary. If an ad placement makes the tool more
  annoying to use, it is the wrong placement.

---

## Architecture

```
src/
  layouts/BaseLayout.astro   # head/meta/JSON-LD, header, footer, analytics
  components/                # Header, Footer, ToolCard, RelatedTools, AdSlot, Faq,
                              # ToolIsland (slug -> component dispatch, see below)
  content.config.ts          # Zod schema — content fields are REQUIRED, not optional
  content/tools/<slug>.mdx   # per-tool metadata + written content
  islands/<Tool>.tsx         # one Preact component per tool (the interactive widget)
  lib/tools/<name>.ts        # pure, framework-free, unit-tested logic
  lib/toolRegistry.ts        # slug -> logical registration (see below)
  pages/
    index.astro              # tool directory
    [slug].astro             # single dynamic route over the content collection —
                              # tools live at the site root (/<slug>/), not /tools/<slug>/
public/                      # robots.txt, ads.txt, favicon
```

**Adding a new tool** should only require: one `src/lib/tools/<name>.ts` (+ its test), one
`src/islands/<Tool>.tsx` (+ its test), one `src/content/tools/<slug>.mdx` with full content,
and one entry in the slug→component map. If it requires more than that, the abstraction
needs fixing.

**No backend.** Every tool runs entirely in the browser. Nothing the user pastes is ever
transmitted anywhere — this is both the privacy promise and a load-bearing marketing claim,
so do not add a network call to a tool without an explicit decision to change that promise.

---

## Development

Start the dev server in background mode:

```
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Other commands:

```
npm run build      # production build to dist/
npm run preview    # serve the built site locally
npm run test       # unit + component tests
npm run test:e2e   # end-to-end tests against the built site
```

## Working agreements

- **Do not commit to git automatically.** Make changes; the user reviews and commits.
- Update the status checkboxes in [.assets/PLAN.md](.assets/PLAN.md) as work completes, so
  progress is tracked across sessions.
- Never commit real AdSense publisher IDs, analytics tokens, or API keys — use placeholders
  and document what needs to be filled in.

## Reference

Astro docs: https://docs.astro.build

- [Routing and dynamic routes](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Framework components / islands](https://docs.astro.build/en/guides/framework-components/)
- [Content collections](https://docs.astro.build/en/guides/content-collections/)
- [Styling](https://docs.astro.build/en/guides/styling/)
