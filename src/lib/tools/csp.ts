import { type ToolResult, ok, err } from './result';

export type CspFetchDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'connect-src'
  | 'media-src'
  | 'object-src'
  | 'frame-src'
  | 'frame-ancestors'
  | 'worker-src'
  | 'manifest-src'
  | 'base-uri'
  | 'form-action';

export const CSP_DIRECTIVES: readonly { value: CspFetchDirective; label: string; hint: string }[] = [
  { value: 'default-src', label: 'default-src', hint: 'Fallback source list for any fetch directive below that is left blank.' },
  { value: 'script-src', label: 'script-src', hint: 'Where JavaScript may be loaded and executed from.' },
  { value: 'style-src', label: 'style-src', hint: 'Where stylesheets and <style> elements may come from.' },
  { value: 'img-src', label: 'img-src', hint: 'Where images may be loaded from.' },
  { value: 'font-src', label: 'font-src', hint: 'Where @font-face fonts may be loaded from.' },
  { value: 'connect-src', label: 'connect-src', hint: 'Where fetch/XHR/WebSocket/EventSource may connect to.' },
  { value: 'media-src', label: 'media-src', hint: 'Where <audio>/<video> sources may come from.' },
  { value: 'object-src', label: 'object-src', hint: 'Where <object>/<embed>/<applet> may load from — set to \'none\' unless the page genuinely embeds plugin content.' },
  { value: 'frame-src', label: 'frame-src', hint: 'Where this page\'s own <iframe> content may come from.' },
  { value: 'frame-ancestors', label: 'frame-ancestors', hint: 'Who is allowed to embed this page in a frame — the modern replacement for X-Frame-Options.' },
  { value: 'worker-src', label: 'worker-src', hint: 'Where Worker/SharedWorker/ServiceWorker scripts may come from.' },
  { value: 'manifest-src', label: 'manifest-src', hint: 'Where the web app manifest may be loaded from.' },
  { value: 'base-uri', label: 'base-uri', hint: 'Restricts what a <base> tag may set as the document\'s base URL.' },
  { value: 'form-action', label: 'form-action', hint: 'Restricts where this page\'s <form> elements may submit to.' },
];

/** Common source keywords, offered as datalist suggestions on every directive input. */
export const CSP_SOURCE_KEYWORDS: readonly string[] = [
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'strict-dynamic'",
  'data:',
  'blob:',
  'https:',
];

export interface CspConfig {
  directives: Partial<Record<CspFetchDirective, string[]>>;
  /** Directives parsed from a pasted header that this tool doesn't have dedicated fields for
   *  (e.g. sandbox, trusted-types, script-src-elem). Preserved verbatim so analyzing and then
   *  editing a real-world header never silently drops part of it. */
  otherDirectives: string[];
  upgradeInsecureRequests: boolean;
  /** Deprecated directive; kept only so a pasted header round-trips without losing it. */
  blockAllMixedContent: boolean;
  /** Emits Content-Security-Policy-Report-Only instead of an enforcing header. */
  reportOnly: boolean;
  /** Legacy `report-uri` directive value — a plain URL. */
  reportUri: string;
  /** `report-to` directive value — a group name defined by a Reporting-Endpoints header. */
  reportTo: string;
}

export const EMPTY_CSP_CONFIG: CspConfig = {
  directives: {},
  otherDirectives: [],
  upgradeInsecureRequests: false,
  blockAllMixedContent: false,
  reportOnly: false,
  reportUri: '',
  reportTo: '',
};

export function isCspConfigEmpty(config: CspConfig): boolean {
  return (
    Object.values(config.directives).every((sources) => !sources || sources.length === 0) &&
    config.otherDirectives.length === 0 &&
    !config.upgradeInsecureRequests &&
    !config.blockAllMixedContent &&
    config.reportUri.trim() === '' &&
    config.reportTo.trim() === ''
  );
}

const DIRECTIVE_NAME = /^[a-z][a-z0-9-]*$/i;

