/**
 * Turns the raw browser signals a page can read (via `navigator`, `screen`, `Intl`,
 * canvas rendering, and WebGL) into a structured, human-readable report, and provides
 * the pure algorithms behind two of those signals: font detection (comparing measured
 * text widths, which the island collects via canvas) and the canvas-fingerprint hash.
 *
 * Every value here is exactly what any website's own JavaScript can already read from a
 * visitor without asking permission — this tool doesn't expose anything new, it just
 * shows it back to you in one place instead of leaving it invisible.
 */

import { type ToolResult, ok, err, messageFrom } from './result';

export type FingerprintCategoryId =
  | 'network'
  | 'identity'
  | 'display'
  | 'locale'
  | 'privacy'
  | 'permissions'
  | 'rendering'
  | 'fonts';

/** Actionable remediation for a row whose current value is worth doing something about. */
export interface FingerprintWarning {
  message: string;
  steps: string[];
}

export interface FingerprintRow {
  label: string;
  value: string;
  /** Why this signal matters for fingerprinting or privacy — shown as a hover tooltip. */
  hint: string;
  /** Present only when this row's current value is something a visitor could act on. */
  warning?: FingerprintWarning;
  /**
   * Present only when the displayed value is known to sometimes be stale, normalized,
   * or otherwise not a faithful read of reality (e.g. capped by the browser for privacy,
   * or reflecting a VPN rather than the real network) — informational, not something to
   * act on the way `warning` is.
   */
  caveat?: string;
}

export interface FingerprintCategory {
  id: FingerprintCategoryId;
  label: string;
  rows: FingerprintRow[];
}

