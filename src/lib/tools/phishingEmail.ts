/**
 * Pure, offline analysis of a pasted email for phishing indicators.
 *
 * Takes the raw message source (headers + body, as Gmail's "Show original" or Outlook's
 * "View message source" produce) — or just a body, or just headers — and reports the signals
 * that separate phishing from legitimate mail: spoofed display names, SPF/DKIM/DMARC results the
 * receiving server already recorded, mismatched Reply-To, links whose text and destination
 * disagree, look-alike domains, pressure language and risky attachments.
 *
 * Everything is string analysis. It never contacts a domain, so it cannot check reputation,
 * domain age or whether a URL is live, and it cannot re-verify SPF/DKIM itself — it only reads
 * the verdicts already stamped into the headers. The UI says so; a low score is "no strong
 * signals", never "safe".
 */
import { type ToolResult, ok, err } from './result';
import {
  BRANDS,
  SHORTENER_DOMAINS,
  SUSPICIOUS_TLDS,
  brandImpersonation,
  findEmbeddedDestination,
  isIpHost,
  registrableDomain,
  toDisplayHost,
  type Severity,
} from './qrLinkCheck';

export type { Severity };

export type FindingCategory = 'sender' | 'authentication' | 'links' | 'content' | 'attachments';

export interface PhishingFinding {
  severity: Severity;
  /** Stable machine id, used by tests and for list keys. */
  id: string;
  category: FindingCategory;
  title: string;
  detail: string;
}

export type RiskLevel = 'high' | 'elevated' | 'low';

export interface SenderInfo {
  displayName: string;
  address: string;
  domain: string;
}

export interface MessageSummary {
  hasHeaders: boolean;
  from: SenderInfo | null;
  replyTo: SenderInfo | null;
  returnPath: SenderInfo | null;
  subject: string | null;
  date: string | null;
  messageId: string | null;
}

export interface AuthResults {
  /** True when any Authentication-Results or Received-SPF header was found. */
  present: boolean;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

export interface LinkInfo {
  href: string;
  /** The visible text of the link in HTML mail; null for a bare URL in the text. */
  text: string | null;
  host: string;
  displayHost: string;
  domain: string;
  severity: Severity;
  /** Short labels for what is wrong with this link, empty when nothing is. */
  flags: string[];
}

export interface AttachmentInfo {
  filename: string;
  severity: Severity;
  reason: string | null;
}

export interface Hop {
  from: string | null;
  by: string | null;
  ip: string | null;
  date: string | null;
}

export interface PhishingAnalysis {
  /** 0–100, higher is worse. A heuristic, not a probability. */
  score: number;
  level: RiskLevel;
  headline: string;
  summary: string;
  message: MessageSummary;
  auth: AuthResults;
  links: LinkInfo[];
  attachments: AttachmentInfo[];
  /** Mail servers the message passed through, oldest first. */
  hops: Hop[];
  findings: PhishingFinding[];
}

// --- Limits -------------------------------------------------------------------------

/** Longest input analysed; the rest is ignored with a visible note. Keeps keystrokes responsive. */
export const MAX_INPUT_CHARS = 2_000_000;
const MAX_LINKS = 100;
const MAX_MIME_PARTS = 200;
const MAX_MIME_DEPTH = 6;
const MAX_HOPS = 30;
const MAX_ANCHOR_TEXT = 2000;
const MAX_TAG_LENGTH = 2000;

// --- Reference data -----------------------------------------------------------------

const BRAND_DOMAINS = new Set(Object.values(BRANDS).flat());

/** Brand display names are matched on whole words, so "Pineapple Co" does not read as "apple". */
const MAX_BRAND_WORDS = 3;

const COMMON_TLDS = new Set([
  'com', 'net', 'org', 'io', 'co', 'gov', 'edu', 'info', 'biz', 'us', 'uk', 'de', 'fr', 'es', 'it',
  'nl', 'ca', 'au', 'in', 'jp', 'cn', 'br', 'ru', 'app', 'dev', 'xyz', 'online', 'site', 'shop',
]);

const RISKY_ATTACHMENT: Record<string, { severity: Severity; reason: string }> = {};
const addRisky = (extensions: string[], severity: Severity, reason: string) => {
  for (const extension of extensions) RISKY_ATTACHMENT[extension] = { severity, reason };
};
addRisky(
  ['exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'msi', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'jar', 'lnk', 'hta', 'cpl', 'reg', 'dll'],
  'danger',
  'An executable or script file. Legitimate senders do not email these.'
);
addRisky(['iso', 'img', 'vhd', 'vhdx'], 'warning', 'A disk image, a common way to smuggle malware past mail filters.');
addRisky(['html', 'htm', 'xhtml', 'shtml', 'svg'], 'warning', 'A web page attachment. These are often fake login pages that run entirely from your own disk.');
addRisky(['docm', 'xlsm', 'pptm', 'dotm', 'xlam'], 'warning', 'An Office file that can contain macros.');
addRisky(['one', 'chm'], 'warning', 'A file type that can embed scripts or launch other programs.');
addRisky(['zip', 'rar', '7z', 'ace', 'gz'], 'info', 'An archive. Check what is inside before opening it, since archives hide executables from scanners.');

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'rtf']);

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'aol.com',
  'icloud.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com',
]);

interface PhrasePattern {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  pattern: RegExp;
}

