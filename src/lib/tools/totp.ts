/**
 * Time-based one-time passwords (RFC 6238) over HMAC-based OTPs (RFC 4226), using only the
 * browser's `SubtleCrypto`. No dependency, and the shared secret never leaves the page.
 *
 * Every function that depends on the clock takes the time as an argument, so tests can pin it
 * to the RFC 6238 test vectors instead of racing the wall clock.
 */
import { type ToolResult, ok, err, messageFrom } from './result';
import { decodeBase32ToBytes, encodeBytesToBase32 } from './base32';

export const TOTP_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

export const TOTP_DIGITS = [6, 7, 8] as const;
export type TotpDigits = (typeof TOTP_DIGITS)[number];

export interface TotpSettings {
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  /** Seconds each code lives for. */
  period: number;
}

export const DEFAULT_TOTP_SETTINGS: TotpSettings = { algorithm: 'SHA-1', digits: 6, period: 30 };

export const MIN_PERIOD = 5;
export const MAX_PERIOD = 300;
/** RFC 4226 §4 requires at least 128 bits; 160 is the recommended length. */
export const MIN_SECRET_BYTES = 10;
export const RECOMMENDED_SECRET_BYTES = 20;
const MAX_SECRET_BYTES = 1024;

const HMAC_NAMES: Record<TotpAlgorithm, string> = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-512': 'SHA-512' };

// --- Secrets ------------------------------------------------------------------------

export interface ParsedSecret {
  bytes: Uint8Array;
  /** Set when the secret decodes but is shorter than the 128 bits RFC 4226 requires. */
  weakWarning: string | null;
}

/** Reads a base32 secret the way authenticator apps do: ignores spaces, dashes and case. */
export function parseSecret(input: string): ToolResult<ParsedSecret> {
  const cleaned = input.replace(/[\s-]+/g, '');
  if (cleaned === '') return err('Enter a base32 secret, or generate one.');

  const invalid = /[^A-Za-z2-7=]/.exec(cleaned);
  if (invalid) {
    const hint = /[018]/.test(invalid[0])
      ? ' Base32 has no 0, 1 or 8, so check for a look-alike letter such as O, I or B.'
      : '';
    return err(`"${invalid[0]}" is not valid in a base32 secret (letters A–Z and digits 2–7 only).${hint}`);
  }

  const decoded = decodeBase32ToBytes(cleaned);
  if (!decoded.ok) return decoded;
  if (decoded.value.length === 0) return err('That secret is too short to decode.');
  if (decoded.value.length > MAX_SECRET_BYTES) return err(`That secret is too long (limit ${MAX_SECRET_BYTES} bytes).`);

  return ok({
    bytes: decoded.value,
    weakWarning:
      decoded.value.length < MIN_SECRET_BYTES
        ? `This secret is only ${decoded.value.length * 8} bits. RFC 4226 requires at least 128 bits (26 base32 characters), and many authenticator apps reject shorter ones.`
        : null,
  });
}

/** A fresh random secret as base32 in groups of four, e.g. `JBSW Y3DP EHPK 3PXP`. */
export function generateSecret(byteLength: number = RECOMMENDED_SECRET_BYTES): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  const encoded = encodeBytesToBase32(bytes, { padding: false });
  const text = encoded.ok ? encoded.value : '';
  return text.replace(/(.{4})(?=.)/g, '$1 ');
}

// --- Codes --------------------------------------------------------------------------

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  // Split into two 32-bit halves: a JS number is exact to 2^53, which covers any real counter.
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000));
  view.setUint32(4, counter >>> 0);
  return bytes;
}

/** RFC 4226 HOTP. Resolves to the zero-padded code. */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  settings: Pick<TotpSettings, 'algorithm' | 'digits'> = DEFAULT_TOTP_SETTINGS
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret as BufferSource,
    { name: 'HMAC', hash: HMAC_NAMES[settings.algorithm] },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter) as BufferSource));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** settings.digits).padStart(settings.digits, '0');
}

export const counterAt = (timeMs: number, period: number): number => Math.floor(timeMs / 1000 / period);

/** Seconds until the current code stops being valid (1 … period). */
export function secondsRemaining(timeMs: number, period: number): number {
  return period - (Math.floor(timeMs / 1000) % period);
}

export async function totp(secret: Uint8Array, timeMs: number, settings: TotpSettings = DEFAULT_TOTP_SETTINGS): Promise<string> {
  return hotp(secret, counterAt(timeMs, settings.period), settings);
}

export interface CodeWindow {
  previous: string;
  current: string;
  next: string;
}

export async function codeWindow(secret: Uint8Array, timeMs: number, settings: TotpSettings): Promise<ToolResult<CodeWindow>> {
  try {
    const counter = counterAt(timeMs, settings.period);
    const [previous, current, next] = await Promise.all([
      hotp(secret, Math.max(0, counter - 1), settings),
      hotp(secret, counter, settings),
      hotp(secret, counter + 1, settings),
    ]);
    return ok({ previous, current, next });
  } catch (error) {
    return err(messageFrom(error, 'This browser could not compute the code (the Web Crypto API is unavailable).'));
  }
}

