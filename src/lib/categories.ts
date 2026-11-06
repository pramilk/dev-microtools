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
  'PDF',
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
  PDF: 'pdf',
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
 * ten pages, which CLAUDE.md's SEO section explicitly rules out.
 */
export const CATEGORY_INTROS: Record<Category, string> = {
  Convert:
    'Convert data between the formats developers hit every day: Base64/Base32/Base58, JSON/YAML/CSV/XML, Unix timestamps and ISO dates, CSS colour spaces, Unix chmod permissions between octal and symbolic notation, Docker run commands and Compose files, and JSON/XML into typed source code. Every converter shows both directions at once, so you can check a round trip instantly.',
  Format:
    "Beautify or minify code without installing a linter or IDE plugin: pretty-print and validate JSON, format SQL queries, indent XML, minify HTML/CSS/JavaScript for production, and preview Markdown as rendered HTML. Paste malformed input and get a clear error pointing at exactly what's wrong.",
  Generate:
    'Generate the small artifacts a project always needs: UUIDs, QR codes, barcodes, placeholder text, realistic fake test data, URL-safe slugs, curl commands built from a form, and the meta tags or JSON-LD structured data a page is missing. No sign-up, no rate limits, no watermarks.',
  Security:
    'Work with secrets, hashes and headers without sending them anywhere: decode and verify JWTs, hash and check bcrypt passwords, compute MD5/SHA hashes and HMACs, encrypt and decrypt text with AES or an RSA public/private key pair, generate strong random passwords, build a Content-Security-Policy header, produce an RFC 9116 security.txt file, check whether a QR code goes straight to its site or through a redirect service, check a pasted email for phishing signs such as spoofed senders, failed SPF/DKIM/DMARC and deceptive links, grade a site’s HTTP security headers, generate and verify TOTP two-factor codes, and decode an X.509 certificate or CSR to see its names, expiry and key strength.',
  Text: 'Manipulate and inspect plain text: test a regex against sample input live, diff two blocks of text or JSON line by line, count words and characters, convert between camelCase/snake_case/Title Case, strip duplicate lines, and reveal invisible Unicode characters hiding in pasted text.',
  AI: 'Tools for working with AI systems and the crawlers behind them: count how many tokens a prompt costs against a model’s context window, and generate a robots.txt with an explicit policy for which AI crawlers may train on or cite your site.',
  'Web & Network':
    'Inspect the networking and browser details behind a request: parse a URL into its components, decode a User-Agent string, calculate an IPv4 subnet’s usable range, explain what a cron expression schedules or build one from scratch with checkboxes, check an npm package’s real install size, look up ASCII/Unicode keycodes, and see what your browser exposes via fingerprinting.',
  Images:
    'Edit and convert images entirely on-device: remove a photo’s background, blur faces and license plates, crop and resize, compress without a quality hit, convert between PNG/JPEG/WebP, upscale a small image up to 8x, optimize an SVG’s file size, embed an image as Base64, and generate a full favicon package from one source file.',
  PDF: 'Work with PDF files without uploading them anywhere: combine several PDFs into one, with page ranges, rotation and drag-to-reorder, while keeping bookmarks, links and fillable form fields intact; or shrink a PDF by re-encoding and downsampling its images to a chosen format, quality and resolution, while text stays sharp and selectable. Everything runs on-device, so confidential documents never leave your browser.',
  CSS: 'Build CSS visual effects with a live preview and copyable output: layered box-shadows with adjustable blur, spread and colour, linear/radial gradients with multiple colour stops, and a full 50-950 tint/shade scale plus colour harmonies generated from one base colour — tweak with controls and copy the finished CSS straight into your stylesheet.',
};

/** Short, distinct <title>/H1 per category page — not a templated "X Tools" for all ten. */
export const CATEGORY_HEADLINES: Record<Category, string> = {
  Convert: 'Data & Format Converters',
  Format: 'Code Formatters & Beautifiers',
  Generate: 'Generators — UUID, QR, Fake Data & More',
  Security: 'Security & Cryptography Tools',
  Text: 'Text & String Utilities',
  AI: 'AI & LLM Developer Tools',
  'Web & Network': 'Web & Network Developer Tools',
  Images: 'Image Editing & Conversion Tools',
  PDF: 'PDF Tools — Merge & Compress PDFs in Your Browser',
  CSS: 'CSS Generators — Gradients & Shadows',
};
