# DevMicroTools

[devmicrotools.com](https://devmicrotools.com) — free developer utilities (JSON formatter,
regex tester, Base64, JWT decoder, hashing, diff checker, QR codes, and more) that run
entirely in your browser.

There is no backend. Every tool is client-side JavaScript, and nothing you paste into a
tool is ever sent to us. Two tools are an explicit exception: cURL Command Builder's "Send
request" and Bundle Size Checker's "Check size" / "Check all dependencies" fire a real
request straight from your browser to a third party (the URL you built, or the public npm
registry/esm.sh) — but only when you press that specific button, never on page load or
keystroke, and never through any server of ours. Every other tool never makes a network
request at all. You can verify this yourself: open DevTools → Network while using any tool.

## Tools

| Tool | Category | Description |
|---|---|---|
| [Base Converter](https://devmicrotools.com/base-encode-decode/) | Convert | Encode and decode Base64, Base32 and Base58 in one tool — text or file, with format-specific options for each. |
| [URL Encoder & Decoder](https://devmicrotools.com/url-encode-decode/) | Convert | Percent-encode or decode URLs, and break one down into its parts. |
| [Timestamp Converter](https://devmicrotools.com/timestamp-converter/) | Convert | Convert Unix epoch timestamps to dates and back, with a live current time. |
| [Color Converter](https://devmicrotools.com/color-converter/) | Convert | Convert between HEX, RGB, HSL and OKLCH, with WCAG contrast checking. |
| [JSON, YAML, CSV & XML Converter](https://devmicrotools.com/data-format-converter/) | Convert | Convert data between JSON, YAML, CSV and XML in either direction. |
| [JSON & XML to Types](https://devmicrotools.com/json-to-types/) | Convert | Turn a JSON or XML sample into TypeScript, Go, Java, C#, Kotlin, Swift, Rust or Python type definitions, with nested objects and optional fields inferred. |
| [Docker Run ↔ Compose Converter](https://devmicrotools.com/docker-run-compose-converter/) | Convert | Convert a docker run command into a compose service, or a compose service back into a docker run command. |
| [JSON Formatter](https://devmicrotools.com/json-formatter/) | Format | Beautify, minify, validate and repair broken JSON entirely in your browser. |
| [SQL Formatter](https://devmicrotools.com/sql-formatter/) | Format | Beautify a SQL query with consistent indentation and keyword casing. |
| [HTML / CSS / JS Minifier](https://devmicrotools.com/html-css-js-minifier/) | Format | Shrink HTML, CSS or JavaScript by stripping comments and unnecessary whitespace. |
| [XML Formatter](https://devmicrotools.com/xml-formatter/) | Format | Pretty-print, minify, validate, or convert XML to JSON — all in the browser. |
| [Markdown Previewer](https://devmicrotools.com/markdown-previewer/) | Format | Live-preview Markdown as HTML, or convert HTML back into Markdown, right in your browser. |
| [UUID Generator](https://devmicrotools.com/uuid-generator/) | Generate | Generate v4 or time-ordered v7 UUIDs in bulk, and inspect existing ones. |
| [QR Code Generator](https://devmicrotools.com/qr-code-generator/) | Generate | Turn text or a URL into a scannable QR code — download as PNG or SVG. |
| [Fake Data Generator](https://devmicrotools.com/fake-data-generator/) | Generate | Generate realistic fake names, emails, addresses and more as JSON or CSV. |
| [cURL Command Builder](https://devmicrotools.com/curl-command-builder/) | Generate | Turn a method, URL, headers, body and auth into a correctly-escaped curl command. |
| [Lorem Ipsum Generator](https://devmicrotools.com/lorem-ipsum-generator/) | Generate | Generate Lorem Ipsum placeholder text as paragraphs, sentences or words. |
| [Slug Generator](https://devmicrotools.com/slug-generator/) | Generate | Turn a title into a clean, URL-friendly slug — separator, casing and length options. |
| [Meta Tag & Open Graph Generator](https://devmicrotools.com/meta-tag-generator/) | Generate | Build SEO, Open Graph and Twitter Card meta tags for a page, with a live search-result and social-card preview. |
| [Barcode Generator](https://devmicrotools.com/barcode-generator/) | Generate | Turn text or digits into a real, scannable Code 128, Code 39, EAN-13, or UPC-A barcode. |
| [JSON-LD Schema Generator](https://devmicrotools.com/json-ld-generator/) | Generate | Build Article, Product, FAQ, How-to, Organization or Breadcrumb structured data from a form. |
| [JWT Debugger](https://devmicrotools.com/jwt-decoder/) | Security | Decode, verify and sign JSON Web Tokens without uploading them anywhere. |
| [Hash Generator](https://devmicrotools.com/hash-generator/) | Security | Compute MD5, SHA-1 and SHA-2 digests, and verify a checksum against them. |
| [Password Generator](https://devmicrotools.com/password-generator/) | Security | Create strong random passwords with adjustable length and character types. |
| [Bcrypt Generator](https://devmicrotools.com/bcrypt-generator/) | Security | Generate a bcrypt hash from a password, or verify a password against one. |
| [CSP Header Builder & Analyzer](https://devmicrotools.com/csp-header-builder/) | Security | Build a Content-Security-Policy header from a form, or paste one to get it linted and explained. |
| [security.txt Generator](https://devmicrotools.com/security-txt-generator/) | Security | Build a standards-compliant security.txt file (RFC 9116) with validated Contact and Expires fields. |
| [Regex Tester](https://devmicrotools.com/regex-tester/) | Text | Test regular expressions with live highlighting, groups and replace preview. |
| [Diff Checker](https://devmicrotools.com/diff-checker/) | Text | Compare two texts or JSON documents and see exactly what changed. |
| [Word Counter](https://devmicrotools.com/word-counter/) | Text | Count words and characters, convert text case, and find and replace text. |
| [Duplicate Line Remover](https://devmicrotools.com/duplicate-line-remover/) | Text | Find duplicate lines, sentences, or paragraphs and remove one, some, or all of them. |
| [Case Converter](https://devmicrotools.com/case-converter/) | Text | Convert text between nine common casing styles, plus a smarter NLP-assisted Sentence case. |
| [Invisible & Homoglyph Inspector](https://devmicrotools.com/invisible-char-inspector/) | Text | Find zero-width characters, bidi overrides, odd whitespace and Latin-lookalike homoglyphs, then clean them. |
| [LLM Token Counter](https://devmicrotools.com/llm-token-counter/) | AI | Count tokens in a prompt and estimate the API cost across GPT, Claude and Gemini models. |
| [robots.txt & llms.txt Generator](https://devmicrotools.com/robots-txt-generator/) | AI | Allow or block AI crawlers by name and generate a matching robots.txt and llms.txt. |
| [User-Agent Parser](https://devmicrotools.com/user-agent-parser/) | Web & Network | Parse a User-Agent string into browser, OS, rendering engine and device type. |
| [Cron Expression Explainer](https://devmicrotools.com/cron-expression-explainer/) | Web & Network | Explain a cron expression in plain English and see its next run times. |
| [CIDR / Subnet Calculator](https://devmicrotools.com/cidr-subnet-calculator/) | Web & Network | Calculate network address, broadcast address, host range and mask from a CIDR block. |
| [URL Parser](https://devmicrotools.com/url-parser/) | Web & Network | Decompose a URL into its parts and edit its query parameters live. |
| [Bundle Size Checker](https://devmicrotools.com/bundle-size-checker/) | Web & Network | Check an npm package's real minified + gzipped size, or check every dependency in a package.json at once. |
| [Browser Fingerprint Inspector](https://devmicrotools.com/browser-fingerprint-inspector/) | Web & Network | See what your browser's JavaScript reveals (fonts, canvas/WebGL, permissions, timezone) and what the server already saw on the request (IP, geo, headers). |
| [ASCII, Unicode & Keycode Inspector](https://devmicrotools.com/ascii-unicode-keycode-inspector/) | Web & Network | Look up any ASCII or Unicode character by code, hex, or name, and inspect a live keyboard event's key, code, keyCode and modifiers as you press it. |
| [Image ↔ Base64 Converter](https://devmicrotools.com/image-base64-converter/) | Images | Convert an image to base64 for inlining in CSS/HTML, or decode base64 back into an image. |
| [Image Compressor](https://devmicrotools.com/image-compressor/) | Images | Compress JPEG, PNG, or WebP images in your browser — batch multiple files, compare before/after, download as a zip. |
| [SVG Optimizer](https://devmicrotools.com/svg-optimizer/) | Images | Strip comments, metadata, and editor cruft from SVG markup — tune precision, compare before/after, download. |
| [Image Cropper](https://devmicrotools.com/image-cropper/) | Images | Crop an image to a selected area and resize it to exact pixel dimensions, right in your browser. |
| [Image Format Converter](https://devmicrotools.com/image-format-converter/) | Images | Convert one or many images between PNG, JPEG, WebP, BMP and ICO — including SVG rasterization — right in your browser. |
| [Favicon Generator](https://devmicrotools.com/favicon-generator/) | Images | Generate favicon.ico, every standard PNG size, apple-touch-icon, Android/PWA icons and a web manifest — plus the HTML snippet — from one uploaded image. |
| [CSS Gradient Generator](https://devmicrotools.com/css-gradient-generator/) | CSS | Build linear, radial and conic gradients visually and copy the CSS. |
| [CSS Box-Shadow Generator](https://devmicrotools.com/css-box-shadow-generator/) | CSS | Build single or layered box-shadows visually and copy the CSS. |

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
    llms.txt.ts              # /llms.txt, generated from the content collection
public/                      # robots.txt (AI crawler policy), ads.txt, favicon
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
