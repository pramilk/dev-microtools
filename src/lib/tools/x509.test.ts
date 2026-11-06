import { describe, it, expect } from 'vitest';
import {
  checkHostname,
  computeFingerprints,
  decodeCertificateInput,
  decodeDer,
  describeDays,
  formatCertificateReport,
  normalizeHostname,
  parseDer,
  reviewCertificate,
  reviewChain,
  sortFindings,
  toHex,
  type DecodedCertificate,
  type DecodedItem,
} from './x509';
import {
  EC_CSR_PEM,
  EC_LEAF_PEM,
  ED25519_PEM,
  OPENSSL_FACTS,
  RSA_CA_PEM,
  RSA_CSR_PEM,
  RSA_LEAF_PEM,
  SHA1_PEM,
  UNICODE_CSR_PEM,
  WEAK_RSA_PEM,
} from './x509Fixtures';

function decodeOne(pem: string): DecodedCertificate {
  const result = decodeCertificateInput(pem);
  if (!result.ok) throw new Error(result.error);
  return result.value[0].certificate;
}

const items = (...pems: string[]): DecodedItem[] => pems.map((pem) => ({ label: 'CERTIFICATE', certificate: decodeOne(pem) }));
const ids = (cert: DecodedCertificate, now: number): string[] => reviewCertificate(cert, now).map((f) => f.id);

const ec = decodeOne(EC_LEAF_PEM);
const leaf = decodeOne(RSA_LEAF_PEM);
const ca = decodeOne(RSA_CA_PEM);

// Inside every fixture's validity window (they start 2026-11-06).
const MID = Date.parse('2027-01-01T00:00:00Z');

describe('decoding an ECDSA leaf (checked against OpenSSL)', () => {
  it('reads the names, serial and dates exactly as OpenSSL reports them', () => {
    expect(ec.kind).toBe('certificate');
    expect(ec.version).toBe(3);
    expect(ec.serial.replace(/:/g, '')).toBe(OPENSSL_FACTS.ec.serial);
    expect(ec.notBefore?.toISOString()).toBe(OPENSSL_FACTS.ec.notBefore);
    expect(ec.notAfter?.toISOString()).toBe(OPENSSL_FACTS.ec.notAfter);
    expect(ec.subject.text).toBe('C=US, ST=California, L=San Francisco, O=Example Inc, OU=Engineering, CN=example.test');
    expect(ec.subject.commonName).toBe('example.test');
    expect(ec.isSelfSigned).toBe(true);
  });

  it('reads the key and signature algorithm', () => {
    expect(ec.publicKey.algorithm).toBe('EC');
    expect(ec.publicKey.bits).toBe(256);
    expect(ec.publicKey.curve).toBe('P-256 (prime256v1)');
    expect(ec.publicKey.description).toBe('EC P-256 (prime256v1)');
    expect(ec.signatureAlgorithm).toBe('ecdsa-with-SHA256');
  });

  it('reads every kind of Subject Alternative Name', () => {
    expect(ec.san).toEqual([
      { type: 'DNS', value: 'example.test' },
      { type: 'DNS', value: '*.example.test' },
      { type: 'IP', value: '192.0.2.1' },
      { type: 'Email', value: 'admin@example.test' },
    ]);
  });

  it('reads basic constraints, key usage and extended key usage', () => {
    expect(ec.isCa).toBe(false);
    expect(ec.keyUsage).toEqual(['Digital Signature']);
    expect(ec.extendedKeyUsage.map((usage) => usage.name)).toEqual(['TLS Web Server Authentication', 'TLS Web Client Authentication']);
    expect(ec.extensions.find((extension) => extension.name === 'Basic Constraints')?.critical).toBe(true);
  });

  it('computes the same fingerprints and public-key pin as OpenSSL', async () => {
    const result = await computeFingerprints(ec);
    expect(result).toEqual({
      ok: true,
      value: { sha256: OPENSSL_FACTS.ec.sha256, sha1: OPENSSL_FACTS.ec.sha1, spkiSha256: OPENSSL_FACTS.ec.spkiPin },
    });
  });
});

