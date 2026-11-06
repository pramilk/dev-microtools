import { describe, it, expect } from 'vitest';
import {
  analyzePhishingEmail,
  decodeEncodedWords,
  formatReport,
  scoreFindings,
  MAX_INPUT_CHARS,
  type PhishingAnalysis,
} from './phishingEmail';

function analyze(input: string): PhishingAnalysis {
  const result = analyzePhishingEmail(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const ids = (analysis: PhishingAnalysis): string[] => analysis.findings.map((f) => f.id);

const PHISHING = [
  'From: "PayPal Support" <service@paypa1-secure.top>',
  'Reply-To: helpdesk@mail-recovery.example',
  'Return-Path: <bounce@mailer.example.net>',
  'To: you@example.com',
  'Subject: Urgent: your account has been suspended',
  'Date: Tue, 03 Nov 2026 08:14:09 +0000',
  'Message-ID: <8841.2210@mailer.example.net>',
  'Authentication-Results: mx.example.com; spf=fail smtp.mailfrom=mailer.example.net; dkim=none; dmarc=fail header.from=paypa1-secure.top',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Dear customer,</p>',
  '<p>We detected unauthorized activity. Your account will be closed within 24 hours unless you verify your password immediately.</p>',
  '<p><a href="http://198.51.100.7/login">https://www.paypal.com/verify</a></p>',
].join('\n');

const LEGIT = [
  'From: Jane Doe <jane@acme-bakery.com>',
  'To: you@example.com',
  'Subject: Lunch on Thursday?',
  'Date: Mon, 02 Nov 2026 10:00:00 +0000',
  'Message-ID: <abc123@acme-bakery.com>',
  'Authentication-Results: mx.example.com; spf=pass smtp.mailfrom=acme-bakery.com; dkim=pass header.d=acme-bakery.com; dmarc=pass header.from=acme-bakery.com',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi, are you free for lunch on Thursday? The new menu is at https://acme-bakery.com/menu.',
].join('\n');

describe('analyzePhishingEmail — input handling', () => {
  it('returns an error for empty or whitespace-only input', () => {
    expect(analyzePhishingEmail('')).toEqual({ ok: false, error: expect.stringMatching(/paste the email/i) });
    expect(analyzePhishingEmail('  \n\t ').ok).toBe(false);
  });

  it('flags a realistic phishing email as high risk', () => {
    const analysis = analyze(PHISHING);
    expect(analysis.level).toBe('high');
    expect(ids(analysis)).toEqual(
      expect.arrayContaining([
        'display-name-brand',
        'reply-to-mismatch',
        'spf-fail',
        'dmarc-fail',
        'link-text-mismatch',
        'link-ip-host',
        'threat',
        'credentials',
        'pressure-and-credentials',
      ])
    );
    expect(analysis.score).toBe(100);
  });

  it('gives a legitimate message a low score and passing authentication', () => {
    const analysis = analyze(LEGIT);
    expect(analysis.level).toBe('low');
    expect(ids(analysis)).toEqual(expect.arrayContaining(['spf-pass', 'dkim-pass', 'dmarc-pass']));
    expect(analysis.findings.some((f) => f.severity === 'danger' || f.severity === 'warning')).toBe(false);
  });

  it('never calls a clean result "safe"', () => {
    const analysis = analyze(LEGIT);
    expect(analysis.headline).not.toMatch(/\bsafe\b/i);
    expect(analysis.summary).toMatch(/not a guarantee/i);
  });

  it('handles Windows line endings', () => {
    expect(analyze(PHISHING.replace(/\n/g, '\r\n')).level).toBe('high');
  });

  it('analyses a body with no headers and says the sender checks were skipped', () => {
    const analysis = analyze('Dear customer, verify your password immediately at https://bit.ly/3xyz');
    expect(analysis.message.hasHeaders).toBe(false);
    expect(ids(analysis)).toEqual(expect.arrayContaining(['no-headers', 'link-shortener', 'credentials']));
    expect(analysis.hops).toEqual([]);
  });

  it('analyses headers with no body', () => {
    const analysis = analyze('From: "PayPal" <x@evil.example>\nSubject: hi\n');
    expect(ids(analysis)).toContain('display-name-brand');
  });

  it('does not throw on garbage input', () => {
    expect(() => analyze('\u0000\u0001<<<>>>=?=??=')).not.toThrow();
    expect(() => analyze(':::\n\n\n====')).not.toThrow();
  });

  it('truncates very large input with a visible note instead of hanging', () => {
    const big = `From: a@b.example\nSubject: x\n\n${'<a href="http://x.example/">'.repeat(1) + 'lorem ipsum '.repeat(MAX_INPUT_CHARS / 10)}`;
    const started = Date.now();
    const analysis = analyze(big);
    expect(ids(analysis)).toContain('input-truncated');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stays fast on many unclosed anchors (no quadratic scan)', () => {
    const html = `Content-Type: text/html\n\n${'<a href="http://a.example/">x '.repeat(20000)}`;
    const started = Date.now();
    analyze(html);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('sender checks', () => {
  it('flags a display name that shows a different email address', () => {
    const analysis = analyze('From: "support@paypal.com" <x@evil.example>\nSubject: hi\n');
    expect(ids(analysis)).toContain('display-name-address');
  });

  it('does not flag a display name address that matches the real domain', () => {
    const analysis = analyze('From: "jane@acme.com" <jane@acme.com>\nSubject: hi\n');
    expect(ids(analysis)).not.toContain('display-name-address');
  });

  it('matches brands on whole words only', () => {
    expect(ids(analyze('From: "Pineapple Co" <hi@pineapple.example>\nSubject: hi\n'))).not.toContain('display-name-brand');
    expect(ids(analyze('From: "Bank of America" <hi@evil.example>\nSubject: hi\n'))).toContain('display-name-brand');
  });

  it('accepts the brand display name when the domain really is the brand', () => {
    const analysis = analyze('From: "PayPal" <service@mail.paypal.com>\nSubject: Receipt\n');
    expect(ids(analysis)).not.toContain('display-name-brand');
  });

  it('notes the free webmail provider when a brand name is spoofed from one', () => {
    const analysis = analyze('From: "Microsoft Security" <alerts@gmail.com>\nSubject: hi\n');
    const item = analysis.findings.find((f) => f.id === 'display-name-brand');
    expect(item?.detail).toMatch(/free webmail/i);
  });

  it('flags a punycode sender domain', () => {
    const analysis = analyze('From: <info@xn--pypal-4ve.com>\nSubject: hi\n');
    expect(ids(analysis)).toContain('from-domain-punycode');
  });

  it('flags a look-alike sender domain', () => {
    expect(ids(analyze('From: <a@paypal-login.example>\nSubject: hi\n'))).toContain('from-domain-lookalike');
  });

  it('flags a fake reply thread', () => {
    expect(ids(analyze('From: <a@acme.com>\nSubject: Re: invoice\n'))).toContain('fake-reply');
    expect(ids(analyze('From: <a@acme.com>\nSubject: Re: invoice\nIn-Reply-To: <1@acme.com>\n'))).not.toContain('fake-reply');
  });

  it('flags a Date far in the future', () => {
    expect(ids(analyze('From: <a@acme.com>\nSubject: x\nDate: Mon, 01 Jan 2999 00:00:00 +0000\n'))).toContain('date-future');
  });

  it('reports a missing From address', () => {
    expect(ids(analyze('Subject: nothing\nTo: you@example.com\n'))).toContain('from-missing');
  });

  it('decodes RFC 2047 encoded display names and subjects', () => {
    const analysis = analyze('From: =?UTF-8?B?UGF5UGFs?= <x@evil.example>\nSubject: =?UTF-8?Q?Caf=C3=A9_menu?=\n');
    expect(analysis.message.from?.displayName).toBe('PayPal');
    expect(analysis.message.subject).toBe('Café menu');
    expect(ids(analysis)).toContain('display-name-brand');
  });
});

describe('decodeEncodedWords', () => {
  it('decodes base64 and quoted-printable words', () => {
    expect(decodeEncodedWords('=?utf-8?B?SGVsbG8=?=')).toBe('Hello');
    expect(decodeEncodedWords('=?utf-8?Q?a_b=21?=')).toBe('a b!');
  });
  it('joins adjacent encoded words and leaves plain text alone', () => {
    expect(decodeEncodedWords('=?utf-8?Q?foo?= =?utf-8?Q?bar?=')).toBe('foobar');
    expect(decodeEncodedWords('plain')).toBe('plain');
  });
  it('survives an unknown charset', () => {
    expect(decodeEncodedWords('=?x-nope?Q?hi?=')).toBe('hi');
  });
});

describe('authentication', () => {
  const base = (auth: string) => `From: <a@acme.com>\nSubject: x\nMessage-ID: <1@acme.com>\nAuthentication-Results: mx; ${auth}\n`;

  it('flags SPF softfail as a warning and DKIM fail', () => {
    const analysis = analyze(base('spf=softfail; dkim=fail; dmarc=none'));
    expect(ids(analysis)).toEqual(expect.arrayContaining(['spf-softfail', 'dkim-fail', 'dmarc-other']));
  });

  it('prefers a passing DKIM signature over a failing one', () => {
    expect(analyze(base('dkim=fail; dkim=pass')).auth.dkim).toBe('pass');
  });

  it('reads Received-SPF when there is no Authentication-Results', () => {
    const analysis = analyze('From: <a@acme.com>\nSubject: x\nMessage-ID: <1@acme.com>\nReceived-SPF: fail (domain does not designate)\n');
    expect(analysis.auth.spf).toBe('fail');
    expect(ids(analysis)).toContain('spf-fail');
  });

  it('notes when authentication results are missing from the headers', () => {
    expect(ids(analyze('From: <a@acme.com>\nSubject: x\nMessage-ID: <1@acme.com>\n'))).toContain('auth-missing');
  });
});

describe('links', () => {
  const html = (body: string) => `Content-Type: text/html\n\n${body}`;

  it('flags link text that names another domain, as danger when it is a known brand', () => {
    const analysis = analyze(html('<a href="https://evil.example/x">www.paypal.com</a>'));
    const item = analysis.findings.find((f) => f.id === 'link-text-mismatch');
    expect(item?.severity).toBe('danger');
  });

  it('treats a non-brand text/href mismatch as a warning', () => {
    const item = analyze(html('<a href="https://tracker.example/x">www.acme-shop.com</a>')).findings.find((f) => f.id === 'link-text-mismatch');
    expect(item?.severity).toBe('warning');
  });

  it('does not flag a matching link, or a filename that merely looks like a domain', () => {
    expect(ids(analyze(html('<a href="https://acme.com/a">https://www.acme.com/a</a>')))).not.toContain('link-text-mismatch');
    expect(ids(analyze(html('<a href="https://acme.com/a">invoice.pdf</a>')))).not.toContain('link-text-mismatch');
  });

  it('decodes HTML entities in hrefs', () => {
    const analysis = analyze(html('<a href="https://acme.com/?a=1&amp;b=2">go</a>'));
    expect(analysis.links[0].href).toBe('https://acme.com/?a=1&b=2');
  });

  it('flags dangerous schemes, credentials, punycode and shorteners', () => {
    const analysis = analyze(
      html(
        '<a href="javascript:alert(1)">a</a> <a href="https://paypal.com@evil.example/">b</a> <a href="https://xn--pypal-4ve.com/">c</a> <a href="https://bit.ly/abc">d</a>'
      )
    );
    expect(ids(analysis)).toEqual(
      expect.arrayContaining(['link-dangerous-scheme', 'link-credentials', 'link-punycode', 'link-shortener'])
    );
  });

  it('flags a hidden redirect to a different site', () => {
    const analysis = analyze(html('<a href="https://acme.com/r?url=https%3A%2F%2Fevil.example%2Fx">go</a>'));
    expect(ids(analysis)).toContain('link-embedded-redirect');
  });

  it('extracts bare URLs from plain text and strips trailing punctuation', () => {
    const analysis = analyze('Visit https://acme.com/menu.');
    expect(analysis.links.map((l) => l.href)).toEqual(['https://acme.com/menu']);
  });

  it('ignores mailto and tel links', () => {
    expect(analyze(html('<a href="mailto:a@b.com">mail</a><a href="tel:123">call</a>')).links).toEqual([]);
  });

  it('caps the number of links analysed', () => {
    const many = Array.from({ length: 150 }, (_, i) => `https://h${i}.example/`).join(' ');
    const analysis = analyze(many);
    expect(analysis.links.length).toBe(100);
    expect(ids(analysis)).toContain('links-truncated');
  });

  it('handles Unicode in link text without error', () => {
    expect(() => analyze(html('<a href="https://acme.com/">🔒 Zahlung bestätigen — 確認</a>'))).not.toThrow();
  });
});

describe('MIME decoding', () => {
  it('decodes a quoted-printable HTML part', () => {
    const analysis = analyze(
      'From: <a@acme.com>\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n<a href=3D"https://evil.example/x">www.paypal.com</a>'
    );
    expect(ids(analysis)).toContain('link-text-mismatch');
  });

  it('decodes a base64 text part', () => {
    const body = btoa('Dear customer, verify your password immediately.');
    const analysis = analyze(`From: <a@acme.com>\nContent-Type: text/plain\nContent-Transfer-Encoding: base64\n\n${body}`);
    expect(ids(analysis)).toContain('credentials');
  });

  it('walks a multipart/alternative message and reports attachments', () => {
    const raw = [
      'From: <a@acme.com>',
      'Content-Type: multipart/mixed; boundary="BOUND"',
      '',
      '--BOUND',
      'Content-Type: text/plain',
      '',
      'See attached invoice.',
      '--BOUND',
      'Content-Type: application/octet-stream; name="invoice.pdf.exe"',
      'Content-Disposition: attachment; filename="invoice.pdf.exe"',
      'Content-Transfer-Encoding: base64',
      '',
      'TVqQAAMAAAAEAAAA',
      '--BOUND--',
    ].join('\n');
    const analysis = analyze(raw);
    expect(analysis.attachments).toHaveLength(1);
    expect(analysis.attachments[0].severity).toBe('danger');
    expect(analysis.attachments[0].reason).toMatch(/double extension/i);
  });

  it('keeps going when a charset or base64 payload is invalid', () => {
    expect(() => analyze('From: <a@b.com>\nContent-Type: text/plain; charset=x-bogus\nContent-Transfer-Encoding: base64\n\n!!!!')).not.toThrow();
  });
});

describe('attachments', () => {
  const withAttachment = (name: string) =>
    `From: <a@acme.com>\nContent-Type: multipart/mixed; boundary=B\n\n--B\nContent-Type: text/plain\n\nhi\n--B\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename="${name}"\n\nxx\n--B--`;

  it.each([
    ['setup.exe', 'danger'],
    ['page.html', 'warning'],
    ['macro.docm', 'warning'],
    ['files.zip', 'info'],
    ['report.pdf', 'ok'],
  ])('rates %s as %s', (name, severity) => {
    expect(analyze(withAttachment(name)).attachments[0].severity).toBe(severity);
  });

  it('flags a right-to-left override in the file name', () => {
    expect(analyze(withAttachment('invoice‮fdp.exe')).attachments[0].severity).toBe('danger');
  });

  it('flags an HTML double extension as danger', () => {
    expect(analyze(withAttachment('statement.pdf.html')).attachments[0].severity).toBe('danger');
  });
});

describe('content and routing', () => {
  it('flags an embedded form and a tracking pixel', () => {
    const analysis = analyze('Content-Type: text/html\n\n<form action="x"><input name="pw"></form><img src="http://t.example/p.gif" width="1" height="1">');
    expect(ids(analysis)).toEqual(expect.arrayContaining(['html-form', 'tracking-pixel']));
  });

  it('flags secrecy and money language', () => {
    const analysis = analyze('Please buy gift cards today and do not tell anyone.');
    expect(ids(analysis)).toEqual(expect.arrayContaining(['money', 'secrecy']));
  });

  it('lists received hops oldest first with IPs', () => {
    const analysis = analyze(
      [
        'From: <a@acme.com>',
        'Received: from mx2.example.net (mx2.example.net [203.0.113.9]) by inbox.example.com; Tue, 3 Nov 2026 08:14:12 +0000',
        'Received: from [10.0.0.5] by mx2.example.net; Tue, 3 Nov 2026 08:14:10 +0000',
        'Subject: x',
      ].join('\n')
    );
    expect(analysis.hops).toHaveLength(2);
    expect(analysis.hops[0].by).toBe('mx2.example.net');
    expect(analysis.hops[1].ip).toBe('203.0.113.9');
  });
});

describe('scoring and report', () => {
  it('maps scores to levels', () => {
    expect(scoreFindings([]).level).toBe('low');
    expect(scoreFindings([{ severity: 'danger', id: 'a', category: 'links', title: '', detail: '' }]).level).toBe('elevated');
    expect(
      scoreFindings([
        { severity: 'danger', id: 'a', category: 'links', title: '', detail: '' },
        { severity: 'danger', id: 'b', category: 'links', title: '', detail: '' },
      ]).level
    ).toBe('high');
  });

  it('caps the score at 100', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ severity: 'danger' as const, id: `d${i}`, category: 'links' as const, title: '', detail: '' }));
    expect(scoreFindings(many).score).toBe(100);
  });

  it('formats a plain-text report', () => {
    const report = formatReport(analyze(PHISHING));
    expect(report).toMatch(/risk score 100\/100/);
    expect(report).toMatch(/\[DANGER\] SPF failed/);
    expect(report).toMatch(/Subject: Urgent/);
  });
});
