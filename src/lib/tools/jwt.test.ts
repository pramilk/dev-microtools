import { describe, it, expect } from 'vitest';
import { decodeJwt, inspectExpiry, signHs256, verifyHs256, verifyAsymmetric } from './jwt';

// The canonical HS256 example from RFC 7515 / jwt.io, secret "your-256-bit-secret".
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const SAMPLE_SECRET = 'your-256-bit-secret';

describe('decodeJwt', () => {
  it('decodes the header of a known token', () => {
    const result = decodeJwt(SAMPLE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('decodes the payload of a known token', () => {
    const result = decodeJwt(SAMPLE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).toEqual({
        sub: '1234567890',
        name: 'John Doe',
        iat: 1516239022,
      });
    }
  });

  it('exposes the signing input, which is what a signature covers', () => {
    const result = decodeJwt(SAMPLE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.signingInput).toBe(SAMPLE.split('.').slice(0, 2).join('.'));
    }
  });

  it('rejects a token without three parts, saying how many it found', () => {
    const result = decodeJwt('only.two');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/has 2/);
  });

  it('rejects empty input', () => {
    expect(decodeJwt('   ').ok).toBe(false);
  });

  it('reports a header that is not valid base64url', () => {
    const result = decodeJwt('!!!.eyJhIjoxfQ.sig');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/header/i);
  });

  it('reports a payload that decodes to something other than JSON', () => {
    // "notjson" base64url-encoded.
    const result = decodeJwt('eyJhbGciOiJIUzI1NiJ9.bm90anNvbg.sig');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/payload/i);
  });

  it('tolerates surrounding whitespace', () => {
    expect(decodeJwt(`  ${SAMPLE}  `).ok).toBe(true);
  });
});

describe('inspectExpiry', () => {
  const now = new Date('2026-08-22T12:00:00Z');
  const asSeconds = (date: string) => Math.floor(new Date(date).getTime() / 1000);

  it('reports a token with no exp claim', () => {
    expect(inspectExpiry({}, now).status).toBe('no-expiry');
  });

  it('reports a valid, unexpired token', () => {
    expect(inspectExpiry({ exp: asSeconds('2026-08-23T12:00:00Z') }, now).status).toBe('valid');
  });

  it('reports an expired token', () => {
    expect(inspectExpiry({ exp: asSeconds('2026-08-21T12:00:00Z') }, now).status).toBe('expired');
  });

  it('reports a token that is not yet valid', () => {
    expect(inspectExpiry({ nbf: asSeconds('2026-08-23T12:00:00Z') }, now).status).toBe(
      'not-yet-valid'
    );
  });

  it('converts claim seconds into dates', () => {
    const info = inspectExpiry({ iat: 1516239022 }, now);
    expect(info.issuedAt?.toISOString()).toBe('2018-01-18T01:30:22.000Z');
  });

  it('ignores non-numeric claim values instead of producing an invalid date', () => {
    const info = inspectExpiry({ exp: 'soon' as unknown as number }, now);
    expect(info.expiresAt).toBeUndefined();
    expect(info.status).toBe('no-expiry');
  });
});

