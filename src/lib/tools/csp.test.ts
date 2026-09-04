import { describe, expect, it } from 'vitest';
import {
  EMPTY_CSP_CONFIG,
  buildCspHeaderValue,
  formatCspHeaderLine,
  parseCspHeader,
  analyzeCsp,
  buildCspReportingHeaders,
  isCspConfigEmpty,
  type CspConfig,
} from './csp';

describe('buildCspHeaderValue', () => {
  it('joins configured directives in canonical order, semicolon-separated', () => {
    const config: CspConfig = {
      ...EMPTY_CSP_CONFIG,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://cdn.example.com'],
        'object-src': ["'none'"],
      },
    };
    const result = buildCspHeaderValue(config);
    expect(result).toEqual({
      ok: true,
      value: "default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none';",
    });
  });

  it('rejects an empty config', () => {
    const result = buildCspHeaderValue(EMPTY_CSP_CONFIG);
    expect(result.ok).toBe(false);
  });

  it('includes boolean directives and reporting directives', () => {
    const config: CspConfig = {
      ...EMPTY_CSP_CONFIG,
      directives: { 'default-src': ["'self'"] },
      upgradeInsecureRequests: true,
      reportUri: 'https://example.com/csp-report',
      reportTo: 'csp-endpoint',
    };
    const result = buildCspHeaderValue(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('upgrade-insecure-requests');
      expect(result.value).toContain('report-uri https://example.com/csp-report');
      expect(result.value).toContain('report-to csp-endpoint');
    }
  });

  it('preserves otherDirectives verbatim', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, otherDirectives: ["sandbox allow-scripts", "trusted-types default"] };
    const result = buildCspHeaderValue(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('sandbox allow-scripts');
      expect(result.value).toContain('trusted-types default');
    }
  });

  it('rejects a malformed report-uri', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'default-src': ["'self'"] }, reportUri: 'not a url' };
    const result = buildCspHeaderValue(config);
    expect(result.ok).toBe(false);
  });

  it('rejects a report-to group name with a space', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'default-src': ["'self'"] }, reportTo: 'two words' };
    const result = buildCspHeaderValue(config);
    expect(result.ok).toBe(false);
  });
});

describe('formatCspHeaderLine', () => {
  it('uses the enforcing header name by default', () => {
    expect(formatCspHeaderLine(EMPTY_CSP_CONFIG, "default-src 'self';")).toBe(
      "Content-Security-Policy: default-src 'self';"
    );
  });

  it('uses the report-only header name when reportOnly is set', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, reportOnly: true };
    expect(formatCspHeaderLine(config, "default-src 'self';")).toBe(
      "Content-Security-Policy-Report-Only: default-src 'self';"
    );
  });
});

