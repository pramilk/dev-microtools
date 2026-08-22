import { type ToolResult, ok, err, messageFrom } from './result';
import { fromUrlSafe, toUrlSafe } from './base64';

export interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
  [key: string]: unknown;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [key: string]: unknown;
}

export interface DecodedJwt {
  header: JwtHeader;
  payload: JwtClaims;
  signature: string;
  /** Header + payload, the exact bytes a signature is computed over. */
  signingInput: string;
}

const decodeSegment = (segment: string, name: string): ToolResult<unknown> => {
  let json: string;
  try {
    const binary = atob(fromUrlSafe(segment));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return err(`The ${name} is not valid base64url.`);
  }

  try {
    return ok(JSON.parse(json) as unknown);
  } catch {
    return err(`The ${name} decoded, but its contents are not valid JSON.`);
  }
};

/**
 * Decodes a JWT without verifying it.
 *
 * Decoding is not verification: anyone can read a JWT's contents, and a decoded token
 * proves nothing until its signature is checked. `verifyHs256` does that separately.
 */
export function decodeJwt(token: string): ToolResult<DecodedJwt> {
  const trimmed = token.trim();
  if (trimmed === '') return err('Paste a JWT to decode it.');

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return err(
      `A JWT has three dot-separated parts (header.payload.signature); this one has ${parts.length}.`
    );
  }

  const [headerPart, payloadPart, signature] = parts as [string, string, string];

  const header = decodeSegment(headerPart, 'header');
  if (!header.ok) return err(header.error);

  const payload = decodeSegment(payloadPart, 'payload');
  if (!payload.ok) return err(payload.error);

  if (typeof header.value !== 'object' || header.value === null) {
    return err('The header decoded to something other than a JSON object.');
  }
  if (typeof payload.value !== 'object' || payload.value === null) {
    return err('The payload decoded to something other than a JSON object.');
  }

  return ok({
    header: header.value as JwtHeader,
    payload: payload.value as JwtClaims,
    signature,
    signingInput: `${headerPart}.${payloadPart}`,
  });
}

export type ClaimStatus = 'valid' | 'expired' | 'not-yet-valid' | 'no-expiry';

export interface ExpiryInfo {
  status: ClaimStatus;
  expiresAt?: Date;
  notBefore?: Date;
  issuedAt?: Date;
}

/** Interprets the time-based claims against a reference time. */
export function inspectExpiry(claims: JwtClaims, now: Date = new Date()): ExpiryInfo {
  const toDate = (seconds: unknown): Date | undefined =>
    typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : undefined;

  const expiresAt = toDate(claims.exp);
  const notBefore = toDate(claims.nbf);
  const issuedAt = toDate(claims.iat);

  let status: ClaimStatus = 'no-expiry';
  if (notBefore && now < notBefore) status = 'not-yet-valid';
  else if (expiresAt) status = now > expiresAt ? 'expired' : 'valid';

  return { status, expiresAt, notBefore, issuedAt };
}

const encodeSegment = (value: unknown): string => {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toUrlSafe(btoa(binary));
};

/**
 * Signs a new HS256 token entirely in the browser.
 *
 * HS256 only — asymmetric signing would mean handling private keys, which is not
 * something anyone should paste into a web page, even one that never uploads them.
 */
export async function signHs256(
  payload: Record<string, unknown>,
  secret: string
): Promise<ToolResult<string>> {
  if (secret === '') return err('Enter a signing secret.');

  try {
    const header = { alg: 'HS256', typ: 'JWT' };
    const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));

    let binary = '';
    for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);

    return ok(`${signingInput}.${toUrlSafe(btoa(binary))}`);
  } catch (error) {
    return err(messageFrom(error, 'Could not sign the token.'));
  }
}

/** Verifies an HS256 signature against a secret. */
export async function verifyHs256(token: string, secret: string): Promise<ToolResult<boolean>> {
  const decoded = decodeJwt(token);
  if (!decoded.ok) return err(decoded.error);

  if (decoded.value.header.alg !== 'HS256') {
    return err(
      `This token is signed with ${decoded.value.header.alg ?? 'an unspecified algorithm'}. This tool can only verify HS256.`
    );
  }
  if (secret === '') return err('Enter the secret to verify against.');

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const binary = atob(fromUrlSafe(decoded.value.signature));
    const signatureBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(decoded.value.signingInput)
    );
    return ok(valid);
  } catch (error) {
    return err(messageFrom(error, 'Could not verify the signature.'));
  }
}
