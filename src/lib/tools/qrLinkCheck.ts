/**
 * Pure analysis of what a QR code's decoded text actually does when scanned.
 *
 * Everything here is offline string analysis. It cannot follow a redirect (that needs a
 * network request, which this site never makes), so it answers "does this QR code point
 * at a destination directly, or at someone else's server that decides where to send you
 * later?" — not "what is at the end of the chain?". The UI says so explicitly.
 */

export type Severity = 'danger' | 'warning' | 'info' | 'ok';

export interface Finding {
  severity: Severity;
  /** Stable machine id, used by tests and for React keys. */
  id: string;
  title: string;
  detail: string;
}

export type ContentKind =
  | 'url'
  | 'wifi'
  | 'email'
  | 'phone'
  | 'sms'
  | 'geo'
  | 'contact'
  | 'payment'
  | 'otp'
  | 'calendar'
  | 'text';

/**
 * - `direct`   — an ordinary address on its own domain; nothing in the text suggests a middleman.
 * - `indirect` — the code goes through a short-link, dynamic-QR or redirect service first.
 * - `caution`  — no middleman, but something about the address deserves a second look.
 * - `danger`   — something that should not be opened (script scheme, credential trick, …).
 * - `not-link` — the code holds something other than a web address (Wi-Fi, contact, text, …).
 */
export type Verdict = 'direct' | 'indirect' | 'caution' | 'danger' | 'not-link';

export interface EmbeddedDestination {
  /** The query parameter that carried it, e.g. `url`. */
  param: string;
  url: string;
}

export interface UrlDetails {
  href: string;
  scheme: string;
  /** Hostname as the browser will use it (punycode form for international names). */
  host: string;
  /** Human-readable form of `host` — differs only for punycode (`xn--`) hosts. */
  displayHost: string;
  /** Best-effort registrable domain (`shop.example.co.uk` → `example.co.uk`). */
  registrableDomain: string;
  port: string;
  path: string;
  trackingParams: string[];
}

export interface QrAnalysis {
  kind: ContentKind;
  verdict: Verdict;
  /** One-sentence plain-language conclusion. */
  headline: string;
  summary: string;
  url: UrlDetails | null;
  /** A destination hidden inside a redirect parameter, if one was found (followed one level only). */
  embedded: EmbeddedDestination | null;
  findings: Finding[];
}

// --- Reference data -----------------------------------------------------------------

/**
 * Domains operated by services that sell *dynamic* QR codes: the code holds a short link
 * on the vendor's domain, and the vendor's server redirects to the real page. If the
 * subscription lapses the vendor can stop redirecting — the "it stopped working / now it
 * costs money" problem. Matched on the registrable domain, so subdomains are covered.
 */
const DYNAMIC_QR_DOMAINS = new Set([
  'qrco.de',
  'qr.io',
  'qrs.ly',
  'qrfy.com',
  'qrfy.io',
  'me-qr.com',
  'qrcodechimp.com',
  'qr-code-generator.com',
  'hovercode.com',
  'beaconstac.com',
  'flowcode.com',
  'uqr.to',
  'qrd.by',
  'scanova.io',
  'qrstuff.com',
  'qrcode-tiger.com',
  'l.ead.me',
  'ead.me',
  'qr.page',
  'qrcg.link',
]);

/** General-purpose link shorteners — same mechanism, the destination lives on their server. */
export const SHORTENER_DOMAINS = new Set([
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'v.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'rb.gy',
  't.ly',
  'tiny.cc',
  'bit.do',
  's.id',
  'lnkd.in',
  'short.io',
  'bl.ink',
  'soo.gd',
  'adf.ly',
  'qr.link',
]);

/** Short links run by the destination site itself — still a redirect, but to a known owner. */
const FIRST_PARTY_SHORTENERS: Record<string, string> = {
  'youtu.be': 'YouTube',
  'amzn.to': 'Amazon',
  'amzn.eu': 'Amazon',
  'fb.me': 'Facebook',
  'g.co': 'Google',
  'maps.app.goo.gl': 'Google Maps',
  'spoti.fi': 'Spotify',
  'wa.me': 'WhatsApp',
};

