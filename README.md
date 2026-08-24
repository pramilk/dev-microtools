# DevMicroTools

[devmicrotools.com](https://devmicrotools.com) — free developer utilities (JSON formatter,
regex tester, Base64, JWT decoder, hashing, diff checker, QR codes, and more) that run
entirely in your browser.

There is no backend. Every tool is client-side JavaScript — nothing you paste into a tool
is ever transmitted anywhere. You can verify this yourself: open DevTools → Network while
using any tool and you'll see no outbound request carrying your input.

## Tools

| Tool | Category | Description |
|---|---|---|
| [Diff Checker](https://devmicrotools.com/diff-checker/) | Compare | Compare two texts or JSON documents and see exactly what changed. |
| [Timestamp Converter](https://devmicrotools.com/timestamp-converter/) | Convert | Convert Unix epoch timestamps to dates and back, with a live current time. |
| [Color Converter](https://devmicrotools.com/color-converter/) | Convert | Convert between HEX, RGB, HSL and OKLCH, with WCAG contrast checking. |
| [JSON, YAML & CSV Converter](https://devmicrotools.com/data-format-converter/) | Convert | Convert data between JSON, YAML and CSV in either direction. |
| [Base64 Encoder](https://devmicrotools.com/base64-encode-decode/) | Encode | Encode and decode Base64, including URL-safe variants and full Unicode. |
| [URL Encoder & Decoder](https://devmicrotools.com/url-encode-decode/) | Encode | Percent-encode or decode URLs, and break one down into its parts. |
| [Base32 Encoder](https://devmicrotools.com/base32-encode-decode/) | Encode | Encode and decode standard Base32, with optional padding for TOTP secrets and other tokens. |
| [Base58 Encoder](https://devmicrotools.com/base58-encode-decode/) | Encode | Encode and decode Base58 — the alphabet behind Bitcoin addresses and IPFS CIDs. |
| [JSON Formatter](https://devmicrotools.com/json-formatter/) | Format | Beautify, minify, validate and repair broken JSON entirely in your browser. |
| [SQL Formatter](https://devmicrotools.com/sql-formatter/) | Format | Beautify a SQL query with consistent indentation and keyword casing. |
| [HTML / CSS / JS Minifier](https://devmicrotools.com/html-css-js-minifier/) | Format | Shrink HTML, CSS or JavaScript by stripping comments and unnecessary whitespace. |
| [XML Formatter](https://devmicrotools.com/xml-formatter/) | Format | Pretty-print, minify, validate, or convert XML to JSON — all in the browser. |
| [UUID Generator](https://devmicrotools.com/uuid-generator/) | Generate | Generate v4 or time-ordered v7 UUIDs in bulk, and inspect existing ones. |
| [Hash Generator](https://devmicrotools.com/hash-generator/) | Generate | Compute MD5, SHA-1 and SHA-2 digests, and verify a checksum against them. |
| [Password Generator](https://devmicrotools.com/password-generator/) | Generate | Create strong random passwords with adjustable length and character types. |
| [QR Code Generator](https://devmicrotools.com/qr-code-generator/) | Generate | Turn text or a URL into a scannable QR code — download as PNG or SVG. |
| [Fake Data Generator](https://devmicrotools.com/fake-data-generator/) | Generate | Generate realistic fake names, emails, addresses and more as JSON or CSV. |
| [Bcrypt Generator](https://devmicrotools.com/bcrypt-generator/) | Generate | Generate a bcrypt hash from a password, or verify a password against one. |
| [cURL Command Builder](https://devmicrotools.com/curl-command-builder/) | Generate | Turn a method, URL, headers, body and auth into a correctly-escaped curl command. |
| [Image ↔ Base64 Converter](https://devmicrotools.com/image-base64-converter/) | Images | Convert an image to base64 for inlining in CSS/HTML, or decode base64 back into an image. |
| [Image Compressor](https://devmicrotools.com/image-compressor/) | Images | Compress JPEG, PNG, or WebP images in your browser — batch multiple files, compare before/after, download as a zip. |
| [SVG Optimizer](https://devmicrotools.com/svg-optimizer/) | Images | Strip comments, metadata, and editor cruft from SVG markup — tune precision, compare before/after, download. |
| [Image Cropper](https://devmicrotools.com/image-cropper/) | Images | Crop an image to a selected area and resize it to exact pixel dimensions, right in your browser. |
| [Image Format Converter](https://devmicrotools.com/image-format-converter/) | Images | Convert one or many images between PNG, JPEG, WebP, BMP and ICO — including SVG rasterization — right in your browser. |
| [Regex Tester](https://devmicrotools.com/regex-tester/) | Inspect | Test regular expressions with live highlighting, groups and replace preview. |
| [JWT Debugger](https://devmicrotools.com/jwt-decoder/) | Inspect | Decode, verify and sign JSON Web Tokens without uploading them anywhere. |
| [User-Agent Parser](https://devmicrotools.com/user-agent-parser/) | Inspect | Parse a User-Agent string into browser, OS, rendering engine and device type. |
| [Cron Expression Explainer](https://devmicrotools.com/cron-expression-explainer/) | Inspect | Explain a cron expression in plain English and see its next run times. |
| [CIDR / Subnet Calculator](https://devmicrotools.com/cidr-subnet-calculator/) | Inspect | Calculate network address, broadcast address, host range and mask from a CIDR block. |
| [URL Parser](https://devmicrotools.com/url-parser/) | Inspect | Decompose a URL into its parts and edit its query parameters live. |
| [CSS Gradient Generator](https://devmicrotools.com/css-gradient-generator/) | Style | Build linear, radial and conic gradients visually and copy the CSS. |
| [CSS Box-Shadow Generator](https://devmicrotools.com/css-box-shadow-generator/) | Style | Build single or layered box-shadows visually and copy the CSS. |

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
