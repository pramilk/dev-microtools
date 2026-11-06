import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOTP_SETTINGS,
  buildOtpauthUri,
  codeWindow,
  counterAt,
  generateSecret,
  hotp,
  parseOtpauthUri,
  parseSecret,
  secondsRemaining,
  totp,
  validateCode,
  validatePeriod,
  type TotpSettings,
} from './totp';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

// RFC 4226 / RFC 6238 appendix test secrets (ASCII digits repeated to the hash's key length).
const SECRET_SHA1 = ascii('12345678901234567890');
const SECRET_SHA256 = ascii('12345678901234567890123456789012');
const SECRET_SHA512 = ascii('1234567890123456789012345678901234567890123456789012345678901234');

const eight = (algorithm: TotpSettings['algorithm']): TotpSettings => ({ algorithm, digits: 8, period: 30 });

describe('hotp — RFC 4226 appendix D vectors', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it.each(expected.map((code, counter) => [counter, code] as const))('counter %i → %s', async (counter, code) => {
    expect(await hotp(SECRET_SHA1, counter)).toBe(code);
  });
});

describe('totp — RFC 6238 appendix B vectors', () => {
  const vectors: Array<[number, string, string, string]> = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];

  it.each(vectors)('T=%i matches SHA-1, SHA-256 and SHA-512', async (seconds, sha1, sha256, sha512) => {
    expect(await totp(SECRET_SHA1, seconds * 1000, eight('SHA-1'))).toBe(sha1);
    expect(await totp(SECRET_SHA256, seconds * 1000, eight('SHA-256'))).toBe(sha256);
    expect(await totp(SECRET_SHA512, seconds * 1000, eight('SHA-512'))).toBe(sha512);
  });

  it('keeps leading zeros', async () => {
    expect(await totp(SECRET_SHA1, 1111111109 * 1000, eight('SHA-1'))).toMatch(/^0/);
  });

  it('supports 6 and 7 digit codes as the trailing digits of the 8-digit code', async () => {
    const six = await totp(SECRET_SHA1, 59_000, { algorithm: 'SHA-1', digits: 6, period: 30 });
    const seven = await totp(SECRET_SHA1, 59_000, { algorithm: 'SHA-1', digits: 7, period: 30 });
    expect(six).toBe('287082');
    expect(seven).toBe('4287082');
  });

  it('honours a custom period', async () => {
    const at60 = await totp(SECRET_SHA1, 60_000, { algorithm: 'SHA-1', digits: 6, period: 60 });
    const at119 = await totp(SECRET_SHA1, 119_000, { algorithm: 'SHA-1', digits: 6, period: 60 });
    const at120 = await totp(SECRET_SHA1, 120_000, { algorithm: 'SHA-1', digits: 6, period: 60 });
    expect(at60).toBe(at119);
    expect(at120).not.toBe(at119);
  });
});

describe('time helpers', () => {
  it('computes the counter and seconds remaining', () => {
    expect(counterAt(59_000, 30)).toBe(1);
    expect(counterAt(60_000, 30)).toBe(2);
    expect(secondsRemaining(0, 30)).toBe(30);
    expect(secondsRemaining(29_000, 30)).toBe(1);
    expect(secondsRemaining(30_000, 30)).toBe(30);
  });
});

describe('codeWindow and validateCode', () => {
  const now = 1_700_000_000_000;

  it('returns the previous, current and next codes', async () => {
    const window = await codeWindow(SECRET_SHA1, now, DEFAULT_TOTP_SETTINGS);
    expect(window.ok).toBe(true);
    if (window.ok) {
      expect(new Set([window.value.previous, window.value.current, window.value.next]).size).toBe(3);
      expect(window.value.current).toBe(await totp(SECRET_SHA1, now));
    }
  });

  it('accepts the current, previous and next codes and reports the offset', async () => {
    const codes = await codeWindow(SECRET_SHA1, now, DEFAULT_TOTP_SETTINGS);
    if (!codes.ok) throw new Error(codes.error);
    expect(await validateCode(SECRET_SHA1, codes.value.current, now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: true, value: { valid: true, offset: 0 } });
    expect(await validateCode(SECRET_SHA1, codes.value.previous, now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: true, value: { valid: true, offset: -1 } });
    expect(await validateCode(SECRET_SHA1, codes.value.next, now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: true, value: { valid: true, offset: 1 } });
  });

  it('rejects a code outside the window', async () => {
    const old = await totp(SECRET_SHA1, now - 5 * 30_000);
    expect(await validateCode(SECRET_SHA1, old, now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: true, value: { valid: false, offset: null } });
  });

  it('widens the accepted window when asked', async () => {
    const old = await totp(SECRET_SHA1, now - 3 * 30_000);
    const result = await validateCode(SECRET_SHA1, old, now, DEFAULT_TOTP_SETTINGS, 4);
    expect(result).toEqual({ ok: true, value: { valid: true, offset: -3 } });
  });

  it('ignores spaces in the entered code', async () => {
    const code = await totp(SECRET_SHA1, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    const result = await validateCode(SECRET_SHA1, spaced, now, DEFAULT_TOTP_SETTINGS);
    expect(result.ok && result.value.valid).toBe(true);
  });

  it('explains empty, non-numeric and wrong-length codes', async () => {
    expect(await validateCode(SECRET_SHA1, '', now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: false, error: expect.stringMatching(/enter the code/i) });
    expect(await validateCode(SECRET_SHA1, '12ab56', now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: false, error: expect.stringMatching(/digits only/i) });
    expect(await validateCode(SECRET_SHA1, '12345', now, DEFAULT_TOTP_SETTINGS)).toEqual({ ok: false, error: expect.stringMatching(/6 digits/i) });
  });

  it('does not go below counter zero near the epoch', async () => {
    const result = await codeWindow(SECRET_SHA1, 0, DEFAULT_TOTP_SETTINGS);
    expect(result.ok).toBe(true);
  });
});

describe('parseSecret', () => {
  it('decodes the RFC test secret from base32 regardless of case, spaces and dashes', () => {
    const base32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    for (const variant of [base32, base32.toLowerCase(), 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ', 'GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ']) {
      const parsed = parseSecret(variant);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(Array.from(parsed.value.bytes)).toEqual(Array.from(SECRET_SHA1));
    }
  });

  it('accepts trailing padding', () => {
    expect(parseSecret('GEZDGNBVGY3TQOJQ====').ok).toBe(true);
  });

  it('errors on empty input', () => {
    expect(parseSecret('  ')).toEqual({ ok: false, error: expect.stringMatching(/enter a base32 secret/i) });
  });

  it('names the offending character and hints at look-alikes', () => {
    const result = parseSecret('GEZDGNBVGY3TQOJ0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"0"');
      expect(result.error).toMatch(/no 0, 1 or 8/i);
    }
  });

  it('warns, without failing, when the secret is shorter than 128 bits', () => {
    const parsed = parseSecret('JBSWY3DP');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.weakWarning).toMatch(/128 bits/);
  });

  it('does not warn about a recommended-length secret', () => {
    const parsed = parseSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(parsed.ok && parsed.value.weakWarning).toBeNull();
  });

  it('rejects an absurdly long secret', () => {
    expect(parseSecret('A'.repeat(5000)).ok).toBe(false);
  });
});

