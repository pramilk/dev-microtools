/**
 * Site-wide constants. Single source of truth for anything that appears in
 * metadata, structured data, or the page chrome.
 */

export const SITE = {
  /** Update alongside `site` in astro.config.mjs when the real domain is registered. */
  url: 'https://example.com',
  name: 'DevMicroTools',
  tagline: 'Fast developer tools that run entirely in your browser',
  description:
    'A collection of free developer utilities — JSON formatter, regex tester, base64, JWT, hashing and more. Everything runs locally in your browser; nothing you paste is ever uploaded.',
  locale: 'en_US',
  /** Filled in after AdSense approval. Ads stay disabled while this is null. */
  adsensePublisherId: null as string | null,
  /** Filled in from the Cloudflare dashboard. Analytics stays disabled while null. */
  cloudflareAnalyticsToken: null as string | null,
} as const;

export const NAV_LINKS = [
  { href: '/', label: 'Tools' },
  { href: '/about/', label: 'About' },
] as const;
