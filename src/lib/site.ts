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
  repoUrl: 'https://github.com/pramilk/dev-microtools',
  /** Buy Me a Coffee page. Set to null to hide both the footer link and the in-page CTA. */
  buyMeACoffeeUrl: 'https://buymeacoffee.com/xqzdksauy8' as string | null,
  /** GitHub icon in the header and "Source on GitHub" link in the footer. Set to false to
   *  hide both. (repoUrl is still used by the About page, llms.txt and JSON-LD.) */
  githubLinkEnabled: true as boolean,
  /** Feedback nav link and its /feedback/ redirect (to GitHub Issues). Set to false to
   *  turn both off. */
  feedbackEnabled: true as boolean,
  /** Filled in after AdSense approval. Ads stay disabled while this is null. */
  adsensePublisherId: null as string | null,
  /** Filled in from the Cloudflare dashboard. Analytics stays disabled while null. */
  cloudflareAnalyticsToken: null as string | null,
} as const;

export const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: '/', label: 'Tools' },
  { href: '/about/', label: 'About' },
  ...(SITE.feedbackEnabled ? [{ href: '/feedback/', label: 'Feedback' }] : []),
];