export interface RawSignals {
  userAgent: string;
  platform: string;
  language: string;
  languages: readonly string[];
  cookieEnabled: boolean;
  doNotTrack: string | null;
  globalPrivacyControl: boolean | null;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  timeZone: string;
  /** Raw `Date.prototype.getTimezoneOffset()` value — minutes *behind* UTC, sign inverted from common notation. */
  timezoneOffsetMinutes: number;
  localStorageAvailable: boolean;
  sessionStorageAvailable: boolean;
  indexedDbAvailable: boolean;
  webglVendor: string | null;
  webglRenderer: string | null;
  webglUnmaskedVendor: string | null;
  webglUnmaskedRenderer: string | null;
  /** SHA-256 hex digest of the rendered canvas fingerprint, or null while still computing. */
  canvasHash: string | null;
  /** `navigator.plugins` names. Modern Chrome/Firefox report the same fixed generic list for everyone. */
  pluginNames: readonly string[];
  /** Whether `navigator.getBattery` exists at all — a synchronous feature check, unlike the two fields below. */
  batterySupported: boolean;
  /** 0-1 fraction; null while the battery promise is still pending (only meaningful when `batterySupported`). */
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  /** Whether a bait element styled like a typical ad slot got hidden — null while still checking. */
  adBlockerDetected: boolean | null;
  permissions: PermissionSignals;
  /** From `navigator.connection` (Chromium only) — estimated, not measured live. */
  connectionType: string | null;
  connectionDownlinkMbps: number | null;
  connectionRttMs: number | null;
  connectionSaveData: boolean | null;
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** Each value is null while still being queried — see `describePermission`. */
export interface PermissionSignals {
  geolocation: PermissionState | null;
  camera: PermissionState | null;
  microphone: PermissionState | null;
  notifications: PermissionState | null;
}

/**
 * What the *server* sees on the request that loaded this page — distinct from
 * `RawSignals`, which is everything the browser's own JavaScript can read after the
 * page has loaded. No extra request is made to collect this: it rides along in the
 * same request that fetched the page, injected into the HTML by a Cloudflare Worker
 * before the response reaches the browser (see `src/worker/`). It is `null` wherever
 * that Worker doesn't run — local development, the test build, `astro preview`.
 */
export interface ServerSignals {
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  continent: string | null;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
  colo: string | null;
  asn: number | null;
  asOrganization: string | null;
  httpProtocol: string | null;
  tlsVersion: string | null;
  tlsCipher: string | null;
  cookiesSent: boolean;
  /** Lowercase header name -> raw value, limited to a fixed allowlist — see `src/worker/serverSignals.ts`. */
  headers: Record<string, string>;
}

// --------------------------------------------------------------------- value formatting

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export function describeDoNotTrack(raw: string | null): string {
  if (raw === '1' || raw === 'yes') return 'Enabled';
  if (raw === '0' || raw === 'no') return 'Disabled';
  return 'Not set by this browser';
}

export function describeGlobalPrivacyControl(raw: boolean | null): string {
  if (raw === true) return 'Signaled (requests opt-out of sale/sharing)';
  if (raw === false) return 'Not signaled';
  return 'Not supported by this browser';
}

export function describeHardwareConcurrency(cores: number | null): string {
  return cores === null ? 'Not reported by this browser' : `${cores} logical core${cores === 1 ? '' : 's'}`;
}

export function describeDeviceMemory(gb: number | null): string {
  return gb === null ? 'Not reported (Chromium-only API)' : `~${gb} GB (rounded, capped at 8 by the browser)`;
}

export function describeTouchSupport(maxTouchPoints: number): string {
  return maxTouchPoints > 0 ? `Yes (up to ${maxTouchPoints} simultaneous points)` : 'No';
}

/**
 * Converts `Date.prototype.getTimezoneOffset()` (minutes *behind* UTC, so UTC+5:30
 * reports -330) into the conventional "UTC+05:30" notation.
 */
export function formatUtcOffset(offsetMinutes: number): string {
  const totalMinutes = -offsetMinutes;
  const sign = totalMinutes === 0 ? '±' : totalMinutes > 0 ? '+' : '-';
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60).toString().padStart(2, '0');
  const minutes = (abs % 60).toString().padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

function describeStorage(available: boolean): string {
  return available ? 'Available' : 'Blocked (private browsing or a site setting)';
}

function describeWebglField(value: string | null): string {
  return value ?? 'Not exposed by this browser';
}

/**
 * Cross-checks the browser's own `Intl` timezone against Cloudflare's IP-derived one
 * (when available) — a mismatch is exactly the signal VPN/proxy-detection tools look
 * for, so it's worth surfacing even though it's informational rather than actionable
 * (unlike the mismatch, it's often simply an accurate override, or that the IP-based
 * guess and the real location differ because you've travelled since the IP was assigned
 * to your network).
 */
function timezoneCaveat(browserTimeZone: string, serverTimeZone: string | null): string {
  if (browserTimeZone && serverTimeZone) {
    return browserTimeZone === serverTimeZone
      ? `Matches the IP-based timezone from your network request (${serverTimeZone}).`
      : `Doesn’t match the IP-based timezone from your network request (${serverTimeZone}) — could mean a VPN/proxy, a manually changed clock, or that your IP’s registered location is stale.`;
  }
  // Not "we can't tell" in general — Cloudflare derives serverTimeZone from the same
  // kind of IP-geolocation lookup a reverse-IP/GeoIP service would, so the comparison
  // above does run on the real deployment. This fallback only fires where there's no
  // live request to derive it from at all (local dev, preview, a cached page).
  return 'No IP-based timezone to compare against in this environment — that check only runs on the real deployment (see "Network request" below). Tor Browser and similar tools also deliberately force this value to UTC regardless of your real timezone.';
}

export function describeConnection(
  type: string | null,
  downlinkMbps: number | null,
  rttMs: number | null,
  saveData: boolean | null
): string {
  if (type === null && downlinkMbps === null && rttMs === null) {
    return 'Not supported by this browser (Chromium only)';
  }
  const parts: string[] = [];
  if (type !== null) parts.push(type);
  if (downlinkMbps !== null) parts.push(`~${downlinkMbps} Mbps`);
  if (rttMs !== null) parts.push(`~${rttMs}ms RTT`);
  if (saveData) parts.push('Data Saver on');
  return parts.length > 0 ? parts.join(' · ') : 'Not reported';
}

export function describePlugins(names: readonly string[]): string {
  return names.length > 0 ? `${names.length}: ${names.join(', ')}` : 'None reported';
}

export function describeBattery(supported: boolean, level: number | null, charging: boolean | null): string {
  if (!supported) {
    return 'Not supported by this browser (removed from Firefox and Safari after research showed it was a meaningful tracking signal)';
  }
  if (level === null) return 'Computing…';
  return `${Math.round(level * 100)}%, ${charging ? 'charging' : 'not charging'}`;
}

export function describeAdBlocker(detected: boolean | null): string {
  if (detected === null) return 'Checking…';
  return detected ? 'Detected' : 'Not detected';
}

function adBlockerWarning(detected: boolean | null): FingerprintWarning | undefined {
  if (detected !== false) return undefined;
  return {
    message: 'No ad blocker was detected — you also lose the tracker-blocking most ad blockers bundle in by default.',
    steps: [
      'Install a reputable content blocker, such as uBlock Origin, from your browser’s official extension store.',
      'Keep its default filter lists enabled — most bundle tracker- and ad-blocking rules together.',
      'Reload this page and press "Rescan" to confirm it’s now detected.',
    ],
  };
}

function globalPrivacyControlWarning(signaled: boolean | null): FingerprintWarning | undefined {
  if (signaled !== false) return undefined;
  return {
    message: 'Your browser isn’t sending a Global Privacy Control signal, which several U.S. state privacy laws treat as a binding opt-out request.',
    steps: [
      'Firefox: turn it on in Settings → Privacy & Security → "Tell websites not to sell or share my data".',
      'Chrome, Edge, Safari: install a GPC-supporting extension such as Privacy Badger or DuckDuckGo Privacy Essentials.',
      'Reload this page and check this row again to confirm the signal is now sent.',
    ],
  };
}

function unmaskedWebglWarning(renderer: string | null): FingerprintWarning | undefined {
  if (renderer === null) return undefined;
  return {
    message: 'Your real GPU model is exposed to this — and every — site, one of the more identifying single signals a fingerprint can use.',
    steps: [
      'Firefox: set privacy.resistFingerprinting to true in about:config, or use a hardened profile like Tor Browser’s.',
      'Brave: set fingerprinting protection to "Strict" in Settings → Shields.',
      'For sessions where this matters most, use Tor Browser instead.',
    ],
  };
}

const PERMISSION_WARNING_MESSAGE: Record<keyof PermissionSignals, string> = {
  geolocation: 'This site currently has permission to access your location — worth checking if you expected to grant that.',
  camera: 'This site currently has permission to access your camera — worth checking if you expected to grant that.',
  microphone: 'This site currently has permission to access your microphone — worth checking if you expected to grant that.',
  notifications: 'This site currently has permission to show you notifications — worth checking if you expected to grant that.',
};

const PERMISSION_SETTINGS_LABEL: Record<keyof PermissionSignals, string> = {
  geolocation: 'Location',
  camera: 'Camera',
  microphone: 'Microphone',
  notifications: 'Notifications',
};

function permissionWarning(name: keyof PermissionSignals, state: PermissionState | null): FingerprintWarning | undefined {
  if (state !== 'granted') return undefined;
  return {
    message: PERMISSION_WARNING_MESSAGE[name],
    steps: [
      'Click the padlock or site-info icon in your browser’s address bar.',
      `Find "${PERMISSION_SETTINGS_LABEL[name]}" in the site permissions list.`,
      'Set it to "Ask" or "Block" if you don’t recall granting it, then reload the page.',
    ],
  };
}

export function describePermission(state: PermissionState | null): string {
  switch (state) {
    case null:
      return 'Checking…';
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'prompt':
      return 'Not yet asked (would prompt)';
    case 'unsupported':
      return 'Not supported by this browser';
  }
}

// ------------------------------------------------------------------------- report build

const NETWORK_HEADER_LABELS: Record<string, string> = {
  'user-agent': 'User-Agent',
  accept: 'Accept',
  'accept-language': 'Accept-Language',
  'accept-encoding': 'Accept-Encoding',
  referer: 'Referer',
  dnt: 'DNT',
  'sec-ch-ua': 'Sec-CH-UA',
  'sec-ch-ua-mobile': 'Sec-CH-UA-Mobile',
  'sec-ch-ua-platform': 'Sec-CH-UA-Platform',
  'sec-fetch-site': 'Sec-Fetch-Site',
  'sec-fetch-mode': 'Sec-Fetch-Mode',
  'sec-fetch-dest': 'Sec-Fetch-Dest',
  'sec-fetch-user': 'Sec-Fetch-User',
  'upgrade-insecure-requests': 'Upgrade-Insecure-Requests',
};

/**
 * Builds the "Network request" category — what the server saw on the request that
 * fetched this page, before a single line of the page's own JavaScript ran. `server` is
 * `null` wherever the injecting Worker doesn't run (local dev, the test build, a page
 * served from cache), in which case this renders one row explaining why, rather than an
 * empty or misleadingly absent category.
 */
export function buildNetworkCategory(server: ServerSignals | null): FingerprintCategory {
  if (!server) {
    return {
      id: 'network',
      label: 'Network request',
      rows: [
        {
          label: 'Status',
          value: 'Not available in this environment',
          hint: 'This category is injected by a Cloudflare Worker on the live deployment. It has nothing to inject here — local development, the test build, and a page served from cache never reach that Worker.',
        },
      ],
    };
  }

  const location = [server.city, server.region, server.country].filter((part): part is string => Boolean(part)).join(', ');
  const connection = [server.httpProtocol, server.tlsVersion].filter((part): part is string => Boolean(part)).join(' over ');

  const rows: FingerprintRow[] = [
    { label: 'IP address', value: server.ip ?? 'Not reported', hint: 'Every request carries this — it is how the response finds its way back to you, and how every field below is derived.' },
    { label: 'Approximate location', value: location || 'Not reported', hint: 'Derived from your IP address by Cloudflare’s edge network, not GPS — typically accurate to city level, sometimes less.' },
    { label: 'Coordinates', value: server.latitude && server.longitude ? `${server.latitude}, ${server.longitude}` : 'Not reported', hint: 'Approximate latitude/longitude for the location above.' },
    { label: 'Postal code', value: server.postalCode ?? 'Not reported', hint: 'From the same IP-based lookup as the location above.' },
    { label: 'Timezone', value: server.timezone ?? 'Not reported', hint: 'The IANA timezone Cloudflare associates with your IP address — compare this with the browser-reported one below.' },
    {
      label: 'ISP / organization',
      value: server.asOrganization ?? 'Not reported',
      hint: 'The network operator your IP address is registered to — usually your ISP, employer, or VPN/proxy provider.',
      caveat: 'Behind a VPN or proxy, this is their network, not your real one.',
    },
    { label: 'ASN', value: server.asn !== null ? `AS${server.asn}` : 'Not reported', hint: 'The autonomous system number identifying the network your IP belongs to.' },
    { label: 'Connection', value: connection || 'Not reported', hint: 'The HTTP and TLS versions your browser negotiated for this request.' },
    { label: 'Cookies sent', value: server.cookiesSent ? 'Yes' : 'No', hint: 'Whether your browser sent a Cookie header with this request.' },
    ...Object.entries(server.headers).map(([name, value]) => ({
      label: NETWORK_HEADER_LABELS[name] ?? name,
      value,
      hint: 'An HTTP header your browser sent with this request — visible to this site and to every network hop between you and it.',
    })),
  ];

  return { id: 'network', label: 'Network request', rows };
}

export type FingerprintSectionId = 'browser' | 'server';

export interface FingerprintSection {
  id: FingerprintSectionId;
  label: string;
  /** One-line explanation of this section's provenance, shown under its heading. */
  description: string;
  categories: FingerprintCategory[];
}

/**
 * Groups every raw signal into the two sections the UI renders — "Browser" (read by
 * this page's own JavaScript, entirely locally) first, then "Server" (what this site's
 * server already saw on the request that loaded the page) — each holding the categories
 * within it. Every row carries the plain-language explanation shown as its tooltip.
 * `fonts` is passed in separately because font detection has its own pure algorithm
 * below, driven by measurements the island collects via canvas. `server` is optional:
 * `null`/omitted renders the "Network request" category's not-available fallback, for
 * contexts with no injecting Worker (see `buildNetworkCategory`).
 */
export function buildFingerprintReport(
  raw: RawSignals,
  fonts: FontDetectionResult,
  server: ServerSignals | null = null
): FingerprintSection[] {
  const browserCategories: FingerprintCategory[] = [
    {
      id: 'identity',
      label: 'Identity',
      rows: [
        { label: 'User-Agent', value: raw.userAgent, hint: 'Sent with every request; identifies your browser, engine, and OS.' },
        { label: 'Platform', value: raw.platform || 'Not reported', hint: 'The OS family your browser reports itself as running on.' },
        { label: 'Language', value: raw.language, hint: 'Your browser’s primary UI language, sent as part of every request.' },
        { label: 'Languages', value: raw.languages.length > 0 ? raw.languages.join(', ') : 'Not reported', hint: 'Your full ordered language preference list.' },
        { label: 'Cookies enabled', value: yesNo(raw.cookieEnabled), hint: 'Whether this browser accepts cookies at all, readable by any page.' },
      ],
    },
    {
      id: 'display',
      label: 'Display & hardware',
      rows: [
        { label: 'Screen resolution', value: `${raw.screenWidth} × ${raw.screenHeight}`, hint: 'Your monitor’s full resolution, independent of the browser window size.' },
        { label: 'Available screen size', value: `${raw.availWidth} × ${raw.availHeight}`, hint: 'Screen space left after the OS taskbar/dock, another cross-checkable value.' },
        { label: 'Viewport size', value: `${raw.viewportWidth} × ${raw.viewportHeight}`, hint: 'The actual browser window’s content area.' },
        { label: 'Color depth', value: `${raw.colorDepth}-bit`, hint: 'Bits per pixel your display reports supporting.' },
        { label: 'Device pixel ratio', value: `${raw.pixelRatio}×`, hint: 'Physical pixels per CSS pixel — flags high-DPI ("Retina") displays.' },
        {
          label: 'CPU cores',
          value: describeHardwareConcurrency(raw.hardwareConcurrency),
          hint: 'Logical processor count, via navigator.hardwareConcurrency.',
          caveat: 'Safari and Firefox both cap or normalize this in some configurations, so it may understate your real core count.',
        },
        { label: 'Device memory', value: describeDeviceMemory(raw.deviceMemoryGb), hint: 'Approximate RAM, via navigator.deviceMemory (Chromium only).' },
        { label: 'Touch support', value: describeTouchSupport(raw.maxTouchPoints), hint: 'Whether this device reports a touchscreen, and how many points it tracks.' },
        {
          label: 'Browser plugins',
          value: describePlugins(raw.pluginNames),
          hint: 'navigator.plugins.',
          caveat: 'Modern Chrome and Firefox now report the same fixed generic list for every visitor, specifically to close this off as a fingerprinting signal — this may not reflect what you actually have installed.',
        },
        { label: 'Battery', value: describeBattery(raw.batterySupported, raw.batteryLevel, raw.batteryCharging), hint: 'Exact charge level and charging state — Firefox and Safari removed this API entirely after research showed it could re-identify and track visitors across sessions.' },
        {
          label: 'Connection',
          value: describeConnection(raw.connectionType, raw.connectionDownlinkMbps, raw.connectionRttMs, raw.connectionSaveData),
          hint: 'navigator.connection (Chromium only) — an estimate the browser maintains from recent traffic, not a live speed test, and it updates as your connection changes.',
        },
      ],
    },
    {
      id: 'locale',
      label: 'Timezone',
      rows: [
        {
          label: 'Timezone',
          value: raw.timeZone || 'Not reported',
          hint: 'Your IANA timezone name, e.g. "America/New_York" — far more specific than the UTC offset alone.',
          caveat: timezoneCaveat(raw.timeZone, server?.timezone ?? null),
        },
        { label: 'UTC offset', value: formatUtcOffset(raw.timezoneOffsetMinutes), hint: 'Your current offset from UTC, including daylight saving.' },
      ],
    },
    {
      id: 'privacy',
      label: 'Privacy signals',
      rows: [
        { label: 'Do Not Track', value: describeDoNotTrack(raw.doNotTrack), hint: 'A legacy opt-out signal most sites ignore — not legally binding.' },
        {
          label: 'Global Privacy Control',
          value: describeGlobalPrivacyControl(raw.globalPrivacyControl),
          hint: 'A newer opt-out signal that carries legal weight under some US state privacy laws.',
          warning: globalPrivacyControlWarning(raw.globalPrivacyControl),
        },
        { label: 'localStorage', value: describeStorage(raw.localStorageAvailable), hint: 'Persistent per-site storage any page can read and write.' },
        { label: 'sessionStorage', value: describeStorage(raw.sessionStorageAvailable), hint: 'Per-tab storage cleared when the tab closes.' },
        { label: 'IndexedDB', value: describeStorage(raw.indexedDbAvailable), hint: 'A larger structured-storage API, also usable for persistent tracking IDs.' },
        {
          label: 'Ad blocker',
          value: describeAdBlocker(raw.adBlockerDetected),
          hint: 'Detected with the same bait-element technique many sites use to nag you about disabling it — an element named and sized like a typical ad slot, hidden by ad-blocker cosmetic filters. Best-effort: some blockers evade this specific check.',
          warning: adBlockerWarning(raw.adBlockerDetected),
        },
      ],
    },
    {
      id: 'permissions',
      label: 'Permissions',
      rows: [
        {
          label: 'Geolocation',
          value: describePermission(raw.permissions.geolocation),
          hint: 'Whether this site has been granted, denied, or not yet asked for your location. Checking the status never triggers the browser’s permission prompt.',
          warning: permissionWarning('geolocation', raw.permissions.geolocation),
        },
        {
          label: 'Camera',
          value: describePermission(raw.permissions.camera),
          hint: 'Whether this site can access your camera. Checking the status never turns it on or triggers a prompt.',
          warning: permissionWarning('camera', raw.permissions.camera),
        },
        {
          label: 'Microphone',
          value: describePermission(raw.permissions.microphone),
          hint: 'Whether this site can access your microphone. Checking the status never turns it on or triggers a prompt.',
          warning: permissionWarning('microphone', raw.permissions.microphone),
        },
        {
          label: 'Notifications',
          value: describePermission(raw.permissions.notifications),
          hint: 'Whether this site can show system notifications.',
          warning: permissionWarning('notifications', raw.permissions.notifications),
        },
      ],
    },
    {
      id: 'rendering',
      label: 'Rendering fingerprint',
      rows: [
        { label: 'Canvas hash', value: raw.canvasHash ?? 'Computing…', hint: 'A hash of a small image your browser draws — tiny GPU/driver/font differences make this vary between machines, even the same browser version.' },
        { label: 'WebGL vendor', value: describeWebglField(raw.webglVendor), hint: 'The graphics API vendor string — usually just "WebKit" or "Google Inc.", not very identifying alone.' },
        { label: 'WebGL renderer', value: describeWebglField(raw.webglRenderer), hint: 'The graphics API renderer string, paired with the vendor above.' },
        { label: 'Unmasked WebGL vendor', value: describeWebglField(raw.webglUnmaskedVendor), hint: 'The real GPU vendor (e.g. "NVIDIA", "Apple") — far more identifying than the masked value above; some browsers block this by default.' },
        {
          label: 'Unmasked WebGL renderer',
          value: describeWebglField(raw.webglUnmaskedRenderer),
          hint: 'The specific GPU model — one of the most identifying single signals a page can read.',
          warning: unmaskedWebglWarning(raw.webglUnmaskedRenderer),
        },
      ],
    },
    {
      id: 'fonts',
      label: 'Fonts detected',
      rows: [
        {
          label: 'Detected fonts',
          value: fonts.available.length > 0 ? `${fonts.available.length} of ${fonts.available.length + fonts.unavailable.length}: ${fonts.available.join(', ')}` : 'None of the tested fonts were detected',
          hint: 'Which fonts are actually installed varies by OS, region, and installed software — a classic fingerprinting signal.',
        },
      ],
    },
  ];

  return [
    {
      id: 'browser',
      label: 'What your browser reveals',
      description: 'Read by this page’s own JavaScript after it loaded — computed entirely on your device and never sent anywhere.',
      categories: browserCategories,
    },
    {
      id: 'server',
      label: 'What the server already saw',
      description: 'Visible to this site’s server on the very request that loaded the page — before any of the JavaScript above ran. Baked into this page load; reload the page to refresh it — "Rescan" only re-runs the browser-side checks above.',
      categories: [buildNetworkCategory(server)],
    },
  ];
}

function allCategories(sections: readonly FingerprintSection[]): FingerprintCategory[] {
  return sections.flatMap((section) => section.categories);
}

/** Total data points shown, for an honest "here's how much we collected" summary — not a claim about how unique any of it makes you. */
export function countSignals(sections: readonly FingerprintSection[]): number {
  return allCategories(sections).reduce((sum, category) => sum + category.rows.length, 0);
}

/** Flattens the report into a plain-text block for the copy button, grouped by section. */
export function reportToText(sections: readonly FingerprintSection[]): string {
  return sections
    .map((section) =>
      `${section.label}\n${'='.repeat(section.label.length)}\n\n` +
      section.categories
        .map((category) => `${category.label}\n${category.rows.map((row) => `  ${row.label}: ${row.value}`).join('\n')}`)
        .join('\n\n')
    )
    .join('\n\n');
}

// ------------------------------------------------------------------------- font detection

export const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace'] as const;
export type GenericFamily = (typeof GENERIC_FAMILIES)[number];

/** Mix of wide and narrow glyphs, so a substituted font is likely to measure differently. */
export const FONT_TEST_STRING = 'mmmmmmmmmmlli';

/** Common cross-platform, Windows-only, macOS-only, and CJK fonts — install patterns
 *  differ enough by OS and region that the detected set narrows down a visitor's system. */
export const FONT_CANDIDATES = [
  'Arial', 'Arial Black', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact',
  'Times New Roman', 'Georgia', 'Garamond', 'Palatino Linotype', 'Book Antiqua',
  'Courier New', 'Lucida Console', 'Consolas', 'Monaco', 'Menlo',
  'Comic Sans MS', 'Segoe UI', 'Calibri', 'Cambria', 'Candara',
  'Helvetica Neue', 'Century Gothic', 'Franklin Gothic Medium', 'Optima',
  'Microsoft YaHei', 'SimSun', 'PMingLiU', 'Meiryo', 'Apple SD Gothic Neo', 'Noto Sans',
] as const;

export interface FontMeasurement {
  candidate: string;
  widths: Partial<Record<GenericFamily, number>>;
}

export interface FontDetectionResult {
  available: string[];
  unavailable: string[];
}

/**
 * Classic browser-only-font-detection technique: render the same test string once with
 * each generic family alone (the baseline), then once per candidate stacked in front of
 * each generic family. If the candidate is installed, the browser substitutes its
 * metrics and the measured width differs from the baseline for at least one generic
 * family; if not, the generic family's own fallback metrics are used and the widths
 * match exactly. Pure comparison over numbers — the actual `measureText` calls happen
 * in the island, since that requires a live canvas.
 */
export function detectAvailableFonts(
  measurements: readonly FontMeasurement[],
  baseline: Record<GenericFamily, number>
): FontDetectionResult {
  const available: string[] = [];
  const unavailable: string[] = [];

  for (const { candidate, widths } of measurements) {
    const differsFromBaseline = GENERIC_FAMILIES.some(
      (generic) => widths[generic] !== undefined && widths[generic] !== baseline[generic]
    );
    (differsFromBaseline ? available : unavailable).push(candidate);
  }

  return { available, unavailable };
}

// --------------------------------------------------------------------- canvas fingerprint

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/**
 * Hashes the canvas's rendered `data:` URL with SHA-256, so the UI shows a short,
 * comparable fingerprint instead of a multi-kilobyte base64 blob. The rendering itself
 * (drawing shapes/text and calling `toDataURL`) happens in the island, since it needs a
 * live canvas element — this function only hashes the resulting string.
 */
export async function hashCanvasData(dataUrl: string): Promise<ToolResult<string>> {
  if (dataUrl === '') return err('No canvas data to hash.');
  try {
    const bytes = new TextEncoder().encode(dataUrl);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return ok(toHex(digest));
  } catch (error) {
    return err(messageFrom(error, 'Could not hash the canvas fingerprint.'));
  }
}