/** Query parameters that conventionally carry a destination URL for a redirector to follow. */
const REDIRECT_PARAMS = new Set([
  'url',
  'u',
  'q',
  'redirect',
  'redirect_url',
  'redirect_uri',
  'redirecturl',
  'redir',
  'next',
  'dest',
  'destination',
  'target',
  'goto',
  'link',
  'continue',
  'return',
  'returnurl',
  'return_to',
  'r',
  'to',
  'out',
]);

/** Hosts whose whole job is to bounce you elsewhere via a parameter. */
const REDIRECTOR_HOSTS = new Set([
  'google.com',
  'l.facebook.com',
  'lm.facebook.com',
  'safelinks.protection.outlook.com',
  'away.vk.com',
  'out.reddit.com',
]);

const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|gbraid|wbraid|msclkid|dclid|twclid|ttclid|li_fat_id|igshid|mc_cid|mc_eid|_hsenc|_hsmi|yclid|vero_id|ref_src)$/i;

/** Brand → registrable domains that legitimately belong to it, for look-alike detection. */
export const BRANDS: Record<string, string[]> = {
  paypal: ['paypal.com', 'paypal.me'],
  google: ['google.com', 'goo.gl', 'g.co', 'googleapis.com', 'googleusercontent.com', 'gstatic.com', 'youtube.com', 'youtu.be'],
  apple: ['apple.com', 'icloud.com'],
  microsoft: ['microsoft.com', 'live.com', 'office.com', 'microsoftonline.com', 'outlook.com'],
  amazon: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.in', 'amazon.ca', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.sg', 'amazon.ae', 'amazon.sa', 'amazon.co.jp', 'amazon.com.au', 'amazon.com.br', 'amazon.com.mx', 'amzn.to', 'amzn.eu', 'amazonaws.com'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  instagram: ['instagram.com'],
  netflix: ['netflix.com'],
  whatsapp: ['whatsapp.com', 'wa.me'],
  coinbase: ['coinbase.com'],
  binance: ['binance.com'],
  dropbox: ['dropbox.com'],
  linkedin: ['linkedin.com', 'lnkd.in'],
  stripe: ['stripe.com'],
  chase: ['chase.com'],
  wellsfargo: ['wellsfargo.com'],
  bankofamerica: ['bankofamerica.com'],
};

/** TLDs often seen on throwaway or look-alike domains. A hint, never proof. */
export const SUSPICIOUS_TLDS = new Set(['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'click', 'country', 'work', 'rest']);

/** Two-label public suffixes so `example.co.uk` isn't mistaken for the domain `co.uk`. */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.in',
  'co.za', 'com.br', 'com.mx', 'com.cn', 'com.sg', 'com.hk', 'com.tr', 'com.ar', 'co.kr', 'com.ph',
]);

const WEB_SCHEMES = new Set(['http:', 'https:']);
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);

// --- Helpers ------------------------------------------------------------------------

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export const isIpHost = (host: string): boolean => host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

