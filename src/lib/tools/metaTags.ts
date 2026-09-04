import { type ToolResult, ok, err } from './result';

export type OgType = 'website' | 'article' | 'product' | 'profile';

export const OG_TYPES: readonly { value: OgType; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'article', label: 'Article / blog post' },
  { value: 'product', label: 'Product' },
  { value: 'profile', label: 'Profile' },
];

export type TwitterCard = 'summary' | 'summary_large_image';

export type RobotsIndex = 'index' | 'noindex';
export type RobotsFollow = 'follow' | 'nofollow';

export interface MetaTagOptions {
  title: string;
  description: string;
  /** Absolute URL of the page itself. Drives `<link rel="canonical">` and `og:url`. */
  canonicalUrl: string;
  siteName: string;
  /** Absolute URL — crawlers that build a social preview do not resolve relative image paths. */
  imageUrl: string;
  imageAlt: string;
  ogType: OgType;
  /** e.g. `en_US`. Blank omits `og:locale` entirely. */
  locale: string;
  twitterCard: TwitterCard;
  /** `@`-handle of the site's own Twitter/X account. */
  twitterSite: string;
  /** `@`-handle of the content's author, when different from the site account. */
  twitterCreator: string;
  /** Hex color, e.g. `#0ea5e9`. Blank omits the tag. */
  themeColor: string;
  robotsIndex: RobotsIndex;
  robotsFollow: RobotsFollow;
}

export const DEFAULT_META_TAG_OPTIONS: MetaTagOptions = {
  title: '',
  description: '',
  canonicalUrl: '',
  siteName: '',
  imageUrl: '',
  imageAlt: '',
  ogType: 'website',
  locale: 'en_US',
  twitterCard: 'summary_large_image',
  twitterSite: '',
  twitterCreator: '',
  themeColor: '',
  robotsIndex: 'index',
  robotsFollow: 'follow',
};

/** Google truncates a search-result title around here; kept as a named constant since
 *  both the warning text and the search-preview UI need the same number. */
export const RECOMMENDED_TITLE_MAX = 60;
/** Same idea for the snippet Google shows under the title. */
export const RECOMMENDED_DESCRIPTION_MAX = 160;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Adds a leading `@` if the user typed a bare handle — the one normalisation worth doing
 *  silently, since every X/Twitter handle is unusable without it and typing it by hand is
 *  the single most common thing to forget. */
function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed === '' || trimmed.startsWith('@')) return trimmed;
  return `@${trimmed}`;
}

function validateAbsoluteUrl(value: string, label: string): ToolResult<string> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return err(`${label} "${value}" is not a full URL — include the scheme, e.g. https://example.com/page.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return err(`${label} must be an http:// or https:// address.`);
  }
  return ok(value);
}

export interface MetaTagsResult {
  html: string;
  warnings: string[];
}

/**
 * Builds the `<head>` block of SEO, Open Graph and Twitter Card meta tags for a page.
 *
 * Pure string assembly, same shape as the other file-generator tools on this site: hard
 * failures are reserved for input that is actually malformed (an invalid URL, a bad hex
 * color); a missing-but-recommended field — no image, no canonical URL — still produces a
 * usable result, just with a warning explaining what a crawler will do without it.
 */
