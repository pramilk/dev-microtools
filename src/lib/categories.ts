/**
 * Canonical list of tool categories, in the order they should appear on the homepage
 * and in the sidebar. Adding, renaming, or reordering a category happens here — nowhere
 * else — since `content.config.ts`'s schema and every category-grouped listing all derive
 * from this one array.
 *
 * The order is deliberate, not alphabetical: the broadest, highest-traffic groups lead and
 * the narrowest (`CSS`) trails, so the homepage grid opens on the sections most visitors
 * came for. Alphabetical would put the two-item `CSS` section first.
 */
export const CATEGORIES = [
  'Convert',
  'Format',
  'Generate',
  'Security',
  'Text',
  'AI',
  'Web & Network',
  'Images',
  'CSS',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * URL-safe slug for each category's crawlable landing page at `/category/<slug>/`
 * (see `src/pages/category/[category].astro`). Kept as an explicit map rather than a
 * generic slugify() so the mapping is stable even if a category's display name (the
 * `&` in "Web & Network") ever changes — the URL shouldn't move just because the label did.
 */
export const CATEGORY_SLUGS: Record<Category, string> = {
  Convert: 'convert',
  Format: 'format',
  Generate: 'generate',
  Security: 'security',
  Text: 'text',
  AI: 'ai',
  'Web & Network': 'web-network',
  Images: 'images',
  CSS: 'css',
};

const CATEGORIES_BY_SLUG: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((category) => [CATEGORY_SLUGS[category], category])
);

export function categoryFromSlug(slug: string): Category | undefined {
  return CATEGORIES_BY_SLUG[slug];
}

/**
 * Short, genuine per-category description used as the landing page's meta description
 * and on-page intro. Written by hand, one per category, naming the actual tools inside it
 * — a templated "Tools for X" sentence would read as thin/duplicate content across all
 * nine pages, which CLAUDE.md's SEO section explicitly rules out.
 */
export const CATEGORY_INTROS: Record<Category, string> = {
  Convert:
    'Convert data between the formats developers hit every day: Base64/Base32/Base58, JSON/YAML/CSV/XML, Unix timestamps and ISO dates, CSS colour spaces, Docker run commands and Compose files, and JSON/XML into typed source code. Every converter shows both directions at once, so you can check a round trip instantly.',
  Format:
    "Beautify or minify code without installing a linter or IDE plugin: pretty-print and validate JSON, format SQL queries, indent XML, minify HTML/CSS/JavaScript for production, and preview Markdown as rendered HTML. Paste malformed input and get a clear error pointing at exactly what's wrong.",
  Generate:
    'Generate the small artifacts a project always needs: UUIDs, QR codes, barcodes, placeholder text, realistic fake test data, URL-safe slugs, curl commands built from a form, and the meta tags or JSON-LD structured data a page is missing. No sign-up, no rate limits, no watermarks.',
  Security:
    'Work with secrets, hashes and headers without sending them anywhere: decode and verify JWTs, hash and check bcrypt passwords, compute MD5/SHA hashes and HMACs, generate strong random passwords, build a Content-Security-Policy header, and produce an RFC 9116 security.txt file.',
  Text: 'Manipulate and inspect plain text: test a regex against sample input live, diff two blocks of text or JSON line by line, count words and characters, convert between camelCase/snake_case/Title Case, strip duplicate lines, and reveal invisible Unicode characters hiding in pasted text.',
  AI: 'Tools for working with AI systems and the crawlers behind them: count how many tokens a prompt costs against a model’s context window, and generate a robots.txt with an explicit policy for which AI crawlers may train on or cite your site.',
  'Web & Network':
    'Inspect the networking and browser details behind a request: parse a URL into its components, decode a User-Agent string, calculate an IPv4 subnet’s usable range, explain what a cron expression schedules, check an npm package’s real install size, look up ASCII/Unicode keycodes, and see what your browser exposes via fingerprinting.',
  Images:
    'Edit and convert images entirely on-device: remove a photo’s background, blur faces and license plates, crop and resize, compress without a quality hit, convert between PNG/JPEG/WebP, upscale a small image up to 8x, optimize an SVG’s file size, embed an image as Base64, and generate a full favicon package from one source file.',
  CSS: 'Build CSS visual effects with a live preview and copyable output: layered box-shadows with adjustable blur, spread and colour, and linear/radial gradients with multiple colour stops — tweak with controls and copy the finished CSS straight into your stylesheet.',
};

/** Short, distinct <title>/H1 per category page — not a templated "X Tools" for all nine. */
export const CATEGORY_HEADLINES: Record<Category, string> = {
  Convert: 'Data & Format Converters',
  Format: 'Code Formatters & Beautifiers',
  Generate: 'Generators — UUID, QR, Fake Data & More',
  Security: 'Security & Cryptography Tools',
  Text: 'Text & String Utilities',
  AI: 'AI & LLM Developer Tools',
  'Web & Network': 'Web & Network Developer Tools',
  Images: 'Image Editing & Conversion Tools',
  CSS: 'CSS Generators — Gradients & Shadows',
};
