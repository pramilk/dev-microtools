import { describe, it, expect } from 'vitest';
import {
  analyzeQrContent,
  compareToIntended,
  decodePunycodeLabel,
  detectKind,
  findEmbeddedDestination,
  registrableDomain,
  toDisplayHost,
} from './qrLinkCheck';

const ids = (content: string) => analyzeQrContent(content).findings.map((f) => f.id);

describe('analyzeQrContent — direct links', () => {
  it('calls a plain https address direct', () => {
    const result = analyzeQrContent('https://example.com/menu');
    expect(result.verdict).toBe('direct');
    expect(result.url?.registrableDomain).toBe('example.com');
    expect(ids('https://example.com/menu')).toContain('direct');
  });

  it('keeps a long normal path direct', () => {
    expect(analyzeQrContent('https://docs.example.com/guides/getting-started/install').verdict).toBe('direct');
  });

  it('trims surrounding whitespace', () => {
    expect(analyzeQrContent('  https://example.com  \n').verdict).toBe('direct');
  });

  it('treats a first-party short link as indirect but not a warning', () => {
    const result = analyzeQrContent('https://youtu.be/dQw4w9WgXcQ');
    expect(result.verdict).toBe('indirect');
    expect(result.findings.find((f) => f.id === 'first-party-short')?.severity).toBe('info');
  });
});

describe('analyzeQrContent — middlemen', () => {
  it('flags a dynamic QR service domain', () => {
    const result = analyzeQrContent('https://qrco.de/bgK4mP');
    expect(result.verdict).toBe('indirect');
    expect(ids('https://qrco.de/bgK4mP')).toContain('dynamic-qr');
  });

  it('flags a subdomain of a dynamic QR service', () => {
    expect(ids('https://scan.qr.io/abc123')).toContain('dynamic-qr');
  });

  it('flags URL shorteners', () => {
    expect(analyzeQrContent('https://bit.ly/3xYz12').verdict).toBe('indirect');
    expect(ids('https://tinyurl.com/yc8abc')).toContain('url-shortener');
  });

  it('finds a destination hidden in a redirect parameter', () => {
    const result = analyzeQrContent('https://tracker.example.net/go?url=https%3A%2F%2Fshop.example.org%2Fdeal');
    expect(result.verdict).toBe('indirect');
    expect(result.embedded).toEqual({ param: 'url', url: 'https://shop.example.org/deal' });
  });

  it('does not treat a same-site return URL as a redirect', () => {
    const result = analyzeQrContent('https://example.com/login?next=https://example.com/account');
    expect(result.verdict).toBe('direct');
  });
});

describe('analyzeQrContent — risk signals', () => {
  it('rejects javascript: as dangerous', () => {
    const result = analyzeQrContent('javascript:alert(1)');
    expect(result.verdict).toBe('danger');
    expect(ids('javascript:alert(1)')).toContain('dangerous-scheme');
  });

  it('rejects data: URLs', () => {
    expect(analyzeQrContent('data:text/html,<script>alert(1)</script>').verdict).toBe('danger');
  });

  it('flags credentials before the host as dangerous', () => {
    const result = analyzeQrContent('https://accounts.google.com@evil.example/login');
    expect(result.verdict).toBe('danger');
    expect(result.url?.host).toBe('evil.example');
  });

  it('flags plain http', () => {
    const result = analyzeQrContent('http://example.com');
    expect(result.verdict).toBe('caution');
    expect(ids('http://example.com')).toContain('insecure-http');
  });

  it('flags a raw IP host and an odd port', () => {
    const found = ids('http://192.168.4.20:8081/pay');
    expect(found).toContain('ip-host');
    expect(found).toContain('odd-port');
  });

  it('flags punycode hosts and shows the decoded form', () => {
    const result = analyzeQrContent('https://xn--pple-43d.com/');
    expect(result.verdict).toBe('danger');
    expect(result.url?.displayHost).toBe('аpple.com');
  });

  it("flags a brand name on someone else's domain", () => {
    expect(ids('https://paypal.com.secure-check.xyz/login')).toContain('brand-lookalike');
    expect(ids('https://paypal-login.example.com')).toContain('brand-lookalike');
  });

  it('does not flag the real brand domain or an innocent substring', () => {
    expect(ids('https://www.paypal.com/signin')).not.toContain('brand-lookalike');
    expect(ids('https://pineapple-shop.com')).not.toContain('brand-lookalike');
    expect(ids('https://smile.amazon.co.uk')).not.toContain('brand-lookalike');
  });

  it('notes risky TLDs and tracking parameters', () => {
    const found = ids('https://example.zip/?utm_source=qr&fbclid=abc');
    expect(found).toContain('risky-tld');
    expect(found).toContain('tracking');
  });

  it('lists tracking parameters without changing the verdict', () => {
    const result = analyzeQrContent('https://example.com/?utm_source=poster&utm_medium=qr');
    expect(result.verdict).toBe('direct');
    expect(result.url?.trackingParams).toEqual(['utm_source', 'utm_medium']);
  });

  it('flags an opaque short path on a small host', () => {
    expect(ids('https://go.acme.co/a1B2c3')).toContain('opaque-path');
  });

  it('puts the most severe finding first', () => {
    const [first] = analyzeQrContent('http://user@qrco.de/x1y2').findings;
    expect(first.severity).toBe('danger');
  });
});