export interface ValidationResult {
  valid: boolean;
  /** Steps away from "now" the match was found: 0 current, -1 previous, +1 next. */
  offset: number | null;
}

/**
 * Checks a code against the current step and `window` steps either side — servers allow a
 * little clock drift, and so does this. Compares every candidate so timing does not depend
 * on which one matched.
 */
export async function validateCode(
  secret: Uint8Array,
  code: string,
  timeMs: number,
  settings: TotpSettings,
  window = 1
): Promise<ToolResult<ValidationResult>> {
  const cleaned = code.replace(/\s+/g, '');
  if (cleaned === '') return err('Enter the code to check.');
  if (!/^\d+$/.test(cleaned)) return err('A code contains digits only.');
  if (cleaned.length !== settings.digits) {
    return err(`A code with these settings has ${settings.digits} digits, but ${cleaned.length} were entered.`);
  }

  try {
    const counter = counterAt(timeMs, settings.period);
    let found: number | null = null;
    for (let offset = -window; offset <= window; offset += 1) {
      const candidate = await hotp(secret, Math.max(0, counter + offset), settings);
      if (candidate === cleaned && found === null) found = offset;
    }
    return ok({ valid: found !== null, offset: found });
  } catch (error) {
    return err(messageFrom(error, 'This browser could not compute the code (the Web Crypto API is unavailable).'));
  }
}

// --- Settings validation ------------------------------------------------------------

export function validatePeriod(period: number): ToolResult<number> {
  if (!Number.isInteger(period)) return err('The period must be a whole number of seconds.');
  if (period < MIN_PERIOD || period > MAX_PERIOD) return err(`The period must be between ${MIN_PERIOD} and ${MAX_PERIOD} seconds.`);
  return ok(period);
}

// --- otpauth:// URIs ----------------------------------------------------------------

export interface OtpauthFields extends TotpSettings {
  /** Base32, no spaces. */
  secret: string;
  issuer: string;
  account: string;
}

const ALGORITHM_PARAM: Record<TotpAlgorithm, string> = { 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-512': 'SHA512' };

/** Builds the `otpauth://totp/...` URI authenticator apps read from a QR code. */
export function buildOtpauthUri(fields: OtpauthFields): ToolResult<string> {
  const secret = fields.secret.replace(/[\s-]+/g, '').toUpperCase().replace(/=+$/, '');
  const parsed = parseSecret(secret);
  if (!parsed.ok) return parsed;
  const period = validatePeriod(fields.period);
  if (!period.ok) return period;
  const issuer = fields.issuer.trim();
  const account = fields.account.trim();
  if (account === '' && issuer === '') {
    return err('Enter an account name or an issuer so the entry is recognisable in the app.');
  }
  if (issuer.includes(':') || account.includes(':')) {
    return err('The issuer and account name cannot contain a colon (":").');
  }

  const label = issuer ? `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` : encodeURIComponent(account);
  const query = [`secret=${secret}`];
  if (issuer) query.push(`issuer=${encodeURIComponent(issuer)}`);
  query.push(`algorithm=${ALGORITHM_PARAM[fields.algorithm]}`, `digits=${fields.digits}`, `period=${fields.period}`);
  return ok(`otpauth://totp/${label}?${query.join('&')}`);
}

/** Reads an `otpauth://totp/...` URI (as found in an authenticator's export or QR code). */
export function parseOtpauthUri(uri: string): ToolResult<OtpauthFields> {
  const text = uri.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return err('That is not a valid otpauth:// link.');
  }
  if (url.protocol !== 'otpauth:') return err('That is not an otpauth:// link.');
  if (url.hostname.toLowerCase() !== 'totp') {
    return err(
      url.hostname.toLowerCase() === 'hotp'
        ? 'This is a counter-based (HOTP) code, not a time-based one. This tool handles TOTP.'
        : 'Only otpauth://totp/ links are supported.'
    );
  }

  const secret = url.searchParams.get('secret');
  if (!secret) return err('The link has no secret= parameter.');

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const colon = rawLabel.indexOf(':');
  const labelIssuer = colon === -1 ? '' : rawLabel.slice(0, colon).trim();
  const account = (colon === -1 ? rawLabel : rawLabel.slice(colon + 1)).trim();
  const issuer = (url.searchParams.get('issuer') ?? labelIssuer).trim();

  const algorithmParam = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase().replace('-', '');
  const algorithm = TOTP_ALGORITHMS.find((candidate) => ALGORITHM_PARAM[candidate] === algorithmParam);
  if (!algorithm) return err(`The algorithm "${algorithmParam}" is not supported. Use SHA1, SHA256 or SHA512.`);

  const digits = Number(url.searchParams.get('digits') ?? 6);
  if (!(TOTP_DIGITS as readonly number[]).includes(digits)) return err('The digits value must be 6, 7 or 8.');

  const period = Number(url.searchParams.get('period') ?? 30);
  const checked = validatePeriod(period);
  if (!checked.ok) return checked;

  return ok({ secret: secret.toUpperCase(), issuer, account, algorithm, digits: digits as TotpDigits, period });
}