export function buildMetaTags(options: MetaTagOptions): ToolResult<MetaTagsResult> {
  const title = options.title.trim();
  const description = options.description.trim();
  if (title === '') return err('Enter a page title to generate meta tags.');

  const canonicalUrl = options.canonicalUrl.trim();
  if (canonicalUrl !== '') {
    const result = validateAbsoluteUrl(canonicalUrl, 'The canonical URL');
    if (!result.ok) return result;
  }

  const imageUrl = options.imageUrl.trim();
  if (imageUrl !== '') {
    const result = validateAbsoluteUrl(imageUrl, 'The image URL');
    if (!result.ok) return result;
  }

  const themeColor = options.themeColor.trim();
  if (themeColor !== '' && !HEX_COLOR.test(themeColor)) {
    return err(`"${themeColor}" is not a hex color — use a format like #0ea5e9 or #333.`);
  }

  const twitterSite = normalizeHandle(options.twitterSite);
  const twitterCreator = normalizeHandle(options.twitterCreator);
  for (const [label, handle] of [
    ['Twitter/X site handle', twitterSite],
    ['Twitter/X creator handle', twitterCreator],
  ] as const) {
    if (handle !== '' && /\s/.test(handle)) {
      return err(`${label} "${handle}" contains a space — a handle is a single word, e.g. @example.`);
    }
  }

  const siteName = options.siteName.trim();
  const imageAlt = options.imageAlt.trim();
  const locale = options.locale.trim();

  const lines: string[] = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
  ];
  if (canonicalUrl !== '') lines.push(`<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`);
  lines.push(`<meta name="robots" content="${options.robotsIndex}, ${options.robotsFollow}" />`);
  if (themeColor !== '') lines.push(`<meta name="theme-color" content="${escapeAttr(themeColor)}" />`);

  const og: string[] = [
    `<meta property="og:type" content="${options.ogType}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
  ];
  if (canonicalUrl !== '') og.push(`<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`);
  if (siteName !== '') og.push(`<meta property="og:site_name" content="${escapeAttr(siteName)}" />`);
  if (imageUrl !== '') {
    og.push(`<meta property="og:image" content="${escapeAttr(imageUrl)}" />`);
    if (imageAlt !== '') og.push(`<meta property="og:image:alt" content="${escapeAttr(imageAlt)}" />`);
  }
  if (locale !== '') og.push(`<meta property="og:locale" content="${escapeAttr(locale)}" />`);

  const twitter: string[] = [
    `<meta name="twitter:card" content="${options.twitterCard}" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
  ];
  if (imageUrl !== '') twitter.push(`<meta name="twitter:image" content="${escapeAttr(imageUrl)}" />`);
  if (twitterSite !== '') twitter.push(`<meta name="twitter:site" content="${escapeAttr(twitterSite)}" />`);
  if (twitterCreator !== '') twitter.push(`<meta name="twitter:creator" content="${escapeAttr(twitterCreator)}" />`);

  const html = [lines.join('\n'), ['<!-- Open Graph -->', ...og].join('\n'), ['<!-- Twitter Card -->', ...twitter].join('\n')].join(
    '\n\n'
  );

  // ---------------------------------------------------------------------- warnings
  const warnings: string[] = [];

  if (description === '') {
    warnings.push('No meta description — search engines will pick their own snippet from the page text instead.');
  } else if (description.length > RECOMMENDED_DESCRIPTION_MAX) {
    warnings.push(
      `The description is ${description.length} characters — Google typically truncates around ${RECOMMENDED_DESCRIPTION_MAX}.`
    );
  }

  if (title.length > RECOMMENDED_TITLE_MAX) {
    warnings.push(`The title is ${title.length} characters — search results and social cards typically truncate around ${RECOMMENDED_TITLE_MAX}.`);
  }

  if (canonicalUrl === '') {
    warnings.push('No canonical URL — og:url is omitted, and search engines are left to guess the preferred address for this page.');
  }

  if (imageUrl === '') {
    warnings.push('No image — link previews on social platforms and chat apps will show no thumbnail at all.');
  } else if (options.twitterCard === 'summary_large_image' && imageAlt === '') {
    warnings.push('No image alt text — screen readers on platforms that read og:image:alt will have nothing to announce for the image.');
  }

  if (options.robotsIndex === 'noindex') {
    warnings.push('robots is set to "noindex" — this page will be excluded from search results entirely.');
  }

  return ok({ html, warnings });
}

/**
 * The "example.com › blog › post" breadcrumb Google shows above a search-result title,
 * derived from the canonical URL. Returns '' for a blank or unparsable URL, so the preview
 * component can fall back to its own placeholder without checking validity itself.
 */
