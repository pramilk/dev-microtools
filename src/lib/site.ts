/**
 * Site-wide constants. Single source of truth for anything that appears in
 * metadata, structured data, or the page chrome.
 */

export const SITE = {
  url: 'https://devmicrotools.com',
  name: 'DevMicroTools',
  tagline: 'Fast developer tools that run entirely in your browser',
  description:
    'Free developer utilities: JSON formatter, regex tester, Base64, JWT, hashing, diff checker and more — all running in your browser. Nothing is ever uploaded.',
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
