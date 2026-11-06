/**
 * Pure analysis of a pasted HTTP response-header dump (`curl -I`, a browser network panel's
 * "copy response headers", or a bare list of `Name: value` lines).
 *
 * It grades the headers that harden a site against clickjacking, MIME sniffing, downgrade
 * attacks and cookie theft, and flags the ones that leak server details or are deprecated.
 * It never fetches anything: the visitor pastes headers, so nothing leaves the browser. That
 * also means it grades what was pasted, not what the live site sends right now.
 */
import { type ToolResult, ok, err } from './result';
import { parseCspHeader, analyzeCsp } from './csp';
import type { Severity } from './qrLinkCheck';

export type { Severity };

export interface ParsedHeader {
  /** As written. */
  name: string;
  value: string;
}

export interface HeaderFinding {
  severity: Severity;
  /** Stable id, used by tests and list keys. */
  id: string;
  /** The header (or "Set-Cookie") this is about. */
  header: string;
  title: string;
  detail: string;
  /** Points deducted from 100. */
  penalty: number;
  /** A ready-to-use header line that would fix it, when there is one. */
  fix?: string;
}

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface HeadersAnalysis {
  grade: Grade;
  score: number;
  /** The HTTP status line, if the paste included one. */
  statusLine: string | null;
  /** Set when the paste held several responses (a redirect chain) and only the last was graded. */
  note: string | null;
  headers: ParsedHeader[];
  findings: HeaderFinding[];
  /** One recommended header line per fixable finding, deduplicated, in finding order. */
  recommended: string[];
}

const MAX_INPUT_CHARS = 200_000;
const MAX_HEADERS = 500;

const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/;
const STATUS_LINE = /^HTTP\/\d(?:\.\d)?\s+\d{3}/i;

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2, ok: 3 };

// --- Parsing ------------------------------------------------------------------------

/** Picks the last response out of a paste that holds a redirect chain. */
function lastResponse(text: string): { block: string; responses: number } {
  const blocks = text
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const responses = blocks.filter((block) => STATUS_LINE.test(block));
  if (responses.length > 0) return { block: responses[responses.length - 1], responses: responses.length };
  // No status lines: treat everything up to the first blank line as the header block.
  return { block: blocks[0] ?? '', responses: 1 };
}