describe('signHs256 and verifyHs256', () => {
  it('reproduces the known signature for the canonical token', async () => {
    const result = await signHs256(
      { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
      SAMPLE_SECRET
    );
    expect(result).toEqual({ ok: true, value: SAMPLE });
  });

  it('verifies a token against the correct secret', async () => {
    expect(await verifyHs256(SAMPLE, SAMPLE_SECRET)).toEqual({ ok: true, value: true });
  });

  it('rejects a token verified against the wrong secret', async () => {
    expect(await verifyHs256(SAMPLE, 'wrong-secret')).toEqual({ ok: true, value: false });
  });

  it('detects a tampered payload', async () => {
    const [header, , signature] = SAMPLE.split('.');
    const tampered = `${header}.eyJzdWIiOiJoYWNrZXIifQ.${signature}`;
    expect(await verifyHs256(tampered, SAMPLE_SECRET)).toEqual({ ok: true, value: false });
  });

  it('round-trips a freshly signed token', async () => {
    const signed = await signHs256({ hello: 'world' }, 'secret');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    expect(await verifyHs256(signed.value, 'secret')).toEqual({ ok: true, value: true });
    const decoded = decodeJwt(signed.value);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.payload).toEqual({ hello: 'world' });
  });

  it('refuses to sign without a secret', async () => {
    expect((await signHs256({ a: 1 }, '')).ok).toBe(false);
  });

  it('refuses to verify without a secret', async () => {
    expect((await verifyHs256(SAMPLE, '')).ok).toBe(false);
  });

  it('explains that it cannot verify a non-HS256 token', async () => {
    // A token declaring alg: RS256.
    const rs256 = 'eyJhbGciOiJSUzI1NiJ9.eyJhIjoxfQ.sig';
    const result = await verifyHs256(rs256, 'secret');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/RS256/);
  });

  it('handles Unicode payloads', async () => {
    const signed = await signHs256({ name: '日本語 🎉' }, 'secret');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const decoded = decodeJwt(signed.value);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.payload.name).toBe('日本語 🎉');
  });
});

/* ---------------------------------------------------------- asymmetric verify */

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encodeSegment = (value: unknown): string =>
  toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

const toPem = async (key: CryptoKey): Promise<string> => {
  const spki = await crypto.subtle.exportKey('spki', key);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
};

/** Signs a token with a freshly generated key pair, independent of anything in jwt.ts. */
async function makeSignedToken(
  alg: 'RS256' | 'ES256',
  privateKey: CryptoKey,
  signParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams
): Promise<string> {
  const signingInput = `${encodeSegment({ alg, typ: 'JWT' })}.${encodeSegment({ sub: 'user-1' })}`;
  const signature = await crypto.subtle.sign(
    signParams,
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

describe('verifyAsymmetric', () => {
  it('verifies an RS256 token against its matching public key', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const token = await makeSignedToken('RS256', keyPair.privateKey, 'RSASSA-PKCS1-v1_5');
    const pem = await toPem(keyPair.publicKey);

    expect(await verifyAsymmetric(token, pem)).toEqual({ ok: true, value: true });
  });

  it('verifies an ES256 token against its matching public key', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const token = await makeSignedToken('ES256', keyPair.privateKey, { name: 'ECDSA', hash: 'SHA-256' });
    const pem = await toPem(keyPair.publicKey);

    expect(await verifyAsymmetric(token, pem)).toEqual({ ok: true, value: true });
  });

  it('rejects a token verified against an unrelated public key', async () => {
    const signingPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const otherPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const token = await makeSignedToken('RS256', signingPair.privateKey, 'RSASSA-PKCS1-v1_5');
    const wrongPem = await toPem(otherPair.publicKey);

    expect(await verifyAsymmetric(token, wrongPem)).toEqual({ ok: true, value: false });
  });

  it('detects a tampered payload', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const token = await makeSignedToken('RS256', keyPair.privateKey, 'RSASSA-PKCS1-v1_5');
    const [header, , signature] = token.split('.');
    const tampered = `${header}.${encodeSegment({ sub: 'attacker' })}.${signature}`;
    const pem = await toPem(keyPair.publicKey);

    expect(await verifyAsymmetric(tampered, pem)).toEqual({ ok: true, value: false });
  });

  it('explains that it cannot verify HS256 here', async () => {
    const result = await verifyAsymmetric(SAMPLE, 'irrelevant');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/RS256\/384\/512/);
  });

  it('asks for a public key', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const token = await makeSignedToken('ES256', keyPair.privateKey, { name: 'ECDSA', hash: 'SHA-256' });

    const result = await verifyAsymmetric(token, '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/public key/i);
  });

  it('reports an unreadable key instead of throwing', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const token = await makeSignedToken('ES256', keyPair.privateKey, { name: 'ECDSA', hash: 'SHA-256' });

    const result = await verifyAsymmetric(token, 'not a real key');
    expect(result.ok).toBe(false);
  });
});