describe('decoding an RSA leaf with the full extension set', () => {
  it('matches OpenSSL on serial, dates, fingerprint and pin', async () => {
    expect(leaf.serial.replace(/:/g, '')).toBe(OPENSSL_FACTS.leaf.serial);
    expect(leaf.notBefore?.toISOString()).toBe(OPENSSL_FACTS.leaf.notBefore);
    expect(leaf.notAfter?.toISOString()).toBe(OPENSSL_FACTS.leaf.notAfter);
    const fingerprints = await computeFingerprints(leaf);
    expect(fingerprints.ok && fingerprints.value.sha256).toBe(OPENSSL_FACTS.leaf.sha256);
    expect(fingerprints.ok && fingerprints.value.spkiSha256).toBe(OPENSSL_FACTS.leaf.spkiPin);
  });

  it('reads the RSA key', () => {
    expect(leaf.publicKey.algorithm).toBe('RSA');
    expect(leaf.publicKey.bits).toBe(2048);
    expect(leaf.publicKey.exponent).toBe(65537);
    expect(leaf.publicKey.description).toBe('RSA 2048 bits (e = 65537)');
    expect(leaf.signatureAlgorithm).toBe('sha256WithRSAEncryption');
  });

  it('reads the key identifiers, revocation URLs, policy and must-staple', () => {
    expect(leaf.subjectKeyId).toBe(OPENSSL_FACTS.leaf.subjectKeyId);
    expect(leaf.authorityKeyId).toBe(OPENSSL_FACTS.leaf.authorityKeyId);
    expect(leaf.ocsp).toEqual(['http://ocsp.example.test']);
    expect(leaf.caIssuers).toEqual(['http://ca.example.test/ca.crt']);
    expect(leaf.crlUrls).toEqual(['http://crl.example.test/ca.crl']);
    expect(leaf.policies).toEqual(['Domain Validated (DV)']);
    expect(leaf.mustStaple).toBe(true);
    expect(leaf.isSelfSigned).toBe(false);
    expect(leaf.issuer?.commonName).toBe('Example Root CA');
  });

  it('links to its CA by key identifier', () => {
    expect(leaf.authorityKeyId).toBe(ca.subjectKeyId);
  });
});

describe('decoding a CA, weak and unusual certificates', () => {
  it('reads a CA with a path length', () => {
    expect(ca.isCa).toBe(true);
    expect(ca.pathLength).toBe(0);
    expect(ca.keyUsage).toEqual(expect.arrayContaining(['Certificate Sign', 'CRL Sign']));
    expect(ca.isSelfSigned).toBe(true);
  });

  it('reads an Ed25519 certificate', () => {
    const ed = decodeOne(ED25519_PEM);
    expect(ed.publicKey.algorithm).toBe('Ed25519');
    expect(ed.publicKey.bits).toBe(256);
    expect(ed.signatureAlgorithm).toBe('Ed25519');
  });

  it('flags a SHA-1 signature as dangerous', () => {
    expect(ids(decodeOne(SHA1_PEM), MID)).toContain('weak-signature');
  });

  it('flags a 1024-bit RSA key as dangerous', () => {
    const weak = decodeOne(WEAK_RSA_PEM);
    expect(weak.publicKey.bits).toBe(1024);
    expect(ids(weak, MID)).toContain('weak-key');
  });
});

describe('decoding a certificate request', () => {
  it('reads the subject, key and requested names, and has no dates', () => {
    const csr = decodeOne(EC_CSR_PEM);
    expect(csr.kind).toBe('csr');
    expect(csr.subject.text).toBe('C=US, O=Example Inc, CN=example.test');
    expect(csr.san.map((entry) => entry.value)).toEqual(['example.test', 'www.example.test']);
    expect(csr.publicKey.description).toBe('EC P-256 (prime256v1)');
    expect(csr.notBefore).toBeNull();
    expect(csr.issuer).toBeNull();
    expect(csr.isSelfSigned).toBe(false);
  });

  it('reads a request with no extensions', () => {
    const csr = decodeOne(RSA_CSR_PEM);
    expect(csr.kind).toBe('csr');
    expect(csr.san).toEqual([]);
    expect(csr.publicKey.bits).toBe(2048);
  });

  it('explains what a request is instead of judging its dates', () => {
    const found = ids(decodeOne(EC_CSR_PEM), MID);
    expect(found).toContain('csr');
    expect(found).not.toContain('expired');
  });

  it('decodes non-ASCII subject names', () => {
    const csr = decodeOne(UNICODE_CSR_PEM);
    expect(csr.subject.commonName).toBe('Zoë Café 日本');
    expect(csr.subject.text).toBe('C=JP, O=Ünïcode Ltd, CN=Zoë Café 日本');
  });
});