describe('analyzeQrContent — other content', () => {
  it('recognises a bare domain as a link and notes the missing scheme', () => {
    const result = analyzeQrContent('example.com/menu');
    expect(result.kind).toBe('url');
    expect(ids('example.com/menu')).toContain('no-scheme');
  });

  it('reports Wi-Fi codes as not a link', () => {
    const result = analyzeQrContent('WIFI:T:WPA;S:Cafe;P:secret;;');
    expect(result.kind).toBe('wifi');
    expect(result.url).toBeNull();
  });

  it('warns on payment and OTP codes', () => {
    expect(analyzeQrContent('upi://pay?pa=a@b&am=10').verdict).toBe('caution');
    expect(analyzeQrContent('otpauth://totp/Acme:me?secret=ABC').kind).toBe('otp');
  });

  it('surfaces a link buried in free text', () => {
    const text = 'Win a prize! Claim at https://claim.example.xyz now';
    expect(analyzeQrContent(text).kind).toBe('text');
    expect(ids(text)).toContain('url-in-text');
  });

  it('handles plain text and empty-ish input', () => {
    expect(analyzeQrContent('hello there').verdict).toBe('not-link');
    expect(analyzeQrContent('   ').verdict).toBe('not-link');
  });

  it('treats a non-web app scheme as caution', () => {
    expect(analyzeQrContent('intent://scan/#Intent;scheme=zxing;end').verdict).toBe('caution');
  });

  it('survives a very long URL and flags its length', () => {
    const long = `https://example.com/?x=${'a'.repeat(5000)}`;
    expect(analyzeQrContent(long).findings.map((f) => f.id)).toContain('long-url');
  });

  it('does not throw on malformed percent escapes', () => {
    expect(() => analyzeQrContent('https://example.com/?url=%E0%A4%A')).not.toThrow();
  });
});

describe('helpers', () => {
  it('detects kinds', () => {
    expect(detectKind('https://a.b')).toBe('url');
    expect(detectKind('mailto:a@b.co')).toBe('email');
    expect(detectKind('BEGIN:VCARD\nVERSION:3.0')).toBe('contact');
    expect(detectKind('geo:37.78,-122.41')).toBe('geo');
    expect(detectKind('just words')).toBe('text');
  });

  it('computes registrable domains', () => {
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('localhost')).toBe('localhost');
  });

  it('decodes punycode, including the RFC 3492 sample and invalid input', () => {
    expect(decodePunycodeLabel('bcher-kva')).toBe('bücher');
    expect(decodePunycodeLabel('egbpdaj6bu4bxfgehfvwxn')).toBe('ليهمابتكلموشعربي؟');
    expect(decodePunycodeLabel('!!!')).toBeNull();
    expect(toDisplayHost('xn--bcher-kva.example')).toBe('bücher.example');
    expect(toDisplayHost('example.com')).toBe('example.com');
  });

  it('finds embedded destinations only for redirect-like parameters', () => {
    expect(findEmbeddedDestination(new URL('https://a.example/?ref=https://b.example'))).toBeNull();
    expect(findEmbeddedDestination(new URL('https://a.example/?redirect=https://b.example/x'))?.url).toBe('https://b.example/x');
    expect(findEmbeddedDestination(new URL('https://a.example/?url=notaurl'))).toBeNull();
  });
});

describe('compareToIntended', () => {
  const direct = analyzeQrContent('https://example.com/menu?utm_source=qr');

  it('returns null when nothing was entered', () => {
    expect(compareToIntended(direct, '   ')).toBeNull();
  });

  it('matches the same domain regardless of www and scheme', () => {
    expect(compareToIntended(direct, 'www.example.com')?.match).toBe('exact');
  });

  it('matches an exact path, ignoring tracking parameters and trailing slash', () => {
    expect(compareToIntended(direct, 'https://example.com/menu/')?.match).toBe('exact');
  });

  it('flags the right domain with a different page', () => {
    expect(compareToIntended(direct, 'https://example.com/pricing')?.match).toBe('same-site');
  });

  it('flags a different domain', () => {
    const result = compareToIntended(analyzeQrContent('https://qrco.de/abc123'), 'https://acme-bakery.com');
    expect(result?.match).toBe('different');
    expect(result?.message).toMatch(/redirect/);
  });

  it('recognises the intended site reached through a redirect', () => {
    const redirected = analyzeQrContent('https://tracker.example.net/go?url=https%3A%2F%2Facme.com%2Fdeal');
    expect(compareToIntended(redirected, 'https://acme.com')?.match).toBe('via-redirect');
  });

  it('treats a sibling subdomain as the same organisation', () => {
    expect(compareToIntended(analyzeQrContent('https://pay.example.com'), 'https://www.example.com')?.match).toBe('same-site');
  });

  it('rejects an intended address that is not a URL', () => {
    expect(compareToIntended(direct, 'not a url')?.match).toBe('invalid-intended');
  });

  it('says a non-link code cannot match', () => {
    expect(compareToIntended(analyzeQrContent('hello'), 'https://example.com')?.match).toBe('different');
  });
});