// RFC 3492 punycode decoding, so an `xn--` host can be shown the way a person would read it.
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function adaptBias(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

/** Returns null when the label is not valid punycode, rather than throwing. */
export function decodePunycodeLabel(encoded: string): string | null {
  const delimiter = encoded.lastIndexOf('-');
  const output: number[] = [];
  let index = 0;
  if (delimiter > 0) {
    for (let i = 0; i < delimiter; i += 1) {
      const code = encoded.charCodeAt(i);
      if (code >= 0x80) return null;
      output.push(code);
    }
    index = delimiter + 1;
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  while (index < encoded.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= encoded.length) return null;
      const char = encoded.charCodeAt(index);
      index += 1;
      let digit: number;
      if (char >= 48 && char <= 57) digit = char - 22;
      else if (char >= 65 && char <= 90) digit = char - 65;
      else if (char >= 97 && char <= 122) digit = char - 97;
      else return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adaptBias(i - oldI, output.length + 1, oldI === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
}

export function toDisplayHost(host: string): string {
  return host
    .split('.')
    .map((label) => (label.toLowerCase().startsWith('xn--') ? (decodePunycodeLabel(label.slice(4)) ?? label) : label))
    .join('.');
}

const isUrlLike = (value: string): boolean => /^https?:\/\//i.test(value.trim());

function finding(severity: Severity, id: string, title: string, detail: string): Finding {
  return { severity, id, title, detail };
}

const SCHEME_KINDS: Array<[RegExp, ContentKind]> = [
  [/^WIFI:/i, 'wifi'],
  [/^mailto:/i, 'email'],
  [/^matmsg:/i, 'email'],
  [/^tel:/i, 'phone'],
  [/^(smsto|sms|mms|mmsto):/i, 'sms'],
  [/^geo:/i, 'geo'],
  [/^(BEGIN:VCARD|MECARD:)/i, 'contact'],
  [/^(upi:|bitcoin:|ethereum:|litecoin:|monero:|solana:)/i, 'payment'],
  [/^otpauth:/i, 'otp'],
  [/^BEGIN:VEVENT|^BEGIN:VCALENDAR/i, 'calendar'],
];

const KIND_LABELS: Record<Exclude<ContentKind, 'url'>, string> = {
  wifi: 'Wi-Fi network login',
  email: 'email message',
  phone: 'phone number',
  sms: 'text message',
  geo: 'map location',
  contact: 'contact card',
  payment: 'payment request',
  otp: 'two-factor authentication secret',
  calendar: 'calendar event',
  text: 'plain text',
};

export function detectKind(content: string): ContentKind {
  const text = content.trim();
  for (const [pattern, kind] of SCHEME_KINDS) if (pattern.test(text)) return kind;
  // A real address never contains whitespace. Text that merely starts with a link ("https://a.com
  // see our menu") is shown by scanners as plain text, so it must not be parsed as one URL —
  // the URL parser would percent-encode the spaces and merge the words into the host.
  if (/\s/.test(text)) return 'text';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(javascript|data|vbscript|mailto|tel|sms|intent|market):/i.test(text)) {
    return 'url';
  }
  // A bare "example.com/path" — scanners usually open these as links, so treat them as one.
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(text)) return 'url';
  return 'text';
}

/** Parses the decoded text as a URL, adding `https://` to a bare domain the way scanners do. */
function parseLoose(content: string): { url: URL; assumedScheme: boolean } | null {
  const text = content.trim();
  try {
    return { url: new URL(text), assumedScheme: false };
  } catch {
    // Not absolute — maybe a bare domain; handled below.
  }
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(text)) {
    try {
      return { url: new URL(`http://${text}`), assumedScheme: true };
    } catch {
      return null;
    }
  }
  return null;
}

/** Looks one level into the query string for a parameter that holds another URL. */
export function findEmbeddedDestination(url: URL): EmbeddedDestination | null {
  for (const [key, value] of url.searchParams) {
    if (!REDIRECT_PARAMS.has(key.toLowerCase())) continue;
    const candidates = [value];
    try {
      candidates.push(decodeURIComponent(value));
    } catch {
      // A malformed percent-escape just means the second candidate isn't available.
    }
    for (const candidate of candidates) {
      if (isUrlLike(candidate)) return { param: key, url: candidate.trim() };
    }
  }
  return null;
}

function trackingParamsOf(url: URL): string[] {
  const found: string[] = [];
  for (const key of url.searchParams.keys()) if (TRACKING_PARAM.test(key) && !found.includes(key)) found.push(key);
  return found;
}

// --- Main analysis ------------------------------------------------------------------