describe('input handling', () => {
  it('asks for input when empty', () => {
    expect(decodeCertificateInput('  ')).toEqual({ ok: false, error: expect.stringMatching(/paste a pem certificate/i) });
  });

  it('refuses a private key without decoding it', () => {
    const result = decodeCertificateInput('-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG\n-----END PRIVATE KEY-----');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/private key.*do not paste/i);
    const rsa = decodeCertificateInput('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----');
    expect(rsa.ok).toBe(false);
  });

  it('refuses a private key even when a certificate is pasted alongside it', () => {
    const result = decodeCertificateInput(`${EC_LEAF_PEM}\n-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----`);
    expect(result.ok).toBe(false);
  });

  it('explains plain text that is not a certificate', () => {
    expect(decodeCertificateInput('hello world, this is not a certificate')).toEqual({ ok: false, error: expect.stringMatching(/no certificate found/i) });
  });

  it('does not mistake plain words for a base64 certificate', () => {
    // Letters and spaces are all valid base64 characters, so this used to decode to garbage.
    for (const words of ['not a certificate', 'hello', 'Certificate Authority Root']) {
      expect(decodeCertificateInput(words)).toEqual({ ok: false, error: expect.stringMatching(/no certificate found/i) });
    }
  });

  it('explains a PEM block of an unsupported type', () => {
    const result = decodeCertificateInput('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/public key.*does not read/i);
  });

  it('reports a truncated certificate rather than throwing', () => {
    const lines = EC_LEAF_PEM.trim().split('\n');
    const cut = [...lines.slice(0, 6), lines[lines.length - 1]].join('\n');
    const result = decodeCertificateInput(cut);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a valid certificate|truncated|invalid|unexpectedly/i);
  });

  it('reports a corrupted PEM body', () => {
    const result = decodeCertificateInput('-----BEGIN CERTIFICATE-----\n!!!not base64!!!\n-----END CERTIFICATE-----');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid base64/i);
  });

  it('reads a chain of several PEM blocks in order', () => {
    const result = decodeCertificateInput(`${RSA_LEAF_PEM}\n${RSA_CA_PEM}`);
    expect(result.ok && result.value.map((item) => item.certificate.subject.commonName)).toEqual(['www.example.test', 'Example Root CA']);
  });

  it('finds the PEM inside openssl -text style output', () => {
    const result = decodeCertificateInput(`Certificate:\n    Data:\n        Version: 3 (0x2)\n\nSignature Algorithm: ecdsa-with-SHA256\n${EC_LEAF_PEM}`);
    expect(result.ok && result.value).toHaveLength(1);
  });

  it('accepts Windows line endings and bare base64', () => {
    expect(decodeCertificateInput(EC_LEAF_PEM.replace(/\n/g, '\r\n')).ok).toBe(true);
    const bare = EC_LEAF_PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const result = decodeCertificateInput(bare);
    expect(result.ok && result.value[0].label).toBe('DER');
  });

  it('rejects a huge blob of base64 without hanging', () => {
    const started = Date.now();
    const result = decodeCertificateInput('A'.repeat(2_000_000));
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('the DER reader', () => {
  const der = (...bytes: number[]) => Uint8Array.from(bytes);

  it('parses nested structures and keeps the raw bytes', () => {
    const node = parseDer(der(0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07));
    expect(node.children).toHaveLength(2);
    expect(node.children[1].content[0]).toBe(7);
    expect(toHex(node.raw)).toBe('30:06:02:01:05:02:01:07');
  });

  it('rejects truncated data', () => {
    expect(() => parseDer(der(0x30, 0x10, 0x02, 0x01))).toThrow(/longer than the data|unexpectedly/i);
  });

  it('rejects indefinite lengths, which DER forbids', () => {
    expect(() => parseDer(der(0x30, 0x80, 0x00, 0x00))).toThrow(/indefinite/i);
  });

  it('rejects trailing bytes after the structure', () => {
    expect(() => parseDer(der(0x02, 0x01, 0x05, 0xff))).toThrow(/extra data/i);
  });

  it('rejects an absurd length field', () => {
    expect(() => parseDer(der(0x30, 0x85, 0x01, 0x00, 0x00, 0x00, 0x00))).toThrow(/too large/i);
  });

  it('rejects excessive nesting instead of overflowing the stack', () => {
    // 40 nested SEQUENCEs, each wrapping the last; lengths stay under 128 so they fit one byte.
    let nested: number[] = [0x02, 0x01, 0x00];
    for (let i = 0; i < 40; i += 1) nested = [0x30, nested.length, ...nested];
    expect(() => parseDer(Uint8Array.from(nested))).toThrow(/nested too deeply/i);
  });

  it('turns DER that is not a certificate into a readable error', () => {
    const result = decodeDer(der(0x30, 0x03, 0x02, 0x01, 0x05));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a valid certificate/i);
  });

  it('turns empty bytes into an error', () => {
    expect(decodeDer(new Uint8Array(0)).ok).toBe(false);
  });
});

describe('reviewing validity', () => {
  const day = 86_400_000;

  it('says a current certificate is valid', () => {
    expect(ids(ec, MID)).toContain('valid');
  });

  it('flags an expired certificate as dangerous', () => {
    expect(ids(ec, Date.parse('2040-01-01T00:00:00Z'))).toContain('expired');
  });

  it('flags a certificate that is not valid yet', () => {
    expect(ids(ec, Date.parse('2020-01-01T00:00:00Z'))).toContain('not-yet-valid');
  });

  it('warns shortly before expiry and escalates in the last week', () => {
    const notAfter = (leaf.notAfter as Date).getTime();
    expect(ids(leaf, notAfter - 20 * day)).toContain('expiring');
    expect(ids(leaf, notAfter - 3 * day)).toContain('expiring-soon');
    expect(ids(leaf, notAfter - 3 * day)).not.toContain('expiring');
  });

  it('flags a lifetime longer than browsers allow, but not for a self-signed certificate', () => {
    const longLived: DecodedCertificate = { ...leaf, notAfter: new Date((leaf.notBefore as Date).getTime() + 500 * day) };
    expect(ids(longLived, MID)).toContain('long-lifetime');
    expect(ids(ec, MID)).not.toContain('long-lifetime');
  });

  it('describes durations in readable units', () => {
    expect(describeDays(0.4)).toBe('less than a day');
    expect(describeDays(1)).toBe('1 day');
    expect(describeDays(20)).toBe('20 days');
    expect(describeDays(90)).toBe('3 months');
    expect(describeDays(1500)).toBe('4 years');
  });
});

describe('reviewing names and structure', () => {
  it('warns when a server certificate has no SAN', () => {
    expect(ids({ ...ec, san: [] }, MID)).toContain('no-san');
  });

  it('notes self-signed certificates, differently for a CA', () => {
    const own = reviewCertificate(ec, MID).find((f) => f.id === 'self-signed');
    const root = reviewCertificate(ca, MID).find((f) => f.id === 'self-signed');
    expect(own?.detail).toMatch(/no browser will trust/i);
    expect(root?.detail).toMatch(/root CA/i);
  });

  it('warns about a wildcard only covering one label', () => {
    const san = reviewCertificate(ec, MID).find((f) => f.id === 'san');
    expect(san?.detail).toMatch(/one label only/);
  });

  it('flags unusual serial numbers and a CA that cannot sign', () => {
    expect(ids({ ...ec, serialBytes: 30 }, MID)).toContain('bad-serial');
    expect(ids({ ...ca, keyUsage: ['Digital Signature'] }, MID)).toContain('ca-no-keycertsign');
  });

  it('flags a TLS leaf with no revocation information', () => {
    expect(ids({ ...leaf, ocsp: [], crlUrls: [] }, MID)).toContain('no-revocation');
    expect(ids(leaf, MID)).not.toContain('no-revocation');
  });

  it('sorts the most severe findings first', () => {
    const order = { danger: 0, warning: 1, info: 2, ok: 3 } as const;
    const sorted = sortFindings(reviewCertificate(decodeOne(SHA1_PEM), Date.parse('2040-01-01T00:00:00Z')));
    const severities = sorted.map((f) => order[f.severity]);
    expect([...severities].sort((a, b) => a - b)).toEqual(severities);
  });
});

describe('chains', () => {
  it('confirms a leaf followed by its issuer', () => {
    expect(reviewChain(items(RSA_LEAF_PEM, RSA_CA_PEM)).map((f) => f.id)).toEqual(['chain-ok']);
  });

  it('warns when the order is wrong or the issuer does not match', () => {
    expect(reviewChain(items(RSA_CA_PEM, RSA_LEAF_PEM)).some((f) => f.severity === 'warning')).toBe(true);
    expect(reviewChain(items(EC_LEAF_PEM, RSA_CA_PEM)).some((f) => f.severity === 'warning')).toBe(true);
  });

  it('has nothing to say about a single certificate', () => {
    expect(reviewChain(items(EC_LEAF_PEM))).toEqual([]);
  });
});

describe('hostname checking', () => {
  it('matches exact names, case-insensitively and ignoring scheme, port and path', () => {
    expect(checkHostname(ec, 'example.test')?.matches).toBe(true);
    expect(checkHostname(ec, 'https://EXAMPLE.test:8443/some/path?q=1')?.matches).toBe(true);
    expect(checkHostname(ec, 'example.test.')?.matches).toBe(true);
  });

  it('matches a wildcard for exactly one label', () => {
    expect(checkHostname(ec, 'api.example.test')).toMatchObject({ matches: true, matchedName: '*.example.test' });
    expect(checkHostname(ec, 'a.b.example.test')?.matches).toBe(false);
  });

  it('does not match the bare domain through a wildcard alone', () => {
    const wildcardOnly: DecodedCertificate = { ...ec, san: [{ type: 'DNS', value: '*.example.test' }] };
    expect(checkHostname(wildcardOnly, 'example.test')?.matches).toBe(false);
  });

  it('rejects partial wildcards, which browsers do not support', () => {
    const partial: DecodedCertificate = { ...ec, san: [{ type: 'DNS', value: 'a*.example.test' }] };
    expect(checkHostname(partial, 'abc.example.test')?.matches).toBe(false);
  });

  it('rejects names that are not listed and lists the ones that are', () => {
    const result = checkHostname(ec, 'other.test');
    expect(result?.matches).toBe(false);
    expect(result?.message).toMatch(/example\.test/);
  });

  it('matches IP addresses against IP entries only', () => {
    expect(checkHostname(ec, '192.0.2.1')?.matches).toBe(true);
    expect(checkHostname(ec, '192.0.2.2')?.matches).toBe(false);
  });

  it('explains a certificate with no DNS names', () => {
    expect(checkHostname({ ...ec, san: [] }, 'example.test')?.message).toMatch(/ignore the Common Name/i);
  });

  it('returns null for empty input and normalises odd input', () => {
    expect(checkHostname(ec, '   ')).toBeNull();
    expect(normalizeHostname(' HTTPS://Example.Test:443/x ')).toBe('example.test');
    expect(normalizeHostname('[2001:db8::1]:8443')).toBe('2001:db8::1');
  });

  it('does not throw on non-ASCII hosts', () => {
    expect(() => checkHostname(ec, 'bücher.example')).not.toThrow();
    expect(checkHostname(ec, 'bücher.example')?.matches).toBe(false);
  });
});

describe('report', () => {
  it('summarises the certificate and its findings', async () => {
    const fingerprints = await computeFingerprints(ec);
    const text = formatCertificateReport(
      { label: 'CERTIFICATE', certificate: ec },
      sortFindings(reviewCertificate(ec, MID)),
      fingerprints.ok ? fingerprints.value : null
    );
    expect(text).toMatch(/^Certificate: example\.test/);
    expect(text).toMatch(/Issuer:/);
    expect(text).toMatch(/SANs:\s+example\.test, \*\.example\.test, 192\.0\.2\.1, admin@example\.test/);
    expect(text).toMatch(/SHA-256:\s+2E:2A:F1/);
    expect(text).toMatch(/\[OK\] Valid for another/);
  });

  it('labels a request as one and omits dates', () => {
    const csr = decodeOne(EC_CSR_PEM);
    const text = formatCertificateReport({ label: 'CERTIFICATE REQUEST', certificate: csr }, [], null);
    expect(text).toMatch(/^Certificate request:/);
    expect(text).not.toMatch(/Valid:/);
  });
});