const PHRASES: PhrasePattern[] = [
  {
    id: 'urgency',
    severity: 'info',
    title: 'Pressure to act quickly',
    detail: 'Phishing leans on deadlines so you act before you think. Legitimate organisations rarely demand action within hours.',
    pattern:
      /\b(urgent(?:ly)?|immediately|within (?:24|48|72) hours|act now|final (?:notice|warning|reminder)|last chance|expires? (?:today|soon|in \d+)|as soon as possible|right away|immediate action required)\b/gi,
  },
  {
    id: 'threat',
    severity: 'warning',
    title: 'Threat about your account',
    detail: 'Claims that an account is suspended, locked or compromised are the most common phishing opener. Go to the service by typing its address yourself, not through this email.',
    pattern:
      /(?:account (?:has been |will be |is |was )?(?:suspended|locked|disabled|closed|terminated|deactivated|limited|restricted)|unauthori[sz]ed (?:login|access|activity|transaction|sign-?in)|suspicious (?:activity|sign-?in|login)|security (?:alert|breach)|failure to (?:comply|respond|verify|update))/gi,
  },
  {
    id: 'credentials',
    severity: 'warning',
    title: 'Asks you to verify or enter credentials',
    detail: 'A real service will not ask you to confirm your password, card or identity through an emailed link.',
    pattern:
      /(?:\b(?:verify|confirm|update|validate|re-?enter|reset) (?:your )?(?:password|account|identity|login|log-?in|credentials|billing|payment|card|information|details)\b|\b(?:enter|provide|send) your (?:password|pin|ssn|social security number|credit card|card number|otp|verification code)\b|\bsign[- ]?in to (?:verify|confirm|continue|restore)\b)/gi,
  },
  {
    id: 'money',
    severity: 'warning',
    title: 'Money, prize or payment language',
    detail: 'Gift cards, wire transfers, crypto, surprise refunds and prizes show up constantly in scams and business-email-compromise fraud.',
    pattern:
      /\b(?:gift ?cards?|wire transfer|western union|bitcoin|crypto(?:currency)?|itunes card|google play card|payment (?:is )?(?:overdue|pending|failed|declined)|unpaid invoice|invoice attached|you(?:'ve| have) won|lottery|inheritance|claim your (?:prize|refund|reward))\b/gi,
  },
  {
    id: 'secrecy',
    severity: 'warning',
    title: 'Asks you to keep it secret',
    detail: 'Instructions not to tell anyone or to keep a request confidential are a hallmark of impersonation fraud, such as a fake executive asking for a transfer.',
    pattern: /\b(?:do not (?:tell|share|discuss|mention)|don'?t (?:tell|share) anyone|keep (?:this )?(?:confidential|secret|between us))\b/gi,
  },
  {
    id: 'generic-greeting',
    severity: 'info',
    title: 'Impersonal greeting',
    detail: 'Mass phishing rarely knows your name. "Dear customer" from a service that has your account is a common tell.',
    pattern: /^\s*(?:dear (?:customer|user|member|client|account holder|valued \w+|sir|madam|friend|email user)|hello (?:customer|user|member))\b/gim,
  },
];

// --- Small helpers ------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<Severity, number> = { danger: 35, warning: 12, info: 2, ok: 0 };
const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2, ok: 3 };

function finding(
  severity: Severity,
  id: string,
  category: FindingCategory,
  title: string,
  detail: string
): PhishingFinding {
  return { severity, id, category, title, detail };
}

function bytesToString(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder(charset?.trim().toLowerCase() || 'utf-8').decode(bytes);
  } catch {
    // An unknown charset label makes TextDecoder throw; UTF-8 is the best remaining guess.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeBase64(text: string): Uint8Array | null {
  const cleaned = text.replace(/[^A-Za-z0-9+/]/g, '');
  try {
    const binary = atob(cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function quotedPrintableBytes(text: string, underscoreIsSpace: boolean): Uint8Array {
  const source = underscoreIsSpace ? text.replace(/_/g, ' ') : text.replace(/=\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
      bytes.push(parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const byte of new TextEncoder().encode(char)) bytes.push(byte);
    }
  }
  return Uint8Array.from(bytes);
}

/** Decodes RFC 2047 "=?utf-8?B?...?=" words in a header value. */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (whole, charset: string, encoding: string, payload: string) => {
      const bytes = encoding.toLowerCase() === 'b' ? decodeBase64(payload) : quotedPrintableBytes(payload, true);
      return bytes ? bytesToString(bytes, charset) : whole;
    });
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

const stripTags = (html: string): string => html.replace(new RegExp(`<[^>]{0,${MAX_TAG_LENGTH}}>`, 'g'), ' ');
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

// --- Message parsing ----------------------------------------------------------------

interface Header {
  /** Lower-cased. */
  name: string;
  value: string;
}

const firstHeader = (headers: Header[], name: string): string | null =>
  headers.find((header) => header.name === name)?.value ?? null;
const allHeaders = (headers: Header[], name: string): string[] =>
  headers.filter((header) => header.name === name).map((header) => header.value);

function parseHeaderBlock(block: string): Header[] {
  const headers: Header[] = [];
  let current: { name: string; value: string } | null = null;
  for (const line of block.split('\n')) {
    if (/^[ \t]/.test(line) && current) {
      current.value += ` ${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (match) {
      current = { name: match[1].toLowerCase(), value: match[2].trim() };
      headers.push(current);
    } else {
      current = null;
    }
  }
  return headers;
}

function splitHeadBody(text: string): { head: string; body: string } {
  if (text.startsWith('\n')) return { head: '', body: text.slice(1) };
  const gap = text.indexOf('\n\n');
  return gap === -1 ? { head: text, body: '' } : { head: text.slice(0, gap), body: text.slice(gap + 2) };
}

/** A real message starts with a header line (or an mbox "From " line); a pasted body does not. */
const looksLikeHeaders = (text: string): boolean => {
  const firstLine = text.trimStart().split('\n', 1)[0];
  return /^[A-Za-z][A-Za-z0-9-]*:[ \t]/.test(firstLine) || /^From \S+/.test(firstLine);
};

function parameter(value: string | null, name: string): string | null {
  if (!value) return null;
  const extended = new RegExp(`${name}\\*\\s*=\\s*([^']*)'[^']*'([^;\\s]+)`, 'i').exec(value);
  if (extended) {
    try {
      return decodeURIComponent(extended[2]);
    } catch {
      // A malformed percent-escape: fall through to the plain parameter.
    }
  }
  const plain = new RegExp(`(?:^|[;\\s])${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(value);
  return plain ? (plain[1] ?? plain[2]) : null;
}

interface MimeLeaf {
  type: string;
  /** Decoded text for text/* parts; null for everything else. */
  text: string | null;
  filename: string | null;
}

function decodePartBody(body: string, encoding: string | null, charset: string | null): string {
  const method = encoding?.trim().toLowerCase();
  if (method === 'base64') {
    const bytes = decodeBase64(body);
    return bytes ? bytesToString(bytes, charset) : body;
  }
  if (method === 'quoted-printable') return bytesToString(quotedPrintableBytes(body, false), charset);
  return body;
}

function walkMime(headers: Header[], body: string, depth: number, leaves: MimeLeaf[]): void {
  if (leaves.length >= MAX_MIME_PARTS) return;
  const contentType = firstHeader(headers, 'content-type');
  const type = (contentType?.split(';')[0].trim().toLowerCase() || 'text/plain');
  const boundary = parameter(contentType, 'boundary');

  if (type.startsWith('multipart/') && boundary && depth < MAX_MIME_DEPTH) {
    const segments = body.split(`--${boundary}`).slice(1);
    for (const segment of segments) {
      if (segment.startsWith('--')) break;
      const afterMarker = segment.indexOf('\n');
      const part = splitHeadBody(afterMarker === -1 ? '' : segment.slice(afterMarker + 1));
      walkMime(parseHeaderBlock(part.head), part.body, depth + 1, leaves);
      if (leaves.length >= MAX_MIME_PARTS) return;
    }
    return;
  }

  const disposition = firstHeader(headers, 'content-disposition');
  const filename = parameter(disposition, 'filename') ?? parameter(contentType, 'name');
  const isText = type.startsWith('text/');
  const text = isText && !filename
    ? decodePartBody(body, firstHeader(headers, 'content-transfer-encoding'), parameter(contentType, 'charset'))
    : null;
  leaves.push({ type, text, filename: filename ? decodeEncodedWords(filename) : null });
}

// --- Addresses ----------------------------------------------------------------------

function parseAddress(value: string | null): SenderInfo | null {
  if (!value) return null;
  const decoded = decodeEncodedWords(value);
  const angle = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(decoded);
  let address: string | null = angle ? angle[1] : null;
  let name = angle ? decoded.slice(0, angle.index) : '';
  if (!address) {
    const bare = /([^\s<>"(),;]+@[^\s<>"(),;]+)/.exec(decoded);
    address = bare ? bare[1] : null;
    name = '';
  }
  if (!address) return null;
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase().replace(/[>.]+$/, '');
  return {
    displayName: name.replace(/^["'\s]+|["'\s]+$/g, '').trim(),
    address: address.toLowerCase(),
    domain,
  };
}

/** Whole-word brand match over the display name: "PayPal Support" and "Bank of America" hit, "Pineapple Co" does not. */
function brandInDisplayName(name: string): string | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let size = 1; size <= MAX_BRAND_WORDS; size += 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const candidate = words.slice(start, start + size).join('');
      if (BRANDS[candidate]) return candidate;
    }
  }
  return null;
}

// --- Authentication -----------------------------------------------------------------

function parseAuthentication(headers: Header[]): AuthResults {
  const results = allHeaders(headers, 'authentication-results');
  const receivedSpf = allHeaders(headers, 'received-spf');
  const collected: Record<'spf' | 'dkim' | 'dmarc', string[]> = { spf: [], dkim: [], dmarc: [] };
  for (const value of results) {
    for (const match of value.matchAll(/\b(spf|dkim|dmarc)\s*=\s*([a-z]+)/gi)) {
      collected[match[1].toLowerCase() as 'spf' | 'dkim' | 'dmarc'].push(match[2].toLowerCase());
    }
  }
  for (const value of receivedSpf) {
    const match = /^\s*(pass|fail|softfail|neutral|none|temperror|permerror)/i.exec(value);
    if (match) collected.spf.push(match[1].toLowerCase());
  }
  // For DKIM several signatures may be present; one valid signature is what matters.
  const pick = (values: string[], order: string[]): string | null => {
    for (const wanted of order) if (values.includes(wanted)) return wanted;
    return values[0] ?? null;
  };
  return {
    present: results.length > 0 || receivedSpf.length > 0,
    spf: pick(collected.spf, ['fail', 'softfail', 'permerror', 'temperror', 'pass', 'neutral', 'none']),
    dkim: pick(collected.dkim, ['pass', 'fail', 'permerror', 'temperror', 'neutral', 'none']),
    dmarc: pick(collected.dmarc, ['fail', 'pass', 'none', 'temperror', 'permerror']),
  };
}

function authenticationFindings(auth: AuthResults, hasHeaders: boolean): PhishingFinding[] {
  const out: PhishingFinding[] = [];
  if (!hasHeaders) return out;
  if (!auth.present) {
    out.push(
      finding(
        'info',
        'auth-missing',
        'authentication',
        'No SPF/DKIM/DMARC results in the headers',
        'The receiving server normally records whether the sender passed these checks in an Authentication-Results header. It is missing, so the headers may be incomplete. Paste the full original message source for a proper check.'
      )
    );
    return out;
  }

  const { spf, dkim, dmarc } = auth;
  if (spf === 'fail') {
    out.push(finding('danger', 'spf-fail', 'authentication', 'SPF failed', 'The server that sent this message is not authorised to send for the domain it claims. This is the signature of a forged sender.'));
  } else if (spf === 'softfail') {
    out.push(finding('warning', 'spf-softfail', 'authentication', 'SPF soft-failed', 'The sending server is probably not authorised for this domain. Treat it as unverified.'));
  } else if (spf === 'pass') {
    out.push(finding('ok', 'spf-pass', 'authentication', 'SPF passed', 'The sending server is authorised for the envelope domain. This proves the route, not that the sender is who they claim to be.'));
  } else if (spf) {
    out.push(finding('info', 'spf-other', 'authentication', `SPF result: ${spf}`, 'No usable SPF verdict was recorded.'));
  }

  if (dkim === 'fail') {
    out.push(finding('warning', 'dkim-fail', 'authentication', 'DKIM signature failed', 'The message was altered after it was signed, or the signature is forged.'));
  } else if (dkim === 'pass') {
    out.push(finding('ok', 'dkim-pass', 'authentication', 'DKIM passed', 'A valid cryptographic signature from the signing domain is present. Check the signing domain is the one you expect, because scammers can sign with their own.'));
  } else if (dkim) {
    out.push(finding('info', 'dkim-other', 'authentication', `DKIM result: ${dkim}`, 'The message carries no valid DKIM signature.'));
  }

  if (dmarc === 'fail') {
    out.push(finding('danger', 'dmarc-fail', 'authentication', 'DMARC failed', 'The message failed the domain owner\'s own anti-spoofing policy. Mail from a genuine company almost never fails this.'));
  } else if (dmarc === 'pass') {
    out.push(finding('ok', 'dmarc-pass', 'authentication', 'DMARC passed', 'The visible From domain is aligned with a passing SPF or DKIM result. Lookalike domains registered by scammers pass this too, so still check the domain itself.'));
  } else if (dmarc) {
    out.push(finding('info', 'dmarc-other', 'authentication', `DMARC result: ${dmarc}`, 'The sender domain publishes no enforced DMARC policy, so spoofing it is not blocked.'));
  }
  return out;
}

// --- Routing ------------------------------------------------------------------------

function parseHops(headers: Header[]): Hop[] {
  const hops: Hop[] = [];
  for (const value of allHeaders(headers, 'received').slice(0, MAX_HOPS)) {
    const from = /\bfrom\s+([^\s;()]+)/i.exec(value);
    const by = /\bby\s+([^\s;()]+)/i.exec(value);
    const ipv4 = /\[?((?:\d{1,3}\.){3}\d{1,3})\]?/.exec(value);
    const ipv6 = /\[(?:IPv6:)?([0-9a-f:]{3,})\]/i.exec(value);
    const semicolon = value.lastIndexOf(';');
    hops.push({
      from: from ? from[1] : null,
      by: by ? by[1] : null,
      ip: ipv4 ? ipv4[1] : ipv6 ? ipv6[1] : null,
      date: semicolon === -1 ? null : value.slice(semicolon + 1).trim() || null,
    });
  }
  return hops.reverse();
}

// --- Sender checks ------------------------------------------------------------------

function senderFindings(headers: Header[], message: MessageSummary): PhishingFinding[] {
  const out: PhishingFinding[] = [];
  const { from, replyTo, returnPath } = message;

  if (!from) {
    out.push(finding('warning', 'from-missing', 'sender', 'No readable From address', 'Without a From address the sender cannot be checked. Real mail always has one.'));
    return out;
  }

  const fromDomain = registrableDomain(from.domain);

  const embedded = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.exec(from.displayName);
  if (embedded) {
    const shownDomain = embedded[1].slice(embedded[1].lastIndexOf('@') + 1).toLowerCase();
    if (registrableDomain(shownDomain) !== fromDomain) {
      out.push(
        finding(
          'danger',
          'display-name-address',
          'sender',
          'Display name shows a different email address',
          `The name reads "${from.displayName}" but the message actually comes from ${from.address}. Mail apps show the name first, which is exactly what this trick relies on.`
        )
      );
    }
  }

  const brand = brandInDisplayName(from.displayName);
  if (brand && !BRANDS[brand].includes(fromDomain)) {
    out.push(
      finding(
        'danger',
        'display-name-brand',
        'sender',
        `Claims to be ${brand} but is not sent from ${brand}'s domain`,
        `The display name mentions "${brand}", but the address belongs to ${from.domain}${FREE_MAIL.has(fromDomain) ? ' (a free webmail service anyone can sign up for)' : ''}. The display name is free text and proves nothing.`
      )
    );
  }

  const lookalike = brandImpersonation(from.domain, fromDomain);
  if (lookalike) {
    out.push(
      finding(
        'warning',
        'from-domain-lookalike',
        'sender',
        `Sender domain imitates ${lookalike}`,
        `${from.domain} contains the name "${lookalike}" but is not ${lookalike}'s domain. Registering a look-alike is the standard way to fake a trusted sender.`
      )
    );
  }

  if (from.domain.split('.').some((label) => label.startsWith('xn--'))) {
    out.push(
      finding(
        'danger',
        'from-domain-punycode',
        'sender',
        'Sender domain uses look-alike international characters',
        `${from.domain} displays as "${toDisplayHost(from.domain)}". Domains mixing alphabets can imitate well-known ones letter for letter.`
      )
    );
  }

  const tld = from.domain.split('.').pop() ?? '';
  if (SUSPICIOUS_TLDS.has(tld)) {
    out.push(finding('info', 'from-risky-tld', 'sender', `Sender domain ends in ".${tld}"`, 'This ending turns up often on throwaway and look-alike domains. It is a hint, not proof.'));
  }

  if (replyTo && registrableDomain(replyTo.domain) !== fromDomain) {
    out.push(
      finding(
        'warning',
        'reply-to-mismatch',
        'sender',
        'Replies go to a different domain',
        `The message is from ${from.address} but a reply would go to ${replyTo.address}. Scammers use this to receive your answer while the From address looks trustworthy.`
      )
    );
  }

  if (returnPath && registrableDomain(returnPath.domain) !== fromDomain) {
    out.push(
      finding(
        'info',
        'return-path-mismatch',
        'sender',
        'Bounce address is on a different domain',
        `The envelope sender is ${returnPath.address}, not ${from.domain}. Legitimate bulk-mail services do this too, so it matters mainly when SPF or DMARC also fails.`
      )
    );
  }

  const messageId = message.messageId;
  if (messageId) {
    const idDomain = /@([^>\s]+)/.exec(messageId)?.[1]?.toLowerCase();
    if (idDomain && registrableDomain(idDomain) !== fromDomain && !FREE_MAIL.has(fromDomain)) {
      out.push(finding('info', 'message-id-mismatch', 'sender', 'Message-ID comes from a different domain', `The ID was generated by ${idDomain}, not ${from.domain}. Common with mail services, but worth noting if other signs are present.`));
    }
  } else {
    out.push(finding('info', 'message-id-missing', 'sender', 'No Message-ID header', 'Mail servers add this automatically. Its absence suggests hand-built or stripped headers.'));
  }

  const subject = message.subject ?? '';
  if (/^\s*(re|fwd?)\s*:/i.test(subject) && !firstHeader(headers, 'in-reply-to') && !firstHeader(headers, 'references')) {
    out.push(finding('warning', 'fake-reply', 'sender', 'Subject pretends to be a reply or forward', 'It starts with "Re:" or "Fwd:" but has no In-Reply-To or References header, so there is no real conversation behind it. A fake thread is used to lower your guard.'));
  }

  if (message.date) {
    const sent = Date.parse(message.date);
    if (Number.isFinite(sent) && sent > Date.now() + 24 * 60 * 60 * 1000) {
      out.push(finding('info', 'date-future', 'sender', 'Dated in the future', 'The Date header is more than a day ahead of now, which a normal mail server would not produce.'));
    }
  }
  return out;
}

// --- Links --------------------------------------------------------------------------

interface RawLink {
  href: string;
  text: string | null;
}

function extractLinks(htmlParts: string[], textParts: string[]): { links: RawLink[]; truncated: boolean } {
  const found = new Map<string, RawLink>();
  let truncated = false;
  const add = (href: string, text: string | null) => {
    const clean = decodeEntities(href).trim();
    if (clean === '' || found.has(`${clean}\u0000${text ?? ''}`)) return;
    if (found.size >= MAX_LINKS) {
      truncated = true;
      return;
    }
    found.set(`${clean}\u0000${text ?? ''}`, { href: clean, text });
  };

  const openTag = new RegExp(`<a\\b[^>]{0,${MAX_TAG_LENGTH}}>`, 'gi');
  const closeTag = /<\/a\s*>/gi;
  for (const html of htmlParts) {
    openTag.lastIndex = 0;
    for (let open = openTag.exec(html); open; open = openTag.exec(html)) {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(open[0]);
      closeTag.lastIndex = openTag.lastIndex;
      const close = closeTag.exec(html);
      if (!close) {
        if (href) add(href[1] ?? href[2] ?? href[3] ?? '', null);
        break;
      }
      const inner = html.slice(openTag.lastIndex, Math.min(close.index, openTag.lastIndex + MAX_ANCHOR_TEXT));
      if (href) add(href[1] ?? href[2] ?? href[3] ?? '', collapse(decodeEntities(stripTags(inner))) || null);
    }
  }

  const plain = [...textParts, ...htmlParts.map((html) => decodeEntities(stripTags(html)))];
  for (const text of plain) {
    for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
      add(match[0].replace(/[.,;:!?]+$/, ''), null);
    }
  }
  // A bare URL that is also an anchor's href is the same link; drop the text-less duplicate.
  const withText = new Set([...found.values()].filter((link) => link.text !== null).map((link) => link.href));
  const links = [...found.values()].filter((link) => link.text !== null || !withText.has(link.href));
  return { links, truncated };
}

interface LinkHit {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  flag: string;
}

/** The domain a link's visible text claims to go to, if it reads like an address. */
function domainShownInText(text: string): string | null {
  const stripped = text.replace(/\S+@\S+/g, ' ');
  const match = /(?:(https?:\/\/)|(www\.))?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?/i.exec(stripped);
  if (!match) return null;
  const host = match[3].toLowerCase();
  const tld = host.split('.').pop() ?? '';
  if (!match[1] && !match[2] && !COMMON_TLDS.has(tld)) return null;
  return registrableDomain(host.replace(/^www\./, ''));
}

function analyzeLink(raw: RawLink): { info: LinkInfo; hits: LinkHit[] } | null {
  let url: URL;
  try {
    url = new URL(raw.href);
  } catch {
    return null;
  }
  const scheme = url.protocol;
  const hits: LinkHit[] = [];

  if (['javascript:', 'data:', 'vbscript:', 'file:'].includes(scheme)) {
    hits.push({
      id: 'link-dangerous-scheme',
      severity: 'danger',
      title: 'Link runs code or opens a local file',
      detail: 'Links using javascript:, data: or file: are not web addresses. A legitimate email never needs them.',
      flag: 'script link',
    });
    return {
      info: { href: raw.href, text: raw.text, host: scheme, displayHost: scheme, domain: scheme, severity: 'danger', flags: ['script link'] },
      hits,
    };
  }
  if (scheme !== 'http:' && scheme !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const domain = registrableDomain(host);
  const displayHost = toDisplayHost(host);

  const shown = raw.text ? domainShownInText(raw.text) : null;
  if (shown && shown !== domain) {
    const impersonatesBrand = BRAND_DOMAINS.has(shown);
    hits.push({
      id: 'link-text-mismatch',
      severity: impersonatesBrand ? 'danger' : 'warning',
      title: 'Link text shows one address but goes to another',
      detail: `The visible text says "${shown}" but the link really goes to ${host}. This is the textbook phishing trick. Marketing mail sometimes routes real links through a tracker, so check whether ${domain} belongs to the sender.`,
      flag: `shows ${shown}`,
    });
  }
  if (url.username || url.password) {
    hits.push({ id: 'link-credentials', severity: 'danger', title: 'Link hides its real host behind a username', detail: `Everything before the "@" is ignored for routing. The real host is ${host}.`, flag: 'credentials in URL' });
  }
  if (host.split('.').some((label) => label.startsWith('xn--'))) {
    hits.push({ id: 'link-punycode', severity: 'danger', title: 'Link uses look-alike international characters', detail: `The host is written "${host}" but displays as "${displayHost}". Mixed alphabets can imitate real sites.`, flag: 'look-alike characters' });
  }
  if (isIpHost(host)) {
    hits.push({ id: 'link-ip-host', severity: 'warning', title: 'Link points to a raw IP address', detail: 'Real brands use domain names. A bare IP is typical of temporary or malicious servers.', flag: 'raw IP' });
  }
  const brand = brandImpersonation(host, domain);
  if (brand) {
    hits.push({ id: 'link-brand-lookalike', severity: 'warning', title: `Link imitates ${brand}`, detail: `The address contains "${brand}" but belongs to ${domain}. Look-alike domains are a standard phishing pattern.`, flag: `imitates ${brand}` });
  }
  if (SHORTENER_DOMAINS.has(domain) || SHORTENER_DOMAINS.has(host)) {
    hits.push({ id: 'link-shortener', severity: 'warning', title: 'Link goes through a URL shortener', detail: `${host} hides the real destination, which is the point of using one in a suspicious email.`, flag: 'shortener' });
  }
  const embedded = findEmbeddedDestination(url);
  if (embedded) {
    let embeddedHost: string | null = null;
    try {
      embeddedHost = new URL(embedded.url).hostname.toLowerCase();
    } catch {
      embeddedHost = null;
    }
    if (embeddedHost && registrableDomain(embeddedHost) !== domain) {
      hits.push({ id: 'link-embedded-redirect', severity: 'warning', title: 'Link carries a hidden redirect to another site', detail: `${host} is asked to forward you to ${embeddedHost} through "${embedded.param}=". Open redirects on trusted sites are a favourite way to launder a phishing link.`, flag: `redirects to ${embeddedHost}` });
    }
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    hits.push({ id: 'link-odd-port', severity: 'warning', title: 'Link uses an unusual port', detail: `Port :${url.port} is not used by ordinary websites.`, flag: `port ${url.port}` });
  }
  if (scheme === 'http:') {
    hits.push({ id: 'link-http', severity: 'info', title: 'Link is not encrypted (http://)', detail: 'A login page served over plain http is a red flag; real services use https.', flag: 'http' });
  }
  const tld = host.split('.').pop() ?? '';
  if (!isIpHost(host) && SUSPICIOUS_TLDS.has(tld)) {
    hits.push({ id: 'link-risky-tld', severity: 'info', title: `Link ends in ".${tld}"`, detail: 'This ending is frequently used by throwaway domains. A hint, not proof.', flag: `.${tld}` });
  }

  const worst = hits.reduce<Severity>((acc, hit) => (SEVERITY_ORDER[hit.severity] < SEVERITY_ORDER[acc] ? hit.severity : acc), 'ok');
  return {
    info: { href: raw.href, text: raw.text, host, displayHost, domain, severity: worst, flags: hits.map((hit) => hit.flag) },
    hits,
  };
}

function linkFindings(analyses: Array<{ info: LinkInfo; hits: LinkHit[] }>, truncated: boolean): PhishingFinding[] {
  const buckets = new Map<string, { hit: LinkHit; hosts: string[] }>();
  for (const { info, hits } of analyses) {
    for (const hit of hits) {
      const bucket = buckets.get(hit.id) ?? { hit, hosts: [] };
      if (!bucket.hosts.includes(info.displayHost)) bucket.hosts.push(info.displayHost);
      buckets.set(hit.id, bucket);
    }
  }
  const out: PhishingFinding[] = [];
  for (const { hit, hosts } of buckets.values()) {
    const shown = hosts.slice(0, 4).join(', ');
    const more = hosts.length > 4 ? ` and ${hosts.length - 4} more` : '';
    out.push(finding(hit.severity, hit.id, 'links', hit.title, `${hit.detail} Affected: ${shown}${more}.`));
  }
  if (truncated) {
    out.push(finding('info', 'links-truncated', 'links', `Only the first ${MAX_LINKS} links were checked`, 'The message contains more links than are analysed.'));
  }
  return out;
}

// --- Content ------------------------------------------------------------------------

function contentFindings(text: string, htmlParts: string[], hasLinks: boolean): PhishingFinding[] {
  const out: PhishingFinding[] = [];
  const hit = new Set<string>();
  for (const phrase of PHRASES) {
    const matches = [...new Set([...text.matchAll(phrase.pattern)].map((match) => collapse(match[0]).toLowerCase()))];
    if (matches.length === 0) continue;
    hit.add(phrase.id);
    const quoted = matches.slice(0, 3).map((match) => `"${match.slice(0, 60)}"`).join(', ');
    out.push(finding(phrase.severity, phrase.id, 'content', phrase.title, `${phrase.detail} Found: ${quoted}.`));
  }
  if (hit.has('credentials') && (hit.has('urgency') || hit.has('threat')) && hasLinks) {
    out.push(
      finding(
        'danger',
        'pressure-and-credentials',
        'content',
        'Urgent request to verify credentials through a link',
        'Pressure, a threat and a link to "confirm" your login are the three ingredients of a classic credential-phishing message. Do not use the link; go to the service directly.'
      )
    );
  }

  const html = htmlParts.join('\n');
  if (/<form\b/i.test(html)) {
    out.push(finding('warning', 'html-form', 'content', 'Email contains an embedded form', 'Legitimate email does not collect passwords or card numbers inside the message itself. This is a fake login form.'));
  }
  if (/<script\b/i.test(html)) {
    out.push(finding('warning', 'html-script', 'content', 'Email contains a script', 'Scripts are blocked by every mainstream mail app. Their presence suggests the message is built to be opened as a file or in a vulnerable client.'));
  }
  if (/<img\b[^>]{0,500}\b(?:width|height)\s*=\s*["']?[01]["']?[\s>/]/i.test(html)) {
    out.push(finding('info', 'tracking-pixel', 'content', 'Contains a 1-pixel tracking image', 'Loading it tells the sender that you opened the message and from where. Common in marketing mail, and in phishing that verifies a live address.'));
  }
  return out;
}

// --- Attachments --------------------------------------------------------------------

function analyzeAttachment(filename: string): AttachmentInfo {
  const cleaned = filename.trim();
  if (/[‮‭]/.test(cleaned)) {
    return { filename: cleaned, severity: 'danger', reason: 'The name contains a hidden right-to-left control character that makes an executable look like a harmless extension.' };
  }
  const parts = cleaned.toLowerCase().split('.');
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const risk = RISKY_ATTACHMENT[last];
  if (!risk) return { filename: cleaned, severity: 'ok', reason: null };
  const previous = parts.length > 2 ? parts[parts.length - 2] : '';
  if (DOCUMENT_EXTENSIONS.has(previous) && risk.severity !== 'info') {
    return { filename: cleaned, severity: 'danger', reason: `A double extension (".${previous}.${last}") disguises ${risk.reason.charAt(0).toLowerCase()}${risk.reason.slice(1)}` };
  }
  return { filename: cleaned, severity: risk.severity, reason: risk.reason };
}

function attachmentFindings(attachments: AttachmentInfo[]): PhishingFinding[] {
  return attachments
    .filter((attachment) => attachment.severity !== 'ok' && attachment.reason)
    .map((attachment, index) =>
      finding(attachment.severity, `attachment-${index}`, 'attachments', `Risky attachment: ${attachment.filename}`, attachment.reason ?? '')
    );
}

// --- Scoring ------------------------------------------------------------------------

const HEADLINES: Record<RiskLevel, string> = {
  high: 'Strong phishing signals — do not click, reply or open attachments',
  elevated: 'Suspicious — verify the sender another way before you act',
  low: 'No strong phishing signals found',
};

const SUMMARIES: Record<RiskLevel, string> = {
  high: 'Several independent indicators point to a forged or malicious message. Report it and delete it rather than engaging.',
  elevated: 'Some indicators of phishing are present. Do not use links in the message; contact the supposed sender through a phone number or website you already trust.',
  low: 'This is an offline check of the message text only, so a clean result is not a guarantee. It cannot look up domain reputation or age, and a careful attacker can avoid every signal checked here.',
};

export function scoreFindings(findings: PhishingFinding[]): { score: number; level: RiskLevel } {
  const score = Math.min(100, findings.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity], 0));
  return { score, level: score >= 50 ? 'high' : score >= 20 ? 'elevated' : 'low' };
}

// --- Entry point --------------------------------------------------------------------

export function analyzePhishingEmail(input: string): ToolResult<PhishingAnalysis> {
  if (input.trim() === '') {
    return err('Paste the email source (headers and body) to check it.');
  }

  const findings: PhishingFinding[] = [];
  let source = input.replace(/\r\n?/g, '\n');
  if (source.length > MAX_INPUT_CHARS) {
    source = source.slice(0, MAX_INPUT_CHARS);
    findings.push(
      finding('info', 'input-truncated', 'content', 'Very large message — only the start was analysed', `Only the first ${MAX_INPUT_CHARS.toLocaleString('en-US')} characters were checked.`)
    );
  }

  const hasHeaders = looksLikeHeaders(source);
  const { head, body } = hasHeaders ? splitHeadBody(source.trimStart()) : { head: '', body: source };
  const headers = hasHeaders ? parseHeaderBlock(head) : [];

  const leaves: MimeLeaf[] = [];
  if (hasHeaders) {
    walkMime(headers, body, 0, leaves);
  } else {
    leaves.push({ type: /<\s*(?:html|body|a\s|p[\s>]|div)/i.test(body) ? 'text/html' : 'text/plain', text: body, filename: null });
  }

  const htmlParts = leaves.filter((leaf) => leaf.type === 'text/html' && leaf.text !== null).map((leaf) => leaf.text as string);
  const textParts = leaves.filter((leaf) => leaf.type !== 'text/html' && leaf.text !== null).map((leaf) => leaf.text as string);

  const message: MessageSummary = {
    hasHeaders,
    from: parseAddress(firstHeader(headers, 'from')),
    replyTo: parseAddress(firstHeader(headers, 'reply-to')),
    returnPath: parseAddress(firstHeader(headers, 'return-path')),
    subject: firstHeader(headers, 'subject') ? decodeEncodedWords(firstHeader(headers, 'subject') as string) : null,
    date: firstHeader(headers, 'date'),
    messageId: firstHeader(headers, 'message-id'),
  };

  if (hasHeaders) {
    findings.push(...senderFindings(headers, message));
  } else {
    findings.push(
      finding(
        'info',
        'no-headers',
        'sender',
        'No headers pasted — sender checks skipped',
        'Only the body was checked. The most telling evidence (who really sent it, and SPF/DKIM/DMARC results) lives in the headers. Paste the full original message source to include it.'
      )
    );
  }

  const auth = hasHeaders ? parseAuthentication(headers) : { present: false, spf: null, dkim: null, dmarc: null };
  findings.push(...authenticationFindings(auth, hasHeaders));

  const rawLinks = extractLinks(htmlParts, textParts);
  const analyzedLinks = rawLinks.links.map(analyzeLink).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  findings.push(...linkFindings(analyzedLinks, rawLinks.truncated));

  const prose = [message.subject ?? '', ...textParts, ...htmlParts.map((html) => decodeEntities(stripTags(html)))].join('\n');
  findings.push(...contentFindings(prose, htmlParts, analyzedLinks.length > 0));

  const attachments = leaves.filter((leaf) => leaf.filename).map((leaf) => analyzeAttachment(leaf.filename as string));
  findings.push(...attachmentFindings(attachments));

  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const { score, level } = scoreFindings(sorted);

  return ok({
    score,
    level,
    headline: HEADLINES[level],
    summary: SUMMARIES[level],
    message,
    auth,
    links: analyzedLinks.map((entry) => entry.info),
    attachments,
    hops: hasHeaders ? parseHops(headers) : [],
    findings: sorted,
  });
}

// --- Plain-text report (for the Copy button) ----------------------------------------

const SEVERITY_LABEL: Record<Severity, string> = { danger: 'DANGER', warning: 'WARNING', info: 'NOTE', ok: 'OK' };

export function formatReport(analysis: PhishingAnalysis): string {
  const lines = [`${analysis.headline} (risk score ${analysis.score}/100)`, ''];
  const { from, subject } = analysis.message;
  if (from) lines.push(`From:    ${from.displayName ? `${from.displayName} ` : ''}<${from.address}>`);
  if (subject) lines.push(`Subject: ${subject}`);
  if (from || subject) lines.push('');
  for (const item of analysis.findings) {
    lines.push(`[${SEVERITY_LABEL[item.severity]}] ${item.title}`, `    ${item.detail}`);
  }
  return lines.join('\n');
}