const HEADLINES: Record<Verdict, string> = {
  direct: 'Goes directly to this address',
  indirect: 'Goes through a middleman first',
  caution: 'Direct, but worth a second look',
  danger: 'Do not open this',
  'not-link': 'Not a web link',
};

export function analyzeQrContent(content: string): QrAnalysis {
  const text = content.trim();
  const kind = detectKind(text);

  if (kind !== 'url') return analyzeNonUrl(text, kind);

  const parsed = parseLoose(text);
  if (!parsed) {
    return {
      kind: 'text',
      verdict: 'not-link',
      headline: HEADLINES['not-link'],
      summary: 'This text could not be read as a web address, so a scanner would show it as plain text.',
      url: null,
      embedded: null,
      findings: [
        finding('info', 'not-parseable', 'Not a valid address', 'The text does not form a complete URL, so there is no destination to check.'),
      ],
    };
  }

  const { url, assumedScheme } = parsed;
  const findings: Finding[] = [];

  if (DANGEROUS_SCHEMES.has(url.protocol)) {
    findings.push(
      finding(
        'danger',
        'dangerous-scheme',
        `Uses the "${url.protocol.slice(0, -1)}:" scheme`,
        'This is not a web page address. It can run code or open a local file, and legitimate QR codes do not use it. Do not open it.'
      )
    );
    return buildUrlAnalysis(url, assumedScheme, null, findings, 'danger');
  }

  if (!WEB_SCHEMES.has(url.protocol)) {
    findings.push(
      finding(
        'info',
        'app-scheme',
        `Opens an app via "${url.protocol.slice(0, -1)}:"`,
        'This is a deep link handed to another app on your device, not a web page. Check that the app it names is one you expect.'
      )
    );
    return buildUrlAnalysis(url, assumedScheme, null, findings, 'caution');
  }

  const host = url.hostname.toLowerCase();
  const domain = registrableDomain(host);
  const display = toDisplayHost(host);

  if (assumedScheme) {
    findings.push(
      finding('info', 'no-scheme', 'No https:// in the code', 'The code holds a bare domain; most scanners will guess a scheme, often plain http.')
    );
  }
  if (url.protocol === 'http:') {
    findings.push(
      finding('warning', 'insecure-http', 'Not encrypted (http://)', 'Anything sent on this page, including passwords, can be read or altered in transit. A legitimate site almost always supports https.')
    );
  }
  if (url.username || url.password) {
    findings.push(
      finding(
        'danger',
        'credentials-in-url',
        'Contains a username or password before the host',
        `Everything before the "@" is ignored for routing — the real host is "${host}". This is a classic trick to make a link look like a trusted site.`
      )
    );
  }

  let middleman = false;
  if (DYNAMIC_QR_DOMAINS.has(domain)) {
    middleman = true;
    findings.push(
      finding(
        'warning',
        'dynamic-qr',
        `Dynamic QR service: ${domain}`,
        `The code holds a link on ${domain}, a service that sells redirecting QR codes. Their server decides where you land and can change it, add tracking, or stop redirecting if the account lapses or stops paying. The real destination is not in the code.`
      )
    );
  } else if (SHORTENER_DOMAINS.has(domain) || SHORTENER_DOMAINS.has(host)) {
    middleman = true;
    findings.push(
      finding(
        'warning',
        'url-shortener',
        `Link shortener: ${host}`,
        `${host} stores the real address on its own server. You cannot see the destination from the code, and the owner of the short link can repoint it at any time.`
      )
    );
  } else if (FIRST_PARTY_SHORTENERS[host]) {
    middleman = true;
    findings.push(
      finding(
        'info',
        'first-party-short',
        `${FIRST_PARTY_SHORTENERS[host]}'s own short link`,
        `${host} is run by ${FIRST_PARTY_SHORTENERS[host]} and redirects to a page on their site. The middleman here is the destination's owner, which is normally fine.`
      )
    );
  }

  const embedded = findEmbeddedDestination(url);
  if (embedded) {
    const embeddedHost = safeHost(embedded.url);
    const sameSite = embeddedHost !== null && registrableDomain(embeddedHost) === domain;
    if (!sameSite) {
      middleman = true;
      findings.push(
        finding(
          'warning',
          'embedded-redirect',
          `Carries another address in "${embedded.param}="`,
          `This link asks ${host} to forward you to ${embeddedHost ?? 'another address'}. Redirect parameters are used by trackers and, when the host does not validate them, by phishing links.`
        )
      );
    }
  } else if (REDIRECTOR_HOSTS.has(host) || REDIRECTOR_HOSTS.has(domain)) {
    // Known bounce host with no readable destination — still worth flagging.
    if (/\/(url|l\.php|redirect)/i.test(url.pathname)) {
      findings.push(finding('info', 'redirector-host', `${host} is a redirect host`, 'This address is a click-through wrapper; the destination is held in a parameter that could not be read.'));
    }
  }

  if (isIpHost(host)) {
    findings.push(
      finding('warning', 'ip-host', 'Points to a raw IP address', 'Legitimate businesses and brands almost always use a domain name. A bare IP is common for temporary or malicious servers.')
    );
  }

  const labels = host.split('.');
  const punycode = labels.some((label) => label.startsWith('xn--'));
  if (punycode) {
    findings.push(
      finding(
        'danger',
        'punycode-host',
        'International look-alike characters in the domain',
        `The host is written "${host}" but displays as "${display}". Domains mixing alphabets can imitate well-known sites letter for letter.`
      )
    );
  }

  const tld = labels[labels.length - 1];
  if (!isIpHost(host) && SUSPICIOUS_TLDS.has(tld)) {
    findings.push(
      finding('info', 'risky-tld', `".${tld}" is a frequently abused ending`, 'Cheap or easily confused endings turn up often on throwaway and look-alike domains. This is a hint, not proof of anything.')
    );
  }

  const brand = brandImpersonation(host, domain);
  if (brand) {
    findings.push(
      finding(
        'warning',
        'brand-lookalike',
        `Mentions "${brand}" but is not ${brand}'s domain`,
        `The name appears in the address, but the site actually belongs to ${domain}. Look-alike domains like this are a standard phishing pattern.`
      )
    );
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    findings.push(finding('warning', 'odd-port', `Unusual port :${url.port}`, 'Ordinary websites do not need a custom port. This is typical of test servers and some malicious hosts.'));
  }

  if (!middleman && isOpaqueShortPath(url)) {
    findings.push(
      finding(
        'info',
        'opaque-path',
        'Path looks like a short random ID',
        `A path such as "${url.pathname}" is typical of a link-tracking or short-link system. If ${domain} is not the business you expected, treat it as a redirect.`
      )
    );
  }

  const tracking = trackingParamsOf(url);
  if (tracking.length > 0) {
    findings.push(
      finding('info', 'tracking', `Contains ${tracking.length} tracking parameter${tracking.length === 1 ? '' : 's'}`, `${tracking.join(', ')} let the owner see which code or ad you came from. They do not change the destination.`)
    );
  }

  if (text.length > 400) {
    findings.push(finding('info', 'long-url', 'Very long address', 'Unusually long links can hide the real host or carry large tracking payloads.'));
  }

  let verdict: Verdict;
  if (findings.some((f) => f.severity === 'danger')) verdict = 'danger';
  else if (middleman) verdict = 'indirect';
  else if (findings.some((f) => f.severity === 'warning')) verdict = 'caution';
  else verdict = 'direct';

  if (verdict === 'direct') {
    findings.unshift(
      finding('ok', 'direct', `Plain https address on ${domain}`, 'The code holds the destination itself — no short-link, dynamic-QR or redirect service sits in the middle of what is encoded.')
    );
  }

  return buildUrlAnalysis(url, assumedScheme, embedded, findings, verdict);
}