describe('generateSecret', () => {
  it('produces a parseable, grouped secret of the recommended length', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
    const parsed = parseSecret(secret);
    expect(parsed.ok && parsed.value.bytes.length).toBe(20);
  });

  it('is different every time', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe('validatePeriod', () => {
  it('accepts sensible periods and rejects the rest', () => {
    expect(validatePeriod(30).ok).toBe(true);
    expect(validatePeriod(4).ok).toBe(false);
    expect(validatePeriod(301).ok).toBe(false);
    expect(validatePeriod(30.5).ok).toBe(false);
  });
});

describe('otpauth URIs', () => {
  const fields = { ...DEFAULT_TOTP_SETTINGS, secret: 'JBSW Y3DP EHPK 3PXP', issuer: 'Example Co', account: 'alice@example.com' };

  it('builds a URI authenticator apps accept', () => {
    const built = buildOtpauthUri(fields);
    expect(built).toEqual({
      ok: true,
      value: 'otpauth://totp/Example%20Co:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Co&algorithm=SHA1&digits=6&period=30',
    });
  });

  it('round-trips through the parser', () => {
    const built = buildOtpauthUri({ ...fields, algorithm: 'SHA-256', digits: 8, period: 60 });
    if (!built.ok) throw new Error(built.error);
    const parsed = parseOtpauthUri(built.value);
    expect(parsed).toEqual({
      ok: true,
      value: { secret: 'JBSWY3DPEHPK3PXP', issuer: 'Example Co', account: 'alice@example.com', algorithm: 'SHA-256', digits: 8, period: 60 },
    });
  });

  it('works without an issuer', () => {
    const built = buildOtpauthUri({ ...fields, issuer: '' });
    expect(built.ok && built.value).toMatch(/^otpauth:\/\/totp\/alice%40example\.com\?secret=/);
  });

  it('requires an account or issuer, and rejects colons', () => {
    expect(buildOtpauthUri({ ...fields, issuer: '', account: '' }).ok).toBe(false);
    expect(buildOtpauthUri({ ...fields, account: 'a:b' }).ok).toBe(false);
  });

  it('rejects an invalid secret or period', () => {
    expect(buildOtpauthUri({ ...fields, secret: 'not base32!' }).ok).toBe(false);
    expect(buildOtpauthUri({ ...fields, period: 1 }).ok).toBe(false);
  });

  it('encodes Unicode in labels', () => {
    const built = buildOtpauthUri({ ...fields, issuer: 'Café ☕', account: 'zoë' });
    if (!built.ok) throw new Error(built.error);
    const parsed = parseOtpauthUri(built.value);
    expect(parsed.ok && parsed.value.issuer).toBe('Café ☕');
    expect(parsed.ok && parsed.value.account).toBe('zoë');
  });

  it('parses a typical link from an authenticator export, defaulting the optional parameters', () => {
    const parsed = parseOtpauthUri('otpauth://totp/GitHub:octocat?secret=jbswy3dpehpk3pxp&issuer=GitHub');
    expect(parsed).toEqual({
      ok: true,
      value: { secret: 'JBSWY3DPEHPK3PXP', issuer: 'GitHub', account: 'octocat', algorithm: 'SHA-1', digits: 6, period: 30 },
    });
  });

  it('explains common problems with a pasted link', () => {
    expect(parseOtpauthUri('hello')).toEqual({ ok: false, error: expect.stringMatching(/not a valid otpauth/i) });
    expect(parseOtpauthUri('https://example.com')).toEqual({ ok: false, error: expect.stringMatching(/not an otpauth/i) });
    expect(parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DP&counter=1')).toEqual({ ok: false, error: expect.stringMatching(/HOTP/) });
    expect(parseOtpauthUri('otpauth://totp/x')).toEqual({ ok: false, error: expect.stringMatching(/no secret/i) });
    expect(parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&algorithm=MD5')).toEqual({ ok: false, error: expect.stringMatching(/not supported/i) });
    expect(parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&digits=9')).toEqual({ ok: false, error: expect.stringMatching(/6, 7 or 8/) });
  });
});