describe('parseCspHeader', () => {
  it('parses a realistic header with a leading header name', () => {
    const result = parseCspHeader(
      "Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none'; report-uri https://example.com/csp-report"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.directives['default-src']).toEqual(["'self'"]);
    expect(result.value.config.directives['script-src']).toEqual(["'self'", 'https://cdn.example.com']);
    expect(result.value.config.directives['object-src']).toEqual(["'none'"]);
    expect(result.value.config.reportUri).toBe('https://example.com/csp-report');
    expect(result.value.config.reportOnly).toBe(false);
    expect(result.value.duplicateDirectives).toEqual([]);
  });

  it('parses a bare directive value with no header name prefix', () => {
    const result = parseCspHeader("default-src 'self'");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.config.directives['default-src']).toEqual(["'self'"]);
  });

  it('detects the report-only variant', () => {
    const result = parseCspHeader("Content-Security-Policy-Report-Only: default-src 'self'");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.config.reportOnly).toBe(true);
  });

  it('parses boolean directives', () => {
    const result = parseCspHeader("default-src 'self'; upgrade-insecure-requests; block-all-mixed-content");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config.upgradeInsecureRequests).toBe(true);
      expect(result.value.config.blockAllMixedContent).toBe(true);
    }
  });

  it('preserves an unrecognized directive in otherDirectives', () => {
    const result = parseCspHeader("default-src 'self'; sandbox allow-scripts allow-forms");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config.otherDirectives).toEqual(['sandbox allow-scripts allow-forms']);
      expect(result.value.config.directives['sandbox' as never]).toBeUndefined();
    }
  });

  it('flags a directive repeated within the same header', () => {
    const result = parseCspHeader("default-src 'self'; default-src 'none'");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.duplicateDirectives).toEqual(['default-src']);
  });

  it('rejects an empty string', () => {
    expect(parseCspHeader('').ok).toBe(false);
    expect(parseCspHeader('   ').ok).toBe(false);
  });

  it('finds the CSP line inside a full curl -I style multi-header dump', () => {
    const dump = [
      'HTTP/2 200',
      'date: Thu, 03 Sep 2026 12:00:00 GMT',
      'content-type: text/html; charset=utf-8',
      "content-security-policy: default-src 'self'; object-src 'none'",
      'x-frame-options: DENY',
      'strict-transport-security: max-age=63072000',
    ].join('\n');

    const result = parseCspHeader(dump);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config.directives['default-src']).toEqual(["'self'"]);
      expect(result.value.config.directives['object-src']).toEqual(["'none'"]);
    }
  });

  it('finds the report-only line inside a multi-header dump', () => {
    const dump = ['date: Thu, 03 Sep 2026 12:00:00 GMT', "content-security-policy-report-only: default-src 'self'"].join('\n');
    const result = parseCspHeader(dump);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.config.reportOnly).toBe(true);
  });

  it('rejects text with no recognizable CSP directives, e.g. a header dump with no CSP line', () => {
    const dump = ['HTTP/2 200', 'date: Thu, 03 Sep 2026 12:00:00 GMT', 'content-type: text/html; charset=utf-8'].join('\n');
    const result = parseCspHeader(dump);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("doesn't contain anything recognizable");
  });

  it('rejects plain prose pasted by mistake', () => {
    const result = parseCspHeader('sorry, I pasted the wrong thing here, this is not a header at all');
    expect(result.ok).toBe(false);
  });

  it('round-trips through buildCspHeaderValue', () => {
    const original = "default-src 'self'; script-src 'self' 'unsafe-inline'; report-to csp-endpoint";
    const parsed = parseCspHeader(original);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rebuilt = buildCspHeaderValue(parsed.value.config);
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) {
      const reparsed = parseCspHeader(rebuilt.value);
      expect(reparsed.ok).toBe(true);
      if (reparsed.ok) expect(reparsed.value.config.directives).toEqual(parsed.value.config.directives);
    }
  });
});