function isOpaqueShortPath(url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return false;
  const segment = segments[0];
  return /^[A-Za-z0-9_-]{4,12}$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment) && url.hostname.split('.').length <= 3;
}

function safeHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function brandImpersonation(host: string, domain: string): string | null {
  // Whole-word match on the labels (split further at hyphens), so "paypal-login.xyz" and
  // "paypal.com.evil.xyz" are caught but "pineapple-shop.com" is not.
  const labels = host.split('.');
  const tokens = labels.slice(0, -1).flatMap((label) => label.split('-'));
  for (const [brand, domains] of Object.entries(BRANDS)) {
    if (domains.includes(domain)) continue;
    if (tokens.includes(brand)) return brand;
  }
  return null;
}

function buildUrlAnalysis(
  url: URL,
  assumedScheme: boolean,
  embedded: EmbeddedDestination | null,
  findings: Finding[],
  verdict: Verdict
): QrAnalysis {
  const host = url.hostname.toLowerCase();
  const details: UrlDetails = {
    href: assumedScheme ? url.href.replace(/^http:/, '') : url.href,
    scheme: url.protocol.replace(/:$/, ''),
    host,
    displayHost: toDisplayHost(host),
    registrableDomain: registrableDomain(host),
    port: url.port,
    path: `${url.pathname}${url.search}${url.hash}`,
    trackingParams: trackingParamsOf(url),
  };
  const summaries: Record<Verdict, string> = {
    direct: `Scanning opens ${details.registrableDomain} straight away. This cannot show what that server does after the page loads — it may still redirect.`,
    indirect: 'The code does not hold the final page. Whoever runs the link decides where you end up, and can change it later.',
    caution: 'No middleman was found, but the address has traits that deserve checking before you open it.',
    danger: 'The address has traits strongly associated with phishing or code execution.',
    'not-link': '',
  };
  return {
    kind: 'url',
    verdict,
    headline: HEADLINES[verdict],
    summary: summaries[verdict],
    url: details,
    embedded,
    findings: sortFindings(findings),
  };
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2, ok: 3 };

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function analyzeNonUrl(text: string, kind: ContentKind): QrAnalysis {
  const findings: Finding[] = [];
  const label = KIND_LABELS[kind as Exclude<ContentKind, 'url'>];
  const holds = kind === 'text' ? 'plain text' : `a ${label}`;

  if (kind === 'wifi') {
    const hidden = /(^|;)H:true/i.test(text);
    findings.push(
      finding('info', 'wifi', 'Joins a Wi-Fi network', `Scanning offers to connect your device to a network${hidden ? ' that hides its name' : ''}. Only join networks you trust.`)
    );
  } else if (kind === 'payment') {
    findings.push(
      finding('warning', 'payment', 'Starts a payment', 'Check the payee name and amount your app shows before approving. Stickers placed over a real payment QR code are a known scam.')
    );
  } else if (kind === 'otp') {
    findings.push(
      finding('warning', 'otp', 'Contains a two-factor secret', 'This adds a login code generator for an account. Only scan one you created yourself while setting up that account.')
    );
  } else if (kind === 'sms' || kind === 'phone') {
    findings.push(
      finding('warning', 'phone-action', kind === 'sms' ? 'Prepares a text message' : 'Prepares a phone call', 'Premium-rate numbers and subscription short codes can be hidden behind these. Check the number before sending.')
    );
  } else if (kind === 'email') {
    findings.push(finding('info', 'email', 'Prepares an email', 'Nothing is sent until you press send. Check the recipient and any pre-filled text.'));
  } else if (kind === 'text') {
    findings.push(finding('info', 'text', 'Just text', 'Scanners will display this text. It carries no link to follow.'));
  } else {
    findings.push(finding('info', kind, `Holds a ${label}`, 'This is data for another app, not a web page.'));
  }

  // A URL buried in free text is still worth surfacing.
  const buried = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (buried && kind === 'text') {
    findings.push(finding('warning', 'url-in-text', 'Contains a link inside the text', `Found ${buried[0]}. Paste just that link above to check where it goes.`));
  }

  const verdict: Verdict = findings.some((f) => f.severity === 'warning') ? 'caution' : 'not-link';
  return {
    kind,
    verdict,
    headline: verdict === 'caution' ? `Not a web link — it holds ${holds}` : HEADLINES['not-link'],
    summary:
      kind === 'text'
        ? 'This code holds plain text, not a single web address, so a scanner will just show it. Any link inside it is listed below.'
        : `This code holds ${holds}, not a web address, so there is no redirect to trace.`,
    url: null,
    embedded: null,
    findings: sortFindings(findings),
  };
}

