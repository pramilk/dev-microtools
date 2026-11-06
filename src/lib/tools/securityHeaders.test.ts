import { describe, it, expect } from 'vitest';
import {
  analyzeSecurityHeaders,
  describeDuration,
  formatHeadersReport,
  gradeFromScore,
  parseHeaderDump,
  type HeadersAnalysis,
} from './securityHeaders';

function analyze(input: string): HeadersAnalysis {
  const result = analyzeSecurityHeaders(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const ids = (a: HeadersAnalysis): string[] => a.findings.map((f) => f.id);

const GOOD = [
  'HTTP/2 200',
  'strict-transport-security: max-age=63072000; includeSubDomains; preload',
  "content-security-policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options: nosniff',
  'referrer-policy: strict-origin-when-cross-origin',
  'permissions-policy: camera=(), microphone=()',
  'cross-origin-opener-policy: same-origin',
  'cross-origin-resource-policy: same-origin',
  'set-cookie: sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax',
].join('\n');

const BARE = ['HTTP/1.1 200 OK', 'Server: Apache/2.4.41 (Ubuntu)', 'X-Powered-By: PHP/7.4.3', 'Content-Type: text/html'].join('\n');

describe('analyzeSecurityHeaders — input handling', () => {
  it('errors on empty input', () => {
    expect(analyzeSecurityHeaders('  ')).toEqual({ ok: false, error: expect.stringMatching(/paste the http response headers/i) });
  });

  it('errors, with a hint, when nothing looks like a header', () => {
    const result = analyzeSecurityHeaders('this is just a sentence with no colon-separated headers at all');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/curl -I/);
  });

  it('gives a fully hardened response the top grade', () => {
    const analysis = analyze(GOOD);
    expect(analysis.grade).toBe('A+');
    expect(analysis.score).toBe(100);
    expect(analysis.findings.every((f) => f.severity === 'ok')).toBe(true);
  });

  it('fails a bare response and reports the missing headers', () => {
    const analysis = analyze(BARE);
    expect(analysis.grade).toBe('F');
    expect(ids(analysis)).toEqual(
      expect.arrayContaining(['hsts-missing', 'csp-missing', 'frame-missing', 'xcto-missing', 'referrer-missing', 'server-version', 'leak-x-powered-by'])
    );
  });

  it('works without a status line and with Windows line endings', () => {
    const analysis = analyze('Strict-Transport-Security: max-age=63072000\r\nX-Content-Type-Options: nosniff\r\n');
    expect(analysis.statusLine).toBeNull();
    expect(ids(analysis)).toContain('xcto-ok');
  });

  it('grades only the last response of a redirect chain and says so', () => {
    const chain = `HTTP/1.1 301 Moved\nLocation: https://example.com/\n\n${GOOD}`;
    const analysis = analyze(chain);
    expect(analysis.note).toMatch(/2 responses/);
    expect(analysis.grade).toBe('A+');
  });

  it('ignores a response body after the headers', () => {
    const analysis = analyze(`HTTP/1.1 200 OK\nX-Content-Type-Options: nosniff\n\n<html>Not-A-Header: ignored</html>`);
    expect(analysis.headers.map((h) => h.name)).toEqual(['X-Content-Type-Options']);
  });

  it('unfolds continuation lines and skips HTTP/2 pseudo-headers', () => {
    const parsed = parseHeaderDump('HTTP/2 200\n:status: 200\ncontent-security-policy: default-src \'self\';\n  object-src \'none\'');
    expect(parsed.headers).toHaveLength(1);
    expect(parsed.headers[0].value).toContain("object-src 'none'");
  });

  it('stays fast on a very large paste', () => {
    const big = `HTTP/1.1 200 OK\n${Array.from({ length: 5000 }, (_, i) => `X-Custom-${i}: ${'v'.repeat(50)}`).join('\n')}`;
    const started = Date.now();
    analyze(big);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('handles Unicode header values', () => {
    expect(() => analyze('Server: nginx/1.18 – Zürich 🚀\nX-Content-Type-Options: nosniff')).not.toThrow();
  });
});

describe('individual checks', () => {
  it('flags HSTS problems', () => {
    expect(ids(analyze('Strict-Transport-Security: includeSubDomains'))).toContain('hsts-no-max-age');
    expect(ids(analyze('Strict-Transport-Security: max-age=0'))).toContain('hsts-zero');
    expect(ids(analyze('Strict-Transport-Security: max-age=3600'))).toContain('hsts-short');
    expect(ids(analyze('Strict-Transport-Security: max-age=31536000'))).toEqual(expect.arrayContaining(['hsts-ok', 'hsts-subdomains']));
  });

  it('reads the CSP through the shared CSP analyzer', () => {
    const weak = analyze("Content-Security-Policy: default-src *; script-src 'unsafe-inline' 'unsafe-eval'");
    expect(ids(weak)).toContain('csp-weak');
    expect(ids(analyze("Content-Security-Policy-Report-Only: default-src 'self'"))).toContain('csp-report-only');
  });

  it('accepts frame-ancestors as the clickjacking defence', () => {
    const analysis = analyze("Content-Security-Policy: default-src 'self'; frame-ancestors 'none'");
    expect(ids(analysis)).not.toContain('frame-missing');
  });

  it('rejects an invalid X-Frame-Options value', () => {
    expect(ids(analyze('X-Frame-Options: ALLOW-FROM https://a.example'))).toContain('frame-invalid');
  });

  it('flags a weak Referrer-Policy and takes the last of a fallback list', () => {
    expect(ids(analyze('Referrer-Policy: unsafe-url'))).toContain('referrer-weak');
    expect(ids(analyze('Referrer-Policy: unsafe-url, strict-origin'))).toContain('referrer-ok');
  });

  it('flags cookie problems with the cookie names', () => {
    const analysis = analyze('Set-Cookie: sessionid=1; Path=/\nSet-Cookie: theme=dark; SameSite=None');
    expect(ids(analysis)).toEqual(expect.arrayContaining(['cookie-secure', 'cookie-httponly', 'cookie-none-insecure']));
    expect(analysis.findings.find((f) => f.id === 'cookie-httponly')?.detail).toContain('sessionid');
  });

  it('checks cookie prefixes', () => {
    expect(ids(analyze('Set-Cookie: __Host-id=1; Secure; Path=/; Domain=example.com'))).toContain('cookie-prefix');
    expect(ids(analyze('Set-Cookie: __Host-id=1; Secure; Path=/; HttpOnly; SameSite=Lax'))).not.toContain('cookie-prefix');
  });

  it('flags CORS misconfigurations', () => {
    expect(ids(analyze('Access-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true'))).toContain('cors-wildcard-credentials');
    expect(ids(analyze('Access-Control-Allow-Origin: null'))).toContain('cors-null');
    expect(ids(analyze('Access-Control-Allow-Origin: *'))).toContain('cors-wildcard');
    expect(ids(analyze('Access-Control-Allow-Origin: https://app.example.com'))).toContain('cors-ok');
  });

  it('flags deprecated headers', () => {
    const analysis = analyze('X-XSS-Protection: 1; mode=block\nPublic-Key-Pins: pin-sha256="x"\nExpect-CT: max-age=1\nFeature-Policy: camera none');
    expect(ids(analysis)).toEqual(expect.arrayContaining(['xxss', 'hpkp', 'expect-ct', 'feature-policy']));
    expect(ids(analyze('X-XSS-Protection: 0'))).not.toContain('xxss');
  });

  it('matches header names case-insensitively', () => {
    expect(ids(analyze('X-CONTENT-TYPE-OPTIONS: NOSNIFF'))).toContain('xcto-ok');
  });
});

describe('describeDuration', () => {
  it('uses a readable unit and pluralises', () => {
    expect(describeDuration(30)).toBe('30 seconds');
    expect(describeDuration(300)).toBe('5 minutes');
    expect(describeDuration(3600)).toBe('1 hour');
    expect(describeDuration(86400 * 3)).toBe('3 days');
  });

  it('names a short HSTS lifetime in minutes, not "0 days"', () => {
    const item = analyze('Strict-Transport-Security: max-age=300').findings.find((f) => f.id === 'hsts-short');
    expect(item?.title).toContain('5 minutes');
  });
});

describe('grading and output', () => {
  it('maps scores to grades', () => {
    expect(gradeFromScore(100, false)).toBe('A+');
    expect(gradeFromScore(100, true)).toBe('A');
    expect(gradeFromScore(85, true)).toBe('B');
    expect(gradeFromScore(70, true)).toBe('C');
    expect(gradeFromScore(55, true)).toBe('D');
    expect(gradeFromScore(10, true)).toBe('F');
  });

  it('offers deduplicated recommended header lines for the fixable findings', () => {
    const analysis = analyze(BARE);
    expect(analysis.recommended).toEqual(expect.arrayContaining(['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY']));
    expect(new Set(analysis.recommended).size).toBe(analysis.recommended.length);
  });

  it('sorts the most severe findings first', () => {
    const order = { danger: 0, warning: 1, info: 2, ok: 3 } as const;
    const severities = analyze(BARE).findings.map((f) => order[f.severity]);
    expect([...severities].sort((a, b) => a - b)).toEqual(severities);
  });

  it('formats a plain-text report', () => {
    const report = formatHeadersReport(analyze(BARE));
    expect(report).toMatch(/grade F/);
    expect(report).toMatch(/\[WARNING\] HSTS is not set/);
    expect(report).toMatch(/Recommended headers:/);
  });
});