/** Builds the directive-value portion of a CSP header — everything after `Content-Security-Policy: `. */
export function buildCspHeaderValue(config: CspConfig): ToolResult<string> {
  const parts: string[] = [];

  for (const { value } of CSP_DIRECTIVES) {
    const sources = config.directives[value];
    if (sources && sources.length > 0) parts.push(`${value} ${sources.join(' ')}`);
  }
  parts.push(...config.otherDirectives);
  if (config.upgradeInsecureRequests) parts.push('upgrade-insecure-requests');
  if (config.blockAllMixedContent) parts.push('block-all-mixed-content');

  const reportUri = config.reportUri.trim();
  if (reportUri !== '') {
    try {
      new URL(reportUri);
    } catch {
      return err(`"${reportUri}" is not a valid report-uri URL — include the scheme, e.g. https://example.com/csp-report.`);
    }
    parts.push(`report-uri ${reportUri}`);
  }

  const reportTo = config.reportTo.trim();
  if (reportTo !== '') {
    if (/\s/.test(reportTo)) return err('The report-to group name cannot contain spaces.');
    parts.push(`report-to ${reportTo}`);
  }

  if (parts.length === 0) return err('Add at least one directive to build a policy.');
  return ok(`${parts.join('; ')};`);
}

/** Prefixes a built header value with the right header name for enforce vs. report-only mode. */
export function formatCspHeaderLine(config: CspConfig, headerValue: string): string {
  const name = config.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  return `${name}: ${headerValue}`;
}

export interface ParsedCsp {
  config: CspConfig;
  /** Directive names that appeared more than once in the pasted header — a browser only
   *  honors the first occurrence within a single header value. */
  duplicateDirectives: string[];
}

const HEADER_NAME_PREFIX = /^\s*content-security-policy(-report-only)?\s*:\s*/i;

/**
 * Finds the actual CSP header line inside a raw paste. Handles three shapes: just the
 * directive value with no header name, a single `Content-Security-Policy: ...` line, or a
 * full multi-header dump — the output of `curl -I` or a browser's network panel "copy
 * headers" action, both of which this tool's own instructions point people at — where the
 * CSP line is buried among unrelated ones. Only the matched line is ever parsed as directives;
 * everything else in a multi-header dump is ignored rather than being fed to the tokenizer as
 * garbage.
 */
function extractHeaderLine(raw: string): { value: string; reportOnly: boolean } {
  const directMatch = HEADER_NAME_PREFIX.exec(raw);
  if (directMatch) {
    return { value: raw.slice(directMatch[0].length).trim(), reportOnly: Boolean(directMatch[1]) };
  }

  for (const line of raw.split('\n')) {
    const lineMatch = HEADER_NAME_PREFIX.exec(line);
    if (lineMatch) {
      return { value: line.slice(lineMatch[0].length).trim(), reportOnly: Boolean(lineMatch[1]) };
    }
  }

  return { value: raw.trim(), reportOnly: false };
}

/** Parses a pasted CSP header — a bare value, a single header line, or a full multi-header
 *  dump with the CSP line buried among others — into a `CspConfig`. */