// --- Comparing against the address you expected --------------------------------------

export type IntendedMatch =
  | 'exact'
  | 'same-site'
  | 'via-redirect'
  | 'different'
  | 'invalid-intended';

export interface IntendedComparison {
  match: IntendedMatch;
  message: string;
}

function normalizeForCompare(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  for (const key of [...copy.searchParams.keys()]) if (TRACKING_PARAM.test(key)) copy.searchParams.delete(key);
  const host = copy.hostname.replace(/^www\./, '');
  const path = copy.pathname.replace(/\/+$/, '');
  return `${host}${copy.port ? `:${copy.port}` : ''}${path}${copy.search}`;
}

/**
 * Compares the address a QR code resolves to against the one the visitor expected.
 * `intended` may be a full URL or a bare domain.
 */
export function compareToIntended(analysis: QrAnalysis, intended: string): IntendedComparison | null {
  const wanted = intended.trim();
  if (wanted === '') return null;
  const parsedIntended = parseLoose(wanted);
  if (!parsedIntended || !WEB_SCHEMES.has(parsedIntended.url.protocol)) {
    return { match: 'invalid-intended', message: 'Enter the address you expected as a full URL or a domain, for example https://example.com/menu.' };
  }
  if (!analysis.url) {
    return { match: 'different', message: 'This code does not hold a web address, so it cannot lead to the address you expected.' };
  }

  const actual = new URL(analysis.url.href.startsWith('//') ? `http:${analysis.url.href}` : analysis.url.href);
  const expectedHost = parsedIntended.url.hostname.replace(/^www\./, '').toLowerCase();
  const actualHost = actual.hostname.replace(/^www\./, '').toLowerCase();
  const wantedHasPath = parsedIntended.url.pathname.replace(/\/+$/, '') !== '' || parsedIntended.url.search !== '';

  if (actualHost === expectedHost) {
    if (!wantedHasPath || normalizeForCompare(actual) === normalizeForCompare(parsedIntended.url)) {
      return {
        match: 'exact',
        message: wantedHasPath
          ? `Matches. The code encodes ${expectedHost} with the same path you expected.`
          : `Matches. The code is on ${expectedHost}, the domain you expected.`,
      };
    }
    return {
      match: 'same-site',
      message: `Right domain (${expectedHost}) but a different page: the code opens ${actual.pathname}${actual.search}, not ${parsedIntended.url.pathname}${parsedIntended.url.search}.`,
    };
  }

  if (analysis.embedded) {
    const embeddedHost = safeHost(analysis.embedded.url)?.replace(/^www\./, '');
    if (embeddedHost === expectedHost) {
      return {
        match: 'via-redirect',
        message: `It ends up on ${expectedHost}, but only after passing through ${actual.hostname}. That middleman sees every scan and can change or cut off the destination.`,
      };
    }
  }

  if (registrableDomain(actualHost) === registrableDomain(expectedHost)) {
    return {
      match: 'same-site',
      message: `Same organisation (${registrableDomain(actualHost)}) but a different host: the code uses ${actualHost}, you expected ${expectedHost}.`,
    };
  }

  return {
    match: 'different',
    message: `Does not match. The code points to ${actualHost}, not ${expectedHost}. The destination you expected is not in the code${analysis.verdict === 'indirect' ? ' — it may sit behind that service\'s redirect' : ''}.`,
  };
}
