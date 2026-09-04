import { type ToolResult, ok, err } from './result';

export interface SecurityTxtFields {
  /** Each entry is a bare email/phone/URL or an already-prefixed URI; normalized on build. */
  contacts: string[];
  /** A date (YYYY-MM-DD, from a `type="date"` input) — this file's own claimed shelf life. */
  expires: string;
  /** URL to a PGP key or other encryption info for reporters to use. */
  encryption: string;
  /** URL to a page thanking/crediting security researchers. */
  acknowledgments: string;
  /** Comma-separated language tags, e.g. "en, es". */
  preferredLanguages: string;
  /** This file's own canonical URL(s), one per line — RFC 9116 recommends at least one. */
  canonical: string;
  /** URL to the vulnerability disclosure / security policy. */
  policy: string;
  /** URL to security-related job postings. */
  hiring: string;
  /** URL to a CSAF provider-metadata.json document. */
  csaf: string;
}

export const EMPTY_SECURITY_TXT: SecurityTxtFields = {
  contacts: [''],
  expires: '',
  encryption: '',
  acknowledgments: '',
  preferredLanguages: '',
  canonical: '',
  policy: '',
  hiring: '',
  csaf: '',
};

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9()\-.\s]{5,}$/;

/**
 * Normalizes a bare Contact entry into the URI form RFC 9116 requires — `mailto:`, `tel:`, or
 * a full `https://` URL. Typing the scheme is never required, the same convenience this site
 * already applies to a Twitter handle's leading `@` in the Meta Tag Generator.
 */
export function normalizeContactUri(raw: string): ToolResult<string> {
  const trimmed = raw.trim();
  if (trimmed === '') return err('A Contact entry is empty.');

  if (/^(mailto|tel|https?):/i.test(trimmed)) {
    if (/^https?:/i.test(trimmed) && !isAbsoluteHttpUrl(trimmed)) {
      return err(`Contact "${trimmed}" is not a valid URL.`);
    }
    return ok(trimmed);
  }
  if (EMAIL_PATTERN.test(trimmed)) return ok(`mailto:${trimmed}`);
  if (PHONE_PATTERN.test(trimmed)) return ok(`tel:${trimmed.replace(/[\s().-]/g, '')}`);

  return err(
    `Contact "${trimmed}" isn't a recognizable email, phone number, or URL — use one of those, with or without the mailto:/tel:/https:// prefix.`
  );
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function validateLanguageTags(value: string): ToolResult<string[]> {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  for (const tag of tags) {
    if (!LANGUAGE_TAG.test(tag)) {
      return err(`"${tag}" in Preferred-Languages doesn't look like a language tag — use codes like en, es, or pt-BR.`);
    }
  }
  return ok(tags);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface SecurityTxtResult {
  content: string;
  warnings: string[];
}

/**
 * Builds a security.txt file per RFC 9116. Field order in the output follows the RFC's own
 * example layout (Contact, Expires, then the optional fields, Canonical last) — the RFC
 * doesn't mandate an order, but a consistent one makes the file easier for a human to read.
 */
export function buildSecurityTxt(fields: SecurityTxtFields): ToolResult<SecurityTxtResult> {
  const rawContacts = fields.contacts.map((c) => c.trim()).filter(Boolean);
  if (rawContacts.length === 0) return err('Add at least one Contact — RFC 9116 requires it.');

  const contacts: string[] = [];
  for (const raw of rawContacts) {
    const result = normalizeContactUri(raw);
    if (!result.ok) return result;
    contacts.push(result.value);
  }

  const expires = fields.expires.trim();
  if (expires === '') return err('Set an Expires date — RFC 9116 requires it.');
  const expiresDate = new Date(`${expires}T00:00:00Z`);
  if (Number.isNaN(expiresDate.getTime())) return err(`"${expires}" is not a valid date.`);

  for (const [label, value] of [
    ['Encryption', fields.encryption],
    ['Acknowledgments', fields.acknowledgments],
    ['Policy', fields.policy],
    ['Hiring', fields.hiring],
    ['CSAF', fields.csaf],
  ] as const) {
    if (value.trim() !== '' && !isAbsoluteHttpUrl(value.trim())) {
      return err(`${label} "${value}" is not a valid URL — include the scheme, e.g. https://example.com/pgp-key.txt.`);
    }
  }

  const canonicalUrls = splitLines(fields.canonical);
  for (const url of canonicalUrls) {
    if (!isAbsoluteHttpUrl(url)) return err(`Canonical URL "${url}" is not a valid URL.`);
  }

  const languagesResult = validateLanguageTags(fields.preferredLanguages);
  if (!languagesResult.ok) return languagesResult;

  const lines: string[] = [];
  for (const contact of contacts) lines.push(`Contact: ${contact}`);
  lines.push(`Expires: ${expiresDate.toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
  if (fields.encryption.trim() !== '') lines.push(`Encryption: ${fields.encryption.trim()}`);
  if (fields.acknowledgments.trim() !== '') lines.push(`Acknowledgments: ${fields.acknowledgments.trim()}`);
  if (languagesResult.value.length > 0) lines.push(`Preferred-Languages: ${languagesResult.value.join(', ')}`);
  if (fields.policy.trim() !== '') lines.push(`Policy: ${fields.policy.trim()}`);
  if (fields.hiring.trim() !== '') lines.push(`Hiring: ${fields.hiring.trim()}`);
  if (fields.csaf.trim() !== '') lines.push(`CSAF: ${fields.csaf.trim()}`);
  for (const url of canonicalUrls) lines.push(`Canonical: ${url}`);

  const warnings: string[] = [];
  if (expiresDate.getTime() < Date.now()) {
    warnings.push('Expires is in the past — tools and researchers that check this file may treat it as stale immediately.');
  } else if (expiresDate.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    warnings.push('Expires is more than a year out — RFC 9116 recommends keeping it under a year so the file gets revisited regularly.');
  }
  if (canonicalUrls.length === 0) {
    warnings.push('No Canonical URL — recommended so a copy of this file found elsewhere (a scanner\'s cache, a mirror) can be traced back to the authoritative one.');
  }

  return ok({ content: `${lines.join('\n')}\n`, warnings });
}