export function parseCspHeader(raw: string): ToolResult<ParsedCsp> {
  if (raw.trim() === '') return err('Paste a Content-Security-Policy header value to analyze.');
  const { value: stripped, reportOnly } = extractHeaderLine(raw);
  if (stripped === '') {
    return err(
      'No Content-Security-Policy header found in this text. If you pasted output from curl -I or a browser\'s network panel, make sure the Content-Security-Policy line is included.'
    );
  }

  const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: {}, otherDirectives: [], reportOnly };
  const seen = new Set<string>();
  const duplicateDirectives: string[] = [];

  const statements = stripped
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const tokens = statement.split(/\s+/).filter(Boolean);
    const name = tokens[0];
    if (!name || !DIRECTIVE_NAME.test(name)) continue;
    const lower = name.toLowerCase();

    if (seen.has(lower)) {
      if (!duplicateDirectives.includes(lower)) duplicateDirectives.push(lower);
    }
    seen.add(lower);

    const values = tokens.slice(1);
    if (lower === 'upgrade-insecure-requests') {
      config.upgradeInsecureRequests = true;
      continue;
    }
    if (lower === 'block-all-mixed-content') {
      config.blockAllMixedContent = true;
      continue;
    }
    if (lower === 'report-uri') {
      config.reportUri = values[0] ?? '';
      continue;
    }
    if (lower === 'report-to') {
      config.reportTo = values[0] ?? '';
      continue;
    }

    const known = CSP_DIRECTIVES.find((d) => d.value === lower);
    if (known) {
      config.directives[known.value] = values;
    } else {
      config.otherDirectives.push(statement);
    }
  }

  if (isCspConfigEmpty(config)) {
    return err(
      `"${stripped.slice(0, 80)}${stripped.length > 80 ? '…' : ''}" doesn't contain anything recognizable as CSP directives — check it's the value of a Content-Security-Policy header, not something else.`
    );
  }

  return ok({ config, duplicateDirectives });
}

function effectiveSources(config: CspConfig, directive: CspFetchDirective): string[] | null {
  const own = config.directives[directive];
  if (own && own.length > 0) return own;
  if (directive === 'default-src') return null;
  const fallback = config.directives['default-src'];
  return fallback && fallback.length > 0 ? fallback : null;
}

const HASH_OR_NONCE = /^'(nonce|sha256|sha384|sha512)-/;

export interface CspAnalysis {
  /** Things worth fixing. */
  warnings: string[];
  /** Informational — not necessarily wrong, but worth knowing. */
  notes: string[];
}

/**
 * Lints a policy for the mistakes that actually show up in hand-written CSPs: directives
 * that quietly disable the protection they exist for, contradictory source lists, and
 * missing-but-cheap hardening (object-src, base-uri, frame-ancestors, form-action).
 *
 * Never throws and never blocks — a bad policy is still a policy; this only advises.
 */