export function formatSearchBreadcrumb(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  return [parsed.hostname, ...segments].join(' › ');
}

/** Clips text to `max` characters for a search/card preview, matching how a real crawler's
 *  UI truncates — not the generated meta tags themselves, which are never cut. */
export function truncateForPreview(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Per-em advance widths for common ASCII printable characters, taken from the standard
 * Arial/Helvetica core-font metrics (per 1000 units of em) used throughout typography and PDF
 * tooling. Google actually truncates a search-result title and snippet by rendered pixel
 * width, not character count — a title full of capital letters or 'M'/'W' fills the same
 * space as a noticeably longer one full of 'i'/'l' and spaces. This table lets the preview
 * approximate that instead of a flat cutoff. Anything outside the table (accented Latin, CJK,
 * emoji, symbols) falls back to `AVERAGE_CHAR_WIDTH_EM`.
 */
const ARIAL_CHAR_WIDTH_EM: Record<string, number> = {
  ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, $: 0.556, '%': 0.889, '&': 0.667, "'": 0.191,
  '(': 0.333, ')': 0.333, '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333, '.': 0.278, '/': 0.278,
  '0': 0.556, '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556, '5': 0.556, '6': 0.556, '7': 0.556,
  '8': 0.556, '9': 0.556, ':': 0.278, ';': 0.278, '<': 0.584, '=': 0.584, '>': 0.584, '?': 0.556,
  '@': 1.015,
  A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278,
  J: 0.5, K: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722,
  S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
  '[': 0.278, '\\': 0.278, ']': 0.278, '^': 0.469, _: 0.556, '`': 0.333,
  a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556, h: 0.556, i: 0.222,
  j: 0.222, k: 0.5, l: 0.222, m: 0.833, n: 0.556, o: 0.556, p: 0.556, q: 0.556, r: 0.333,
  s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5, y: 0.5, z: 0.5,
  '{': 0.334, '|': 0.26, '}': 0.334, '~': 0.584,
};
const AVERAGE_CHAR_WIDTH_EM = 0.6;

function textWidthPx(text: string, fontSizePx: number): number {
  let widthEm = 0;
  for (const char of text) widthEm += ARIAL_CHAR_WIDTH_EM[char] ?? AVERAGE_CHAR_WIDTH_EM;
  return widthEm * fontSizePx;
}

/** Approximate desktop SERP rendering size and container width for a search-result title. */
export const SERP_TITLE_FONT_PX = 20;
export const SERP_TITLE_MAX_WIDTH_PX = 600;
/** Same idea for the snippet, sized for roughly two wrapped lines. */
export const SERP_DESCRIPTION_FONT_PX = 14;
export const SERP_DESCRIPTION_MAX_WIDTH_PX = 1200;

/**
 * Truncates `text` to fit inside a fixed-pixel-width container at `fontSizePx`, the way a
 * search result actually clips a title or snippet, rather than a flat character-count cutoff.
 * An approximation, not a guarantee: Google doesn't publish its rendering font, exact
 * container width, or a fixed line count, and real rendering varies by device — but it's
 * closer to reality than counting characters, since a capital 'M' and a lowercase 'i' don't
 * take up anywhere near the same space.
 */
export function truncateByPixelWidth(text: string, maxWidthPx: number, fontSizePx: number): string {
  if (textWidthPx(text, fontSizePx) <= maxWidthPx) return text;

  const ellipsisWidthPx = textWidthPx('…', fontSizePx);
  let result = '';
  let widthPx = 0;
  for (const char of text) {
    const charWidthPx = (ARIAL_CHAR_WIDTH_EM[char] ?? AVERAGE_CHAR_WIDTH_EM) * fontSizePx;
    if (widthPx + charWidthPx + ellipsisWidthPx > maxWidthPx) break;
    result += char;
    widthPx += charWidthPx;
  }
  return `${result.trimEnd()}…`;
}