describe('analyzeCsp', () => {
  it('warns on an empty policy', () => {
    const { warnings } = analyzeCsp(EMPTY_CSP_CONFIG);
    expect(warnings.some((w) => w.includes('No directives set'))).toBe(true);
  });

  it('warns on missing script-src', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'img-src': ["'self'"] } };
    const { warnings } = analyzeCsp(config);
    expect(warnings.some((w) => w.includes('No script-src'))).toBe(true);
  });

  it("warns on script-src 'unsafe-inline'", () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ["'self'", "'unsafe-inline'"] } };
    const { warnings } = analyzeCsp(config);
    expect(warnings.some((w) => w.includes("'unsafe-inline'"))).toBe(true);
  });

  it("gives a softer warning for 'unsafe-inline' alongside a nonce", () => {
    const config: CspConfig = {
      ...EMPTY_CSP_CONFIG,
      directives: { 'script-src': ["'self'", "'unsafe-inline'", "'nonce-abc123'"] },
    };
    const { warnings } = analyzeCsp(config);
    expect(warnings.some((w) => w.includes('nonce/hash source'))).toBe(true);
  });

  it("warns on script-src 'unsafe-eval'", () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ["'self'", "'unsafe-eval'"] } };
    const { warnings } = analyzeCsp(config);
    expect(warnings.some((w) => w.includes("'unsafe-eval'"))).toBe(true);
  });

  it('warns on a wildcard script-src', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ['*'] } };
    const { warnings } = analyzeCsp(config);
    expect(warnings.some((w) => w.includes('allows "*"'))).toBe(true);
  });

  it("warns on 'none' mixed with other sources", () => {
    const config: CspConfig = {
      ...EMPTY_CSP_CONFIG,
      directives: { 'script-src': ["'self'"], 'object-src': ["'none'", "'self'"] },
    };
    const { warnings } = analyzeCsp(config);
    expect(warnings.some((w) => w.includes("mixes 'none'"))).toBe(true);
  });

  it('notes missing object-src, base-uri, frame-ancestors and form-action', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ["'self'"] } };
    const { notes } = analyzeCsp(config);
    expect(notes.some((n) => n.includes('object-src'))).toBe(true);
    expect(notes.some((n) => n.includes('base-uri'))).toBe(true);
    expect(notes.some((n) => n.includes('frame-ancestors'))).toBe(true);
    expect(notes.some((n) => n.includes('form-action'))).toBe(true);
  });

  it('does not note missing object-src when it is set to none', () => {
    const config: CspConfig = {
      ...EMPTY_CSP_CONFIG,
      directives: { 'script-src': ["'self'"], 'object-src': ["'none'"] },
    };
    const { notes } = analyzeCsp(config);
    expect(notes.some((n) => n.includes('object-src'))).toBe(false);
  });

  it('notes when no reporting endpoint is configured', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ["'self'"] } };
    const { notes } = analyzeCsp(config);
    expect(notes.some((n) => n.includes('No report-uri or report-to'))).toBe(true);
  });

  it('notes report-to without report-uri as a compatibility gap', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ["'self'"] }, reportTo: 'csp-endpoint' };
    const { notes } = analyzeCsp(config);
    expect(notes.some((n) => n.includes('inconsistent'))).toBe(true);
  });

  it('surfaces duplicate directive names as warnings', () => {
    const config: CspConfig = { ...EMPTY_CSP_CONFIG, directives: { 'script-src': ["'self'"] } };
    const { warnings } = analyzeCsp(config, ['default-src']);
    expect(warnings.some((w) => w.includes('"default-src"') && w.includes('more than once'))).toBe(true);
  });

  it('produces a clean result for a well-hardened policy', () => {
    const config: CspConfig = {
      ...EMPTY_CSP_CONFIG,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
      },
      reportUri: 'https://example.com/csp-report',
      reportTo: 'csp-endpoint',
    };
    const { warnings } = analyzeCsp(config);
    expect(warnings).toEqual([]);
  });
});

describe('isCspConfigEmpty', () => {
  it('is true for the default config', () => {
    expect(isCspConfigEmpty(EMPTY_CSP_CONFIG)).toBe(true);
  });

  it('is false once any directive is set', () => {
    expect(isCspConfigEmpty({ ...EMPTY_CSP_CONFIG, directives: { 'default-src': ["'self'"] } })).toBe(false);
  });
});

describe('buildCspReportingHeaders', () => {
  it('builds both companion headers from a valid URL', () => {
    const result = buildCspReportingHeaders('https://example.com/csp-reports', 'csp-endpoint');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reportingEndpoints).toBe('csp-endpoint="https://example.com/csp-reports"');
    expect(result.value.directive).toBe('report-to csp-endpoint');
    const parsedReportTo = JSON.parse(result.value.reportTo) as { group: string; endpoints: { url: string }[] };
    expect(parsedReportTo.group).toBe('csp-endpoint');
    expect(parsedReportTo.endpoints[0]?.url).toBe('https://example.com/csp-reports');
  });

  it('defaults the group name when blank', () => {
    const result = buildCspReportingHeaders('https://example.com/csp-reports', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.directive).toBe('report-to csp-endpoint');
  });

  it('rejects an empty URL', () => {
    expect(buildCspReportingHeaders('', 'group').ok).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(buildCspReportingHeaders('not a url', 'group').ok).toBe(false);
  });

  it('rejects a non-http(s) URL', () => {
    expect(buildCspReportingHeaders('ftp://example.com/reports', 'group').ok).toBe(false);
  });

  it('rejects a group name containing a space', () => {
    expect(buildCspReportingHeaders('https://example.com/csp-reports', 'two words').ok).toBe(false);
  });
});