export function analyzeCsp(config: CspConfig, duplicateDirectives: readonly string[] = []): CspAnalysis {
  const warnings: string[] = [];
  const notes: string[] = [];

  for (const name of duplicateDirectives) {
    warnings.push(
      `"${name}" appears more than once — a browser only honors the first occurrence within a single header value, so the later ones are silently ignored.`
    );
  }

  if (isCspConfigEmpty(config)) {
    warnings.push('No directives set — this policy restricts nothing.');
    return { warnings, notes };
  }

  const scriptSrc = effectiveSources(config, 'script-src');
  if (!scriptSrc) {
    warnings.push(
      'No script-src (and no default-src fallback) — this policy places no restriction on where JavaScript can load from, which defeats most of the point of a CSP.'
    );
  } else {
    if (scriptSrc.includes("'unsafe-inline'")) {
      const hasHashOrNonce = scriptSrc.some((source) => HASH_OR_NONCE.test(source));
      warnings.push(
        hasHashOrNonce
          ? "script-src allows 'unsafe-inline' alongside a nonce/hash source — CSP2+ browsers ignore 'unsafe-inline' once a nonce or hash is present, but older browsers still honor it, so this is a real (if reduced) weakening. Keep it only if you need to support those."
          : "script-src allows 'unsafe-inline' — inline <script> tags and inline event handlers can run, which removes most of CSP's protection against injected scripts. Prefer a nonce or hash instead."
      );
    }
    if (scriptSrc.includes("'unsafe-eval'")) {
      warnings.push(
        "script-src allows 'unsafe-eval' — eval(), new Function() and similar can run arbitrary strings as code, a common target for injected payloads."
      );
    }
    if (scriptSrc.includes('*')) {
      warnings.push('script-src allows "*" — any origin may serve scripts for this page, which is close to no restriction at all.');
    }
  }

  const objectSrc = effectiveSources(config, 'object-src');
  if (!objectSrc || !(objectSrc.length === 1 && objectSrc[0] === "'none'")) {
    notes.push(
      "No object-src 'none' — <object>/<embed>/<applet> can still load plugin content, a legacy but still-live injection vector. Setting object-src 'none' is close to free unless the page genuinely embeds Flash/Java-style content."
    );
  }

  if (!effectiveSources(config, 'base-uri')) {
    notes.push(
      "No base-uri restriction — an injected <base> tag could rewrite how the page resolves every relative URL on it. base-uri 'self' closes this at essentially no cost for most sites."
    );
  }

  if (!config.directives['frame-ancestors'] || config.directives['frame-ancestors']!.length === 0) {
    notes.push(
      "No frame-ancestors — this is the modern replacement for the X-Frame-Options header and controls who can embed this page in a frame. Add frame-ancestors 'none' or 'self' unless the page is meant to be embeddable by anyone."
    );
  }

  if (!effectiveSources(config, 'form-action')) {
    notes.push(
      "No form-action — without it, an injected <form> could still submit to an attacker-controlled URL even if scripts are otherwise locked down."
    );
  }

  for (const [directive, sources] of Object.entries(config.directives) as [CspFetchDirective, string[]][]) {
    if (!sources || sources.length === 0) continue;
    if (sources.length > 1 && sources.includes("'none'")) {
      warnings.push(
        `${directive} mixes 'none' with other sources — 'none' means no source is allowed at all, so combining it with anything else is contradictory; most browsers drop the whole directive when this happens.`
      );
    }
    if (sources.includes('*') && directive !== 'script-src') {
      notes.push(`${directive} allows "*" — any origin is permitted, which removes this directive's protection.`);
    }
  }

  if (config.blockAllMixedContent) {
    notes.push(
      'block-all-mixed-content is deprecated — modern browsers already block active mixed content by default; upgrade-insecure-requests plus serving the page over HTTPS covers this today.'
    );
  }

  const reportUri = config.reportUri.trim();
  const reportTo = config.reportTo.trim();
  if (reportUri === '' && reportTo === '') {
    notes.push(
      "No report-uri or report-to — CSP violations will only appear in each visitor's browser console; nothing is collected anywhere. Add a reporting endpoint to catch real-world breakage."
    );
  } else if (reportTo !== '' && reportUri === '') {
    notes.push(
      "report-to is set but report-uri is not — report-to browser support is inconsistent, and a browser that doesn't support it sends no report at all. Consider adding report-uri too, as a fallback for older browsers."
    );
  }
  if (reportTo !== '') {
    notes.push(
      `report-to references the endpoint group "${reportTo}" — this only takes effect if the response also sends a Reporting-Endpoints header (or the older Report-To header) defining that group's URL. See the reporting section below.`
    );
  }

  return { warnings, notes };
}

export interface CspReportingHeaders {
  /** Value of the current `Reporting-Endpoints` response header (Reporting API, current spec). */
  reportingEndpoints: string;
  /** Value of the older, Chrome-only `Report-To` header — still worth sending for compatibility. */
  reportTo: string;
  /** The `report-to <group>` directive to add to the CSP itself. */
  directive: string;
}

/**
 * Builds the two companion headers a `report-to` directive needs to actually deliver
 * anywhere: the current `Reporting-Endpoints` header, and the older `Report-To` header
 * some browsers still require alongside it.
 */
export function buildCspReportingHeaders(endpointUrl: string, groupName: string): ToolResult<CspReportingHeaders> {
  const url = endpointUrl.trim();
  if (url === '') return err('Enter a report-collector URL to generate the reporting headers.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(`"${url}" is not a valid URL — include the scheme, e.g. https://example.com/csp-reports.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return err('The report-collector URL must be http:// or https://.');
  }

  const group = groupName.trim() || 'csp-endpoint';
  if (/\s/.test(group)) return err('The endpoint group name cannot contain spaces.');

  return ok({
    reportingEndpoints: `${group}="${url}"`,
    reportTo: JSON.stringify({ group, max_age: 10886400, endpoints: [{ url }] }),
    directive: `report-to ${group}`,
  });
}