export function parseHeaderDump(raw: string): { headers: ParsedHeader[]; statusLine: string | null; responses: number } {
  const { block, responses } = lastResponse(raw.replace(/\r\n?/g, '\n').slice(0, MAX_INPUT_CHARS));
  const headers: ParsedHeader[] = [];
  let statusLine: string | null = null;
  for (const line of block.split('\n')) {
    if (STATUS_LINE.test(line.trim())) {
      statusLine = line.trim();
      continue;
    }
    if (/^[ \t]/.test(line) && headers.length > 0) {
      headers[headers.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    const match = HEADER_LINE.exec(line.trim());
    if (match && headers.length < MAX_HEADERS) headers.push({ name: match[1], value: match[2].trim() });
  }
  return { headers, statusLine, responses };
}

const valuesOf = (headers: ParsedHeader[], name: string): string[] =>
  headers.filter((header) => header.name.toLowerCase() === name).map((header) => header.value);
const firstOf = (headers: ParsedHeader[], name: string): string | null => valuesOf(headers, name)[0] ?? null;

// --- Individual checks --------------------------------------------------------------

function finding(
  severity: Severity,
  id: string,
  header: string,
  title: string,
  detail: string,
  penalty: number,
  fix?: string
): HeaderFinding {
  return { severity, id, header, title, detail, penalty, ...(fix ? { fix } : {}) };
}

/** "5 minutes", "3 days" — a 300-second lifetime must not read as "0 days". */
export function describeDuration(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (seconds < 60) return plural(seconds, 'second');
  if (seconds < 3600) return plural(Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return plural(Math.round(seconds / 3600), 'hour');
  return plural(Math.round(seconds / 86400), 'day');
}

function checkHsts(headers: ParsedHeader[]): HeaderFinding[] {
  const value = firstOf(headers, 'strict-transport-security');
  const name = 'Strict-Transport-Security';
  const fix = 'Strict-Transport-Security: max-age=63072000; includeSubDomains';
  if (value === null) {
    return [
      finding('warning', 'hsts-missing', name, 'HSTS is not set', 'Without it, a browser will happily make a first request over plain http, which an attacker on the network can intercept or downgrade. Send this header on every https response.', 15, fix),
    ];
  }
  const maxAge = /max-age\s*=\s*"?(\d+)"?/i.exec(value);
  if (!maxAge) {
    return [finding('warning', 'hsts-no-max-age', name, 'HSTS has no valid max-age', 'The directive is required; browsers ignore the header without it.', 12, fix)];
  }
  const seconds = Number(maxAge[1]);
  if (seconds === 0) {
    return [finding('danger', 'hsts-zero', name, 'HSTS is switched off (max-age=0)', 'max-age=0 tells browsers to forget the policy. Use it only to deliberately retire HSTS.', 20, fix)];
  }
  const out: HeaderFinding[] = [];
  if (seconds < 15_552_000) {
    out.push(finding('warning', 'hsts-short', name, `HSTS lifetime is short (${describeDuration(seconds)})`, 'Aim for at least 6 months (15552000 seconds), ideally 2 years (63072000), so the protection outlasts a typical visit gap.', 6, fix));
  } else {
    out.push(finding('ok', 'hsts-ok', name, 'HSTS is set with a long lifetime', `max-age=${seconds} seconds.`, 0));
  }
  if (!/includesubdomains/i.test(value)) {
    out.push(finding('info', 'hsts-subdomains', name, 'HSTS does not cover subdomains', 'Add includeSubDomains so a cookie or request cannot be attacked through a subdomain. Only do this once every subdomain serves https.', 2));
  }
  return out;
}

function checkCsp(headers: ParsedHeader[]): HeaderFinding[] {
  const enforcing = firstOf(headers, 'content-security-policy');
  const reportOnly = firstOf(headers, 'content-security-policy-report-only');
  const name = 'Content-Security-Policy';
  const fix = "Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
  if (enforcing === null && reportOnly === null) {
    return [
      finding('warning', 'csp-missing', name, 'No Content-Security-Policy', "CSP is the strongest defence against cross-site scripting, because it limits which scripts a page may run. Start strict with a report-only policy if you are unsure what will break. The CSP Header Builder on this site can help.", 20, fix),
    ];
  }
  if (enforcing === null && reportOnly !== null) {
    return [finding('warning', 'csp-report-only', name, 'CSP is report-only, so nothing is blocked', 'Content-Security-Policy-Report-Only only reports violations. Switch to Content-Security-Policy once the reports are clean.', 12)];
  }
  const parsed = parseCspHeader(`Content-Security-Policy: ${enforcing ?? ''}`);
  if (!parsed.ok) {
    return [finding('warning', 'csp-unreadable', name, 'The CSP could not be read', parsed.error, 10)];
  }
  const analysis = analyzeCsp(parsed.value.config, parsed.value.duplicateDirectives);
  if (analysis.warnings.length === 0) {
    return [finding('ok', 'csp-ok', name, 'CSP is set and shows no obvious weaknesses', 'Paste it into the CSP Header Builder & Analyzer for a directive-by-directive review.', 0)];
  }
  return [
    finding('warning', 'csp-weak', name, `CSP has ${analysis.warnings.length} weakness${analysis.warnings.length === 1 ? '' : 'es'}`, analysis.warnings.join(' '), Math.min(15, 5 * analysis.warnings.length)),
  ];
}

function checkContentTypeOptions(headers: ParsedHeader[]): HeaderFinding[] {
  const value = firstOf(headers, 'x-content-type-options');
  const name = 'X-Content-Type-Options';
  const fix = 'X-Content-Type-Options: nosniff';
  if (value === null) {
    return [finding('warning', 'xcto-missing', name, 'MIME sniffing is not disabled', 'Without "nosniff", a browser may treat an uploaded file as a script based on its content rather than its declared type.', 10, fix)];
  }
  if (value.trim().toLowerCase() !== 'nosniff') {
    return [finding('warning', 'xcto-wrong', name, `Unexpected value "${value}"`, 'The only valid value is "nosniff".', 8, fix)];
  }
  return [finding('ok', 'xcto-ok', name, 'MIME sniffing is disabled', 'nosniff is set.', 0)];
}

function checkClickjacking(headers: ParsedHeader[]): HeaderFinding[] {
  const frameOptions = firstOf(headers, 'x-frame-options');
  const csp = firstOf(headers, 'content-security-policy');
  const hasFrameAncestors = csp !== null && /(^|;)\s*frame-ancestors\s+/i.test(csp);
  if (hasFrameAncestors) {
    return [finding('ok', 'frame-ok', 'Content-Security-Policy', 'Framing is restricted by frame-ancestors', 'This is the modern replacement for X-Frame-Options.', 0)];
  }
  if (frameOptions === null) {
    return [finding('warning', 'frame-missing', 'X-Frame-Options', 'The page can be framed by any site (clickjacking)', "Set X-Frame-Options, or better, a CSP frame-ancestors directive, so another site cannot overlay your page in an invisible frame.", 10, 'X-Frame-Options: DENY')];
  }
  if (!/^(deny|sameorigin)$/i.test(frameOptions.trim())) {
    return [finding('warning', 'frame-invalid', 'X-Frame-Options', `Invalid value "${frameOptions}"`, 'Only DENY and SAMEORIGIN are valid. ALLOW-FROM is obsolete and ignored by current browsers.', 8, 'X-Frame-Options: DENY')];
  }
  return [finding('ok', 'frame-ok', 'X-Frame-Options', 'Framing is restricted', `${frameOptions.trim().toUpperCase()}.`, 0)];
}

const WEAK_REFERRER = new Set(['unsafe-url', 'no-referrer-when-downgrade', 'origin-when-cross-origin']);

function checkReferrerPolicy(headers: ParsedHeader[]): HeaderFinding[] {
  const value = firstOf(headers, 'referrer-policy');
  const name = 'Referrer-Policy';
  const fix = 'Referrer-Policy: strict-origin-when-cross-origin';
  if (value === null) {
    return [finding('info', 'referrer-missing', name, 'No Referrer-Policy', 'Browsers apply their own default, which can leak full URLs (including tokens in query strings) to other sites. Set it explicitly.', 5, fix)];
  }
  const policies = value.split(',').map((part) => part.trim().toLowerCase());
  const effective = policies[policies.length - 1];
  if (WEAK_REFERRER.has(effective)) {
    return [finding('warning', 'referrer-weak', name, `"${effective}" leaks more than necessary`, 'This policy can send the full URL to other origins. Prefer strict-origin-when-cross-origin, same-origin or no-referrer.', 6, fix)];
  }
  return [finding('ok', 'referrer-ok', name, 'Referrer-Policy is set', value, 0)];
}

function checkPermissionsPolicy(headers: ParsedHeader[]): HeaderFinding[] {
  if (firstOf(headers, 'permissions-policy') !== null) {
    return [finding('ok', 'permissions-ok', 'Permissions-Policy', 'Permissions-Policy is set', 'Browser features are restricted.', 0)];
  }
  return [
    finding('info', 'permissions-missing', 'Permissions-Policy', 'No Permissions-Policy', 'It lets you switch off powerful features (camera, microphone, geolocation) for your page and any embeds. Worth setting if you do not use them.', 3, 'Permissions-Policy: camera=(), microphone=(), geolocation=()'),
  ];
}

function checkCrossOrigin(headers: ParsedHeader[]): HeaderFinding[] {
  const missing = ['cross-origin-opener-policy', 'cross-origin-resource-policy', 'cross-origin-embedder-policy'].filter(
    (name) => firstOf(headers, name) === null
  );
  if (missing.length === 0) {
    return [finding('ok', 'coop-ok', 'Cross-Origin-*-Policy', 'Cross-origin isolation headers are set', 'COOP, COEP and CORP are all present.', 0)];
  }
  if (missing.length === 1 && missing[0] === 'cross-origin-embedder-policy') {
    return [finding('ok', 'coop-ok', 'Cross-Origin-*-Policy', 'Cross-origin headers are set', 'COOP and CORP are present. COEP is only needed for cross-origin isolation.', 0)];
  }
  return [
    finding('info', 'coop-missing', 'Cross-Origin-Opener-Policy', 'Cross-origin isolation headers are missing', `Not set: ${missing.join(', ')}. COOP protects against cross-window attacks such as XS-Leaks and Spectre-style side channels, and is cheap to add.`, 3, 'Cross-Origin-Opener-Policy: same-origin'),
  ];
}

const SESSION_LIKE = /(sess|sid|token|auth|jwt|login|csrf|xsrf)/i;

function checkCookies(headers: ParsedHeader[]): HeaderFinding[] {
  const cookies = valuesOf(headers, 'set-cookie');
  if (cookies.length === 0) return [];
  const missingSecure: string[] = [];
  const missingHttpOnly: string[] = [];
  const missingSameSite: string[] = [];
  const noneWithoutSecure: string[] = [];
  const badPrefix: string[] = [];

  for (const cookie of cookies) {
    const parts = cookie.split(';').map((part) => part.trim());
    const [pair, ...attributes] = parts;
    const name = pair.split('=')[0].trim() || '(unnamed)';
    const attrs = attributes.map((attribute) => attribute.toLowerCase());
    const secure = attrs.includes('secure');
    const httpOnly = attrs.includes('httponly');
    const sameSite = attrs.find((attribute) => attribute.startsWith('samesite'))?.split('=')[1]?.trim() ?? null;

    if (!secure) missingSecure.push(name);
    if (!httpOnly && SESSION_LIKE.test(name)) missingHttpOnly.push(name);
    if (sameSite === null) missingSameSite.push(name);
    if (sameSite === 'none' && !secure) noneWithoutSecure.push(name);
    if (name.startsWith('__Secure-') && !secure) badPrefix.push(name);
    if (name.startsWith('__Host-') && (!secure || !attrs.includes('path=/') || attrs.some((attribute) => attribute.startsWith('domain=')))) {
      badPrefix.push(name);
    }
  }

  const list = (names: string[]) => [...new Set(names)].slice(0, 5).join(', ');
  const out: HeaderFinding[] = [];
  if (noneWithoutSecure.length > 0) {
    out.push(finding('danger', 'cookie-none-insecure', 'Set-Cookie', 'SameSite=None cookie without Secure', `Browsers reject these cookies. Affected: ${list(noneWithoutSecure)}.`, 15));
  }
  if (badPrefix.length > 0) {
    out.push(finding('warning', 'cookie-prefix', 'Set-Cookie', 'Cookie prefix rules are not met', `__Secure- cookies need Secure, and __Host- cookies need Secure, Path=/ and no Domain. Browsers drop them otherwise. Affected: ${list(badPrefix)}.`, 8));
  }
  if (missingSecure.length > 0) {
    out.push(finding('warning', 'cookie-secure', 'Set-Cookie', 'Cookies are missing the Secure flag', `Without Secure a cookie is also sent over plain http, where it can be read. Affected: ${list(missingSecure)}.`, 10));
  }
  if (missingHttpOnly.length > 0) {
    out.push(finding('warning', 'cookie-httponly', 'Set-Cookie', 'Session-like cookies are readable by scripts', `Without HttpOnly, any XSS bug can steal the cookie. Affected: ${list(missingHttpOnly)}.`, 8));
  }
  if (missingSameSite.length > 0) {
    out.push(finding('info', 'cookie-samesite', 'Set-Cookie', 'Cookies have no explicit SameSite', `Set SameSite=Lax (or Strict) deliberately to defend against cross-site request forgery. Affected: ${list(missingSameSite)}.`, 3));
  }
  if (out.length === 0) {
    out.push(finding('ok', 'cookies-ok', 'Set-Cookie', `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} with sound flags`, 'Secure, HttpOnly (where session-like) and SameSite are set.', 0));
  }
  return out;
}

function checkCors(headers: ParsedHeader[]): HeaderFinding[] {
  const origin = firstOf(headers, 'access-control-allow-origin');
  if (origin === null) return [];
  const credentials = (firstOf(headers, 'access-control-allow-credentials') ?? '').toLowerCase() === 'true';
  const name = 'Access-Control-Allow-Origin';
  if (origin.trim() === '*' && credentials) {
    return [finding('danger', 'cors-wildcard-credentials', name, 'Wildcard origin with credentials', 'Browsers refuse "*" with credentials, and servers that reflect the Origin header to work around it expose logged-in users to any site. Name the allowed origins explicitly.', 20)];
  }
  if (origin.trim().toLowerCase() === 'null') {
    return [finding('warning', 'cors-null', name, 'Allows the "null" origin', 'Sandboxed iframes and local files send Origin: null, so allowing it lets almost anyone make requests.', 10)];
  }
  if (origin.trim() === '*') {
    return [finding('info', 'cors-wildcard', name, 'Any site can read this response', 'Fine for a public API or static asset, wrong for anything user-specific.', 2)];
  }
  return [finding('ok', 'cors-ok', name, 'CORS names a specific origin', origin, 0)];
}

function checkLeakage(headers: ParsedHeader[]): HeaderFinding[] {
  const out: HeaderFinding[] = [];
  const server = firstOf(headers, 'server');
  if (server !== null && /\d/.test(server)) {
    out.push(finding('info', 'server-version', 'Server', 'Server header reveals a version', `"${server}" tells attackers exactly which software and version to look up exploits for. Remove the version number.`, 3));
  }
  for (const name of ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']) {
    const value = firstOf(headers, name);
    if (value !== null) {
      out.push(finding('info', `leak-${name}`, name, `${name} reveals your stack`, `"${value}" is not needed by browsers. Remove it.`, 2));
    }
  }
  return out;
}

function checkDeprecated(headers: ParsedHeader[]): HeaderFinding[] {
  const out: HeaderFinding[] = [];
  const xss = firstOf(headers, 'x-xss-protection');
  if (xss !== null && !/^0/.test(xss.trim())) {
    out.push(finding('info', 'xxss', 'X-XSS-Protection', 'X-XSS-Protection is obsolete', 'The browser filters it controlled were removed because they could introduce vulnerabilities. Remove it or set it to 0, and rely on CSP.', 2, 'X-XSS-Protection: 0'));
  }
  if (firstOf(headers, 'public-key-pins') !== null || firstOf(headers, 'public-key-pins-report-only') !== null) {
    out.push(finding('warning', 'hpkp', 'Public-Key-Pins', 'HPKP is deprecated and dangerous', 'Public key pinning was removed from browsers because a mistake could lock visitors out of a site permanently. Remove the header.', 6));
  }
  if (firstOf(headers, 'expect-ct') !== null) {
    out.push(finding('info', 'expect-ct', 'Expect-CT', 'Expect-CT is no longer needed', 'Certificate Transparency is enforced by default in modern browsers. Remove it.', 1));
  }
  if (firstOf(headers, 'feature-policy') !== null) {
    out.push(finding('info', 'feature-policy', 'Feature-Policy', 'Feature-Policy has been replaced', 'Use Permissions-Policy instead.', 1));
  }
  return out;
}

// --- Grading ------------------------------------------------------------------------

export function gradeFromScore(score: number, penalized: boolean): Grade {
  if (score >= 100 && !penalized) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function analyzeSecurityHeaders(raw: string): ToolResult<HeadersAnalysis> {
  if (raw.trim() === '') return err('Paste the HTTP response headers to check them.');

  const { headers, statusLine, responses } = parseHeaderDump(raw);
  if (headers.length === 0) {
    return err(
      'No headers found. Paste lines in the form "Name: value", for example the output of curl -I https://example.com or the response headers from your browser\'s network panel.'
    );
  }

  const findings: HeaderFinding[] = [
    ...checkHsts(headers),
    ...checkCsp(headers),
    ...checkClickjacking(headers),
    ...checkContentTypeOptions(headers),
    ...checkReferrerPolicy(headers),
    ...checkPermissionsPolicy(headers),
    ...checkCrossOrigin(headers),
    ...checkCookies(headers),
    ...checkCors(headers),
    ...checkLeakage(headers),
    ...checkDeprecated(headers),
  ];

  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const penalty = findings.reduce((sum, item) => sum + item.penalty, 0);
  const score = Math.max(0, 100 - penalty);
  const recommended = [...new Set(sorted.filter((item) => item.fix).map((item) => item.fix as string))];

  return ok({
    grade: gradeFromScore(score, penalty > 0),
    score,
    statusLine,
    note: responses > 1 ? `The paste held ${responses} responses (a redirect chain). Only the last one was graded.` : null,
    headers,
    findings: sorted,
    recommended,
  });
}

/** Plain-text report for the Copy button. */
export function formatHeadersReport(analysis: HeadersAnalysis): string {
  const labels: Record<Severity, string> = { danger: 'DANGER', warning: 'WARNING', info: 'NOTE', ok: 'OK' };
  const lines = [`Security headers grade ${analysis.grade} (${analysis.score}/100)`, ''];
  for (const item of analysis.findings) lines.push(`[${labels[item.severity]}] ${item.title}`, `    ${item.detail}`);
  if (analysis.recommended.length > 0) lines.push('', 'Recommended headers:', ...analysis.recommended);
  return lines.join('\n');
}
