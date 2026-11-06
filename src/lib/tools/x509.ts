/**
 * Pure decoding and review of X.509 certificates and PKCS#10 certificate requests (CSRs).
 *
 * A small, bounds-checked ASN.1 DER reader (no dependency) feeds a decoder that pulls out the
 * subject, issuer, validity, public key and extensions, then a reviewer that turns those into
 * plain-language findings: expired or near-expiry, weak keys or signatures, missing SAN,
 * lifetimes browsers reject, and whether a certificate covers a given hostname.
 *
 * Nothing is sent anywhere, and nothing is *verified*: signatures and trust chains are not
 * checked (that needs the issuer's key and a trust store). The tool says so.
 */
import { type ToolResult, ok, err, messageFrom } from './result';
import type { Severity } from './qrLinkCheck';

export type { Severity };

// --- ASN.1 DER ----------------------------------------------------------------------

export class Asn1Error extends Error {}

export interface Asn1Node {
  /** 0 universal, 1 application, 2 context-specific, 3 private. */
  tagClass: number;
  constructed: boolean;
  tag: number;
  content: Uint8Array;
  children: Asn1Node[];
  /** The whole tag-length-value, for byte-exact comparison (issuer vs subject). */
  raw: Uint8Array;
}

const MAX_DEPTH = 24;
const MAX_NODES = 20_000;
export const MAX_INPUT_BYTES = 1_000_000;

const T = {
  BOOLEAN: 1,
  INTEGER: 2,
  BIT_STRING: 3,
  OCTET_STRING: 4,
  OID: 6,
  UTF8: 12,
  SEQUENCE: 16,
  SET: 17,
  PRINTABLE: 19,
  T61: 20,
  IA5: 22,
  UTC_TIME: 23,
  GENERALIZED_TIME: 24,
  BMP: 30,
} as const;

function parseNode(bytes: Uint8Array, offset: number, depth: number, budget: { nodes: number }): { node: Asn1Node; end: number } {
  if (depth > MAX_DEPTH) throw new Asn1Error('The structure is nested too deeply.');
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) throw new Asn1Error('The structure is too large.');
  if (offset >= bytes.length) throw new Asn1Error('The data ends unexpectedly.');

  const first = bytes[offset];
  const tagClass = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  let cursor = offset + 1;

  if (tag === 0x1f) {
    tag = 0;
    for (let count = 0; ; count += 1) {
      if (cursor >= bytes.length || count > 4) throw new Asn1Error('A tag number is malformed.');
      const byte = bytes[cursor];
      cursor += 1;
      tag = tag * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
  }

  if (cursor >= bytes.length) throw new Asn1Error('The data ends unexpectedly.');
  const lengthByte = bytes[cursor];
  cursor += 1;
  let length: number;
  if (lengthByte < 0x80) {
    length = lengthByte;
  } else if (lengthByte === 0x80) {
    throw new Asn1Error('Indefinite lengths are not allowed in DER.');
  } else {
    const count = lengthByte & 0x7f;
    if (count > 4) throw new Asn1Error('A length is too large.');
    if (cursor + count > bytes.length) throw new Asn1Error('The data ends unexpectedly.');
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[cursor + i];
    cursor += count;
  }

  const end = cursor + length;
  if (end > bytes.length) throw new Asn1Error('A field is longer than the data that remains (the input looks truncated).');

  const content = bytes.subarray(cursor, end);
  const children: Asn1Node[] = [];
  if (constructed) {
    let inner = 0;
    while (inner < content.length) {
      const child = parseNode(content, inner, depth + 1, budget);
      children.push(child.node);
      inner = child.end;
    }
  }
  return { node: { tagClass, constructed, tag, content, children, raw: bytes.subarray(offset, end) }, end };
}

/** Parses one DER value that must fill the whole buffer. */
export function parseDer(bytes: Uint8Array): Asn1Node {
  const { node, end } = parseNode(bytes, 0, 0, { nodes: 0 });
  if (end !== bytes.length) throw new Asn1Error('There is extra data after the end of the structure.');
  return node;
}

const isUniversal = (node: Asn1Node | undefined, tag: number): node is Asn1Node =>
  node !== undefined && node.tagClass === 0 && node.tag === tag;
const isContext = (node: Asn1Node | undefined, tag: number): node is Asn1Node =>
  node !== undefined && node.tagClass === 2 && node.tag === tag;

function expectUniversal(node: Asn1Node | undefined, tag: number, what: string): Asn1Node {
  if (!isUniversal(node, tag)) throw new Asn1Error(`Expected ${what}.`);
  return node;
}

// --- Primitive decoding -------------------------------------------------------------

export function toHex(bytes: Uint8Array, separator = ':'): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(separator);
}

function decodeOid(content: Uint8Array): string {
  if (content.length === 0) throw new Asn1Error('An object identifier is empty.');
  const arcs: number[] = [];
  let value = 0;
  let started = false;
  for (const byte of content) {
    value = value * 128 + (byte & 0x7f);
    started = true;
    if ((byte & 0x80) === 0) {
      if (arcs.length === 0) {
        const first = value < 80 ? Math.floor(value / 40) : 2;
        arcs.push(first, value - 40 * first);
      } else {
        arcs.push(value);
      }
      value = 0;
      started = false;
    }
  }
  if (started) throw new Asn1Error('An object identifier is cut off.');
  return arcs.join('.');
}

function decodeString(node: Asn1Node): string {
  const { tag, content } = node;
  if (tag === T.BMP) return new TextDecoder('utf-16be').decode(content);
  if (tag === T.T61) return new TextDecoder('latin1').decode(content);
  if (tag === T.UTF8 || tag === T.PRINTABLE || tag === T.IA5 || (tag >= 18 && tag <= 30)) {
    return new TextDecoder('utf-8').decode(content);
  }
  return toHex(content, '');
}

function bigIntegerHex(content: Uint8Array): string {
  let start = 0;
  // Drop the sign-padding byte DER adds when the top bit would otherwise read as negative.
  while (start < content.length - 1 && content[start] === 0) start += 1;
  return toHex(content.subarray(start));
}

function bitLength(content: Uint8Array): number {
  let start = 0;
  while (start < content.length && content[start] === 0) start += 1;
  if (start === content.length) return 0;
  return (content.length - start - 1) * 8 + (32 - Math.clz32(content[start]));
}

function smallInteger(node: Asn1Node | undefined): number | null {
  if (!isUniversal(node, T.INTEGER) || node.content.length > 4) return null;
  let value = 0;
  for (const byte of node.content) value = value * 256 + byte;
  return value;
}

function parseTime(node: Asn1Node | undefined, what: string): Date {
  if (!node || (node.tag !== T.UTC_TIME && node.tag !== T.GENERALIZED_TIME) || node.tagClass !== 0) {
    throw new Asn1Error(`Expected a date for ${what}.`);
  }
  const text = new TextDecoder('ascii').decode(node.content);
  const long = node.tag === T.GENERALIZED_TIME;
  const match = (long ? /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/ : /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/).exec(text);
  if (!match) throw new Asn1Error(`The ${what} date "${text}" is not in a valid format.`);
  let year = Number(match[1]);
  // RFC 5280: a two-digit year of 50 or more means 19xx, below 50 means 20xx.
  if (!long) year += year >= 50 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
  if (Number.isNaN(date.getTime())) throw new Asn1Error(`The ${what} date "${text}" is not a real date.`);
  return date;
}

function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  if (bytes.length !== 16) return toHex(bytes);
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  // Collapse the longest run of zero groups to "::", as RFC 5952 recommends.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

// --- Reference data -----------------------------------------------------------------

const OID_NAMES: Record<string, string> = {
  // Signature algorithms
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.2.840.10040.4.3': 'dsa-with-SHA1',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  // Public key algorithms and curves
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.10045.2.1': 'EC',
  '1.2.840.10040.4.1': 'DSA',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.2.840.10045.3.1.7': 'P-256 (prime256v1)',
  '1.3.132.0.34': 'P-384 (secp384r1)',
  '1.3.132.0.35': 'P-521 (secp521r1)',
  '1.3.132.0.10': 'secp256k1',
  // Extensions
  '2.5.29.14': 'Subject Key Identifier',
  '2.5.29.15': 'Key Usage',
  '2.5.29.17': 'Subject Alternative Name',
  '2.5.29.18': 'Issuer Alternative Name',
  '2.5.29.19': 'Basic Constraints',
  '2.5.29.30': 'Name Constraints',
  '2.5.29.31': 'CRL Distribution Points',
  '2.5.29.32': 'Certificate Policies',
  '2.5.29.35': 'Authority Key Identifier',
  '2.5.29.37': 'Extended Key Usage',
  '1.3.6.1.5.5.7.1.1': 'Authority Information Access',
  '1.3.6.1.5.5.7.1.24': 'TLS Feature',
  '1.3.6.1.4.1.11129.2.4.2': 'Signed Certificate Timestamps',
  '1.2.840.113549.1.9.14': 'Requested Extensions',
  // Extended key usages
  '1.3.6.1.5.5.7.3.1': 'TLS Web Server Authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS Web Client Authentication',
  '1.3.6.1.5.5.7.3.3': 'Code Signing',
  '1.3.6.1.5.5.7.3.4': 'Email Protection',
  '1.3.6.1.5.5.7.3.8': 'Time Stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
  '2.5.29.37.0': 'Any Extended Key Usage',
  // Access methods
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA Issuers',
  // Policies
  '2.23.140.1.2.1': 'Domain Validated (DV)',
  '2.23.140.1.2.2': 'Organization Validated (OV)',
  '2.23.140.1.2.3': 'Individual Validated (IV)',
  '2.23.140.1.1': 'Extended Validation (EV)',
  '2.5.29.32.0': 'Any Policy',
};

const DN_LABELS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '2.5.4.97': 'organizationIdentifier',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL',
  '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
};

const KEY_USAGE_BITS = [
  'Digital Signature',
  'Non Repudiation',
  'Key Encipherment',
  'Data Encipherment',
  'Key Agreement',
  'Certificate Sign',
  'CRL Sign',
  'Encipher Only',
  'Decipher Only',
];

const oidName = (oid: string): string => OID_NAMES[oid] ?? oid;

const WEAK_SIGNATURES = new Set(['md5WithRSAEncryption', 'sha1WithRSAEncryption', 'ecdsa-with-SHA1', 'dsa-with-SHA1']);
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const MAX_PUBLIC_TLS_DAYS = 398;

// --- Decoded model ------------------------------------------------------------------

export interface DnAttribute {
  oid: string;
  label: string;
  value: string;
}

export interface DecodedName {
  /** In certificate order, e.g. `C=US, O=Example Inc, CN=example.test`. */
  text: string;
  attributes: DnAttribute[];
  commonName: string | null;
  raw: Uint8Array;
}

export interface SanEntry {
  type: 'DNS' | 'IP' | 'Email' | 'URI' | 'Directory' | 'Other';
  value: string;
}

export interface PublicKeyInfo {
  algorithm: string;
  /** Key size in bits, when it has one that matters (RSA modulus, EC curve). */
  bits: number | null;
  curve: string | null;
  exponent: number | null;
  /** One line for display, e.g. `RSA 2048 bits (e = 65537)`. */
  description: string;
  /** The DER of the whole SubjectPublicKeyInfo, for the pinning hash. */
  spki: Uint8Array;
}

export interface DecodedExtension {
  oid: string;
  name: string;
  critical: boolean;
  /** Human-readable lines for the value. */
  details: string[];
}

export interface DecodedCertificate {
  kind: 'certificate' | 'csr';
  /** 1, 2 or 3 for a certificate; 1 for a CSR. */
  version: number;
  /** Colon-separated hex; empty for a CSR. */
  serial: string;
  serialBytes: number;
  signatureAlgorithm: string;
  issuer: DecodedName | null;
  subject: DecodedName;
  notBefore: Date | null;
  notAfter: Date | null;
  publicKey: PublicKeyInfo;
  extensions: DecodedExtension[];
  san: SanEntry[];
  isCa: boolean | null;
  pathLength: number | null;
  keyUsage: string[];
  extendedKeyUsage: { oid: string; name: string }[];
  subjectKeyId: string | null;
  authorityKeyId: string | null;
  ocsp: string[];
  caIssuers: string[];
  crlUrls: string[];
  policies: string[];
  mustStaple: boolean;
  sctCount: number | null;
  isSelfSigned: boolean;
  /** The DER of the whole structure, for fingerprints. */
  der: Uint8Array;
}

// --- Names, keys, extensions --------------------------------------------------------

function decodeName(node: Asn1Node): DecodedName {
  expectUniversal(node, T.SEQUENCE, 'a distinguished name');
  const attributes: DnAttribute[] = [];
  for (const set of node.children) {
    expectUniversal(set, T.SET, 'a name component');
    for (const pair of set.children) {
      expectUniversal(pair, T.SEQUENCE, 'a name attribute');
      const oidNode = expectUniversal(pair.children[0], T.OID, 'a name attribute type');
      const valueNode = pair.children[1];
      if (!valueNode) throw new Asn1Error('A name attribute has no value.');
      const oid = decodeOid(oidNode.content);
      attributes.push({ oid, label: DN_LABELS[oid] ?? oid, value: decodeString(valueNode) });
    }
  }
  return {
    text: attributes.map((attribute) => `${attribute.label}=${attribute.value}`).join(', '),
    attributes,
    commonName: attributes.find((attribute) => attribute.oid === '2.5.4.3')?.value ?? null,
    raw: node.raw,
  };
}

function algorithmOid(node: Asn1Node | undefined, what: string): { oid: string; params: Asn1Node | undefined } {
  const sequence = expectUniversal(node, T.SEQUENCE, what);
  const oid = expectUniversal(sequence.children[0], T.OID, what);
  return { oid: decodeOid(oid.content), params: sequence.children[1] };
}

function decodePublicKey(node: Asn1Node | undefined): PublicKeyInfo {
  const spki = expectUniversal(node, T.SEQUENCE, 'the public key');
  const { oid, params } = algorithmOid(spki.children[0], 'the public key algorithm');
  const bitString = expectUniversal(spki.children[1], T.BIT_STRING, 'the public key bits');
  const keyBytes = bitString.content.subarray(1);
  const algorithm = oidName(oid);

  if (oid === '1.2.840.113549.1.1.1') {
    const rsa = parseDer(keyBytes);
    const modulus = expectUniversal(rsa.children[0], T.INTEGER, 'the RSA modulus');
    const exponent = smallInteger(rsa.children[1]);
    const bits = bitLength(modulus.content);
    return {
      algorithm,
      bits,
      curve: null,
      exponent,
      description: `RSA ${bits} bits${exponent !== null ? ` (e = ${exponent})` : ''}`,
      spki: spki.raw,
    };
  }
  if (oid === '1.2.840.10045.2.1') {
    const curveOid = params && isUniversal(params, T.OID) ? decodeOid(params.content) : null;
    const curve = curveOid ? oidName(curveOid) : 'unknown curve';
    const bits = curveOid === '1.2.840.10045.3.1.7' ? 256 : curveOid === '1.3.132.0.34' ? 384 : curveOid === '1.3.132.0.35' ? 521 : curveOid === '1.3.132.0.10' ? 256 : null;
    return { algorithm, bits, curve, exponent: null, description: `EC ${curve}`, spki: spki.raw };
  }
  if (oid === '1.3.101.112' || oid === '1.3.101.110') {
    return { algorithm, bits: 256, curve: null, exponent: null, description: `${algorithm} (256 bits)`, spki: spki.raw };
  }
  if (oid === '1.3.101.113' || oid === '1.3.101.111') {
    return { algorithm, bits: 448, curve: null, exponent: null, description: `${algorithm} (448 bits)`, spki: spki.raw };
  }
  return { algorithm, bits: null, curve: null, exponent: null, description: algorithm, spki: spki.raw };
}

/** Walks every GeneralName (and nested structure) looking for URIs — used for CRL points. */
function collectUris(node: Asn1Node, found: string[] = []): string[] {
  if (isContext(node, 6) && !node.constructed) found.push(new TextDecoder('utf-8').decode(node.content));
  for (const child of node.children) collectUris(child, found);
  return found;
}

function decodeGeneralNames(node: Asn1Node): SanEntry[] {
  const out: SanEntry[] = [];
  for (const entry of node.children) {
    if (entry.tagClass !== 2) continue;
    const text = new TextDecoder('utf-8').decode(entry.content);
    if (entry.tag === 2) out.push({ type: 'DNS', value: text });
    else if (entry.tag === 1) out.push({ type: 'Email', value: text });
    else if (entry.tag === 6) out.push({ type: 'URI', value: text });
    else if (entry.tag === 7) out.push({ type: 'IP', value: formatIp(entry.content) });
    else if (entry.tag === 4) {
      try {
        out.push({ type: 'Directory', value: decodeName(entry.children[0] ?? entry).text });
      } catch {
        out.push({ type: 'Directory', value: toHex(entry.content, '') });
      }
    } else out.push({ type: 'Other', value: toHex(entry.content, '') });
  }
  return out;
}

function countScts(content: Uint8Array): number | null {
  // The extension value is an OCTET STRING holding a TLS-encoded list: u16 total, then
  // u16-length-prefixed entries.
  try {
    const inner = parseDer(content);
    const data = inner.content;
    if (data.length < 2) return 0;
    const total = (data[0] << 8) | data[1];
    let offset = 2;
    let count = 0;
    while (offset + 2 <= Math.min(data.length, total + 2) && count < 100) {
      const size = (data[offset] << 8) | data[offset + 1];
      offset += 2 + size;
      count += 1;
    }
    return count;
  } catch {
    return null;
  }
}

interface ExtensionSummary {
  san: SanEntry[];
  isCa: boolean | null;
  pathLength: number | null;
  keyUsage: string[];
  extendedKeyUsage: { oid: string; name: string }[];
  subjectKeyId: string | null;
  authorityKeyId: string | null;
  ocsp: string[];
  caIssuers: string[];
  crlUrls: string[];
  policies: string[];
  mustStaple: boolean;
  sctCount: number | null;
  list: DecodedExtension[];
}

function emptySummary(): ExtensionSummary {
  return {
    san: [],
    isCa: null,
    pathLength: null,
    keyUsage: [],
    extendedKeyUsage: [],
    subjectKeyId: null,
    authorityKeyId: null,
    ocsp: [],
    caIssuers: [],
    crlUrls: [],
    policies: [],
    mustStaple: false,
    sctCount: null,
    list: [],
  };
}

function decodeExtensions(extensions: Asn1Node[]): ExtensionSummary {
  const summary = emptySummary();
  for (const extension of extensions) {
    expectUniversal(extension, T.SEQUENCE, 'an extension');
    const oidNode = expectUniversal(extension.children[0], T.OID, 'an extension identifier');
    const oid = decodeOid(oidNode.content);
    const critical = isUniversal(extension.children[1], T.BOOLEAN) && extension.children[1].content[0] !== 0;
    const valueNode = extension.children[extension.children.length - 1];
    const wrapper = expectUniversal(valueNode, T.OCTET_STRING, 'an extension value');
    const details: string[] = [];

    try {
      switch (oid) {
        case '2.5.29.17': {
          summary.san = decodeGeneralNames(parseDer(wrapper.content));
          for (const entry of summary.san) details.push(`${entry.type}: ${entry.value}`);
          break;
        }
        case '2.5.29.19': {
          const sequence = parseDer(wrapper.content);
          const flag = sequence.children.find((child) => isUniversal(child, T.BOOLEAN));
          summary.isCa = flag ? flag.content[0] !== 0 : false;
          summary.pathLength = smallInteger(sequence.children.find((child) => isUniversal(child, T.INTEGER)));
          details.push(summary.isCa ? 'CA: yes' : 'CA: no');
          if (summary.pathLength !== null) details.push(`Path length: ${summary.pathLength}`);
          break;
        }
        case '2.5.29.15': {
          const bits = parseDer(wrapper.content).content;
          const unused = bits[0] ?? 0;
          const total = (bits.length - 1) * 8 - unused;
          for (let i = 0; i < Math.min(total, KEY_USAGE_BITS.length); i += 1) {
            if ((bits[1 + (i >> 3)] & (0x80 >> (i & 7))) !== 0) summary.keyUsage.push(KEY_USAGE_BITS[i]);
          }
          details.push(...summary.keyUsage);
          break;
        }
        case '2.5.29.37': {
          for (const child of parseDer(wrapper.content).children) {
            const usage = decodeOid(expectUniversal(child, T.OID, 'a key purpose').content);
            summary.extendedKeyUsage.push({ oid: usage, name: oidName(usage) });
            details.push(oidName(usage));
          }
          break;
        }
        case '2.5.29.14': {
          summary.subjectKeyId = toHex(parseDer(wrapper.content).content);
          details.push(summary.subjectKeyId);
          break;
        }
        case '2.5.29.35': {
          const keyId = parseDer(wrapper.content).children.find((child) => isContext(child, 0));
          if (keyId) {
            summary.authorityKeyId = toHex(keyId.content);
            details.push(summary.authorityKeyId);
          }
          break;
        }
        case '1.3.6.1.5.5.7.1.1': {
          for (const access of parseDer(wrapper.content).children) {
            const method = decodeOid(expectUniversal(access.children[0], T.OID, 'an access method').content);
            const location = access.children[1];
            const uri = location && isContext(location, 6) ? new TextDecoder('utf-8').decode(location.content) : null;
            if (!uri) continue;
            if (method === '1.3.6.1.5.5.7.48.1') summary.ocsp.push(uri);
            else if (method === '1.3.6.1.5.5.7.48.2') summary.caIssuers.push(uri);
            details.push(`${oidName(method)}: ${uri}`);
          }
          break;
        }
        case '2.5.29.31': {
          summary.crlUrls = collectUris(parseDer(wrapper.content));
          details.push(...summary.crlUrls);
          break;
        }
        case '2.5.29.32': {
          for (const policy of parseDer(wrapper.content).children) {
            const id = decodeOid(expectUniversal(policy.children[0], T.OID, 'a policy').content);
            summary.policies.push(oidName(id));
            details.push(oidName(id));
          }
          break;
        }
        case '1.3.6.1.5.5.7.1.24': {
          const features = parseDer(wrapper.content).children.map((child) => smallInteger(child));
          summary.mustStaple = features.includes(5);
          details.push(summary.mustStaple ? 'OCSP Must-Staple' : 'TLS features present');
          break;
        }
        case '1.3.6.1.4.1.11129.2.4.2': {
          summary.sctCount = countScts(wrapper.content);
          if (summary.sctCount !== null) details.push(`${summary.sctCount} embedded certificate transparency timestamp${summary.sctCount === 1 ? '' : 's'}`);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      // A malformed extension must not hide the rest of the certificate.
      details.push(`Could not be decoded: ${messageFrom(error, 'invalid structure')}`);
    }

    summary.list.push({ oid, name: oidName(oid), critical, details });
  }
  return summary;
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

// --- Certificates and CSRs ----------------------------------------------------------

function fromSummary(
  base: Pick<DecodedCertificate, 'kind' | 'version' | 'serial' | 'serialBytes' | 'signatureAlgorithm' | 'issuer' | 'subject' | 'notBefore' | 'notAfter' | 'publicKey' | 'der'>,
  summary: ExtensionSummary
): DecodedCertificate {
  return {
    ...base,
    extensions: summary.list,
    san: summary.san,
    isCa: summary.isCa,
    pathLength: summary.pathLength,
    keyUsage: summary.keyUsage,
    extendedKeyUsage: summary.extendedKeyUsage,
    subjectKeyId: summary.subjectKeyId,
    authorityKeyId: summary.authorityKeyId,
    ocsp: summary.ocsp,
    caIssuers: summary.caIssuers,
    crlUrls: summary.crlUrls,
    policies: summary.policies,
    mustStaple: summary.mustStaple,
    sctCount: summary.sctCount,
    isSelfSigned: base.issuer !== null && bytesEqual(base.issuer.raw, base.subject.raw),
  };
}

function decodeCertificateDer(der: Uint8Array): DecodedCertificate {
  const root = expectUniversal(parseDer(der), T.SEQUENCE, 'a certificate');
  const tbs = expectUniversal(root.children[0], T.SEQUENCE, 'the certificate body');
  const signature = algorithmOid(root.children[1], 'the signature algorithm');
  expectUniversal(root.children[2], T.BIT_STRING, 'the signature');

  let index = 0;
  let version = 1;
  if (isContext(tbs.children[index], 0)) {
    version = (smallInteger(tbs.children[index].children[0]) ?? 0) + 1;
    index += 1;
  }
  const serialNode = expectUniversal(tbs.children[index], T.INTEGER, 'the serial number');
  index += 1;
  algorithmOid(tbs.children[index], 'the signing algorithm');
  index += 1;
  const issuer = decodeName(tbs.children[index]);
  index += 1;
  const validity = expectUniversal(tbs.children[index], T.SEQUENCE, 'the validity period');
  index += 1;
  const notBefore = parseTime(validity.children[0], 'start');
  const notAfter = parseTime(validity.children[1], 'expiry');
  const subject = decodeName(tbs.children[index]);
  index += 1;
  const publicKey = decodePublicKey(tbs.children[index]);
  index += 1;

  const extensionsWrapper = tbs.children.slice(index).find((child) => isContext(child, 3));
  const extensions = extensionsWrapper?.children[0]?.children ?? [];

  return fromSummary(
    {
      kind: 'certificate',
      version,
      serial: bigIntegerHex(serialNode.content),
      serialBytes: serialNode.content.length,
      signatureAlgorithm: oidName(signature.oid),
      issuer,
      subject,
      notBefore,
      notAfter,
      publicKey,
      der,
    },
    decodeExtensions(extensions)
  );
}

function decodeCsrDer(der: Uint8Array): DecodedCertificate {
  const root = expectUniversal(parseDer(der), T.SEQUENCE, 'a certificate request');
  const info = expectUniversal(root.children[0], T.SEQUENCE, 'the request body');
  const signature = algorithmOid(root.children[1], 'the signature algorithm');
  expectUniversal(root.children[2], T.BIT_STRING, 'the signature');

  expectUniversal(info.children[0], T.INTEGER, 'the request version');
  const subject = decodeName(info.children[1]);
  const publicKey = decodePublicKey(info.children[2]);

  let extensions: Asn1Node[] = [];
  const attributes = info.children.find((child) => isContext(child, 0));
  for (const attribute of attributes?.children ?? []) {
    const oid = attribute.children[0] && isUniversal(attribute.children[0], T.OID) ? decodeOid(attribute.children[0].content) : '';
    if (oid === '1.2.840.113549.1.9.14') extensions = attribute.children[1]?.children[0]?.children ?? [];
  }

  return fromSummary(
    {
      kind: 'csr',
      version: 1,
      serial: '',
      serialBytes: 0,
      signatureAlgorithm: oidName(signature.oid),
      issuer: null,
      subject,
      notBefore: null,
      notAfter: null,
      publicKey,
      der,
    },
    decodeExtensions(extensions)
  );
}

/** Decodes DER bytes as a certificate or, if that does not fit, as a CSR (or the reverse when hinted). */
export function decodeDer(der: Uint8Array, hint: 'certificate' | 'csr' | null = null): ToolResult<DecodedCertificate> {
  if (der.length === 0) return err('There is nothing to decode.');
  if (der.length > MAX_INPUT_BYTES) return err('That is too large to be a certificate.');
  const order: Array<'certificate' | 'csr'> = hint === 'csr' ? ['csr', 'certificate'] : ['certificate', 'csr'];
  let firstError = '';
  for (const kind of order) {
    try {
      return ok(kind === 'certificate' ? decodeCertificateDer(der) : decodeCsrDer(der));
    } catch (error) {
      if (!(error instanceof Asn1Error)) return err(messageFrom(error, 'This could not be decoded.'));
      if (firstError === '') firstError = error.message;
    }
  }
  return err(`This is not a valid certificate or certificate request. ${firstError}`);
}

// --- Input handling -----------------------------------------------------------------

export interface DecodedItem {
  /** The PEM label ("CERTIFICATE", "CERTIFICATE REQUEST") or "DER" for a bare blob. */
  label: string;
  certificate: DecodedCertificate;
}

function base64ToBytes(text: string): Uint8Array | null {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned === '' || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned)) return null;
  try {
    const standard = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
const CERT_LABELS = new Set(['CERTIFICATE', 'TRUSTED CERTIFICATE', 'X509 CERTIFICATE']);
const CSR_LABELS = new Set(['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST']);

/**
 * Reads one or more PEM blocks (a chain pasted in order, or `openssl x509 -text` output with
 * its PEM at the end), or a bare base64 DER blob. Private keys are refused outright.
 */
export function decodeCertificateInput(input: string): ToolResult<DecodedItem[]> {
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (text === '') return err('Paste a PEM certificate or certificate request to decode it.');

  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    return err(
      'This contains a private key. Do not paste private keys into any web page, including this one. Paste the certificate (BEGIN CERTIFICATE) or request (BEGIN CERTIFICATE REQUEST) instead.'
    );
  }

  const items: DecodedItem[] = [];
  const skipped = new Set<string>();
  for (const match of text.matchAll(PEM_BLOCK)) {
    const label = match[1];
    if (!CERT_LABELS.has(label) && !CSR_LABELS.has(label)) {
      skipped.add(label);
      continue;
    }
    const body = match[2].replace(/^[A-Za-z-]+:.*$/gm, '');
    const der = base64ToBytes(body);
    if (!der) return err(`The ${label.toLowerCase()} block is not valid base64. It may have been altered or cut off while copying.`);
    const decoded = decodeDer(der, CSR_LABELS.has(label) ? 'csr' : 'certificate');
    if (!decoded.ok) return decoded;
    items.push({ label, certificate: decoded.value });
    if (items.length >= 20) break;
  }

  if (items.length > 0) return ok(items);

  if (skipped.size > 0) {
    return err(`This contains a ${[...skipped].join(', ').toLowerCase()}, which this tool does not read. Paste a certificate or a certificate request.`);
  }

  // Plain words with the spaces removed are still valid base64 characters, so only treat the
  // text as a bare certificate when it decodes to something that starts like DER (a SEQUENCE).
  const bare = base64ToBytes(text);
  if (bare && bare[0] === 0x30) {
    const decoded = decodeDer(bare);
    if (!decoded.ok) return decoded;
    return ok([{ label: 'DER', certificate: decoded.value }]);
  }
  return err('No certificate found. Paste text that starts with -----BEGIN CERTIFICATE-----, or a base64 certificate.');
}

// --- Fingerprints -------------------------------------------------------------------

export interface Fingerprints {
  sha256: string;
  sha1: string;
  /** Base64 SHA-256 of the SubjectPublicKeyInfo — the value HTTP public-key pinning used. */
  spkiSha256: string;
}

async function digest(algorithm: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as BufferSource));
}

export async function computeFingerprints(cert: DecodedCertificate): Promise<ToolResult<Fingerprints>> {
  try {
    const [sha256, sha1, spki] = await Promise.all([
      digest('SHA-256', cert.der),
      digest('SHA-1', cert.der),
      digest('SHA-256', cert.publicKey.spki),
    ]);
    let binary = '';
    for (const byte of spki) binary += String.fromCharCode(byte);
    return ok({ sha256: toHex(sha256), sha1: toHex(sha1), spkiSha256: btoa(binary) });
  } catch (error) {
    return err(messageFrom(error, 'This browser could not compute the fingerprints (the Web Crypto API is unavailable).'));
  }
}

// --- Hostname matching --------------------------------------------------------------

export interface HostnameMatch {
  matches: boolean;
  matchedName: string | null;
  message: string;
}

/** Strips a scheme, path, port and surrounding space from what the visitor typed. */
export function normalizeHostname(input: string): string {
  let host = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.replace(/[/?#].*$/, '');
  if (host.startsWith('[')) return host.replace(/^\[|\](:\d+)?$/g, '');
  return host.replace(/:\d+$/, '').replace(/\.$/, '');
}

function toAsciiHost(host: string): string {
  try {
    return new URL(`https://${host}`).hostname;
  } catch {
    return host;
  }
}

/**
 * RFC 6125: a wildcard stands for exactly one whole left-most label, so `*.example.test`
 * covers `a.example.test` but neither `example.test` nor `a.b.example.test`.
 */
function dnsNameMatches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase().replace(/\.$/, '');
  if (!p.includes('*')) return p === host;
  if (!p.startsWith('*.') || p.indexOf('*', 1) !== -1) return false;
  const suffix = p.slice(1);
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, host.length - suffix.length);
  return label.length > 0 && !label.includes('.');
}

export function checkHostname(cert: DecodedCertificate, input: string): HostnameMatch | null {
  const host = normalizeHostname(input);
  if (host === '') return null;
  const ascii = toAsciiHost(host);
  const isIp = /^[\d.]+$/.test(ascii) || ascii.includes(':');

  if (isIp) {
    const hit = cert.san.find((entry) => entry.type === 'IP' && entry.value === ascii);
    return hit
      ? { matches: true, matchedName: hit.value, message: `Covered: the certificate lists the IP address ${hit.value}.` }
      : { matches: false, matchedName: null, message: `Not covered: ${ascii} is not among the certificate's IP addresses.` };
  }

  const dnsNames = cert.san.filter((entry) => entry.type === 'DNS');
  const hit = dnsNames.find((entry) => dnsNameMatches(entry.value, ascii));
  if (hit) {
    return {
      matches: true,
      matchedName: hit.value,
      message: hit.value.includes('*') ? `Covered: ${ascii} matches the wildcard ${hit.value}.` : `Covered: the certificate lists ${hit.value}.`,
    };
  }
  if (dnsNames.length === 0) {
    return {
      matches: false,
      matchedName: null,
      message: 'Not covered: the certificate has no DNS names in a Subject Alternative Name. Browsers ignore the Common Name, so it would be rejected for any host.',
    };
  }
  return {
    matches: false,
    matchedName: null,
    message: `Not covered: ${ascii} does not match any of ${dnsNames.length === 1 ? 'the name' : 'the names'} ${dnsNames
      .slice(0, 4)
      .map((entry) => entry.value)
      .join(', ')}${dnsNames.length > 4 ? ', …' : ''}.`,
  };
}

// --- Review -------------------------------------------------------------------------

export interface CertFinding {
  severity: Severity;
  id: string;
  title: string;
  detail: string;
}

const MS_PER_DAY = 86_400_000;

function finding(severity: Severity, id: string, title: string, detail: string): CertFinding {
  return { severity, id, title, detail };
}

export function describeDays(days: number): string {
  const abs = Math.abs(days);
  if (abs < 1) return 'less than a day';
  const rounded = Math.floor(abs);
  if (rounded < 60) return `${rounded} day${rounded === 1 ? '' : 's'}`;
  if (rounded < 730) return `${Math.round(rounded / 30)} months`;
  return `${Math.round(rounded / 365)} years`;
}

/** `now` is a parameter so tests (and the UI's clock) pin the date. */
export function reviewCertificate(cert: DecodedCertificate, now: number): CertFinding[] {
  const out: CertFinding[] = [];
  const isCsr = cert.kind === 'csr';
  const serverAuth = cert.extendedKeyUsage.some((usage) => usage.oid === SERVER_AUTH);
  const isTlsLeaf = !isCsr && cert.isCa !== true && (serverAuth || cert.extendedKeyUsage.length === 0);

  if (cert.notBefore && cert.notAfter) {
    const daysLeft = (cert.notAfter.getTime() - now) / MS_PER_DAY;
    if (now < cert.notBefore.getTime()) {
      out.push(finding('danger', 'not-yet-valid', 'Not valid yet', `It starts on ${cert.notBefore.toISOString().slice(0, 10)}, ${describeDays((cert.notBefore.getTime() - now) / MS_PER_DAY)} from now. Check the clock of the device or server that rejects it.`));
    } else if (daysLeft < 0) {
      out.push(finding('danger', 'expired', 'Expired', `It expired on ${cert.notAfter.toISOString().slice(0, 10)}, ${describeDays(daysLeft)} ago. Browsers and clients will refuse it until it is renewed.`));
    } else if (daysLeft <= 7) {
      out.push(finding('danger', 'expiring-soon', `Expires in ${describeDays(daysLeft)}`, 'Renew it now. Clients will start rejecting it on the expiry date.'));
    } else if (daysLeft <= 30) {
      out.push(finding('warning', 'expiring', `Expires in ${describeDays(daysLeft)}`, 'Plan the renewal soon, and check that automatic renewal is working.'));
    } else {
      out.push(finding('ok', 'valid', `Valid for another ${describeDays(daysLeft)}`, `Valid from ${cert.notBefore.toISOString().slice(0, 10)} to ${cert.notAfter.toISOString().slice(0, 10)}.`));
    }

    const lifetimeDays = (cert.notAfter.getTime() - cert.notBefore.getTime()) / MS_PER_DAY;
    if (isTlsLeaf && !cert.isSelfSigned && lifetimeDays > MAX_PUBLIC_TLS_DAYS) {
      out.push(finding('warning', 'long-lifetime', `Lifetime of ${describeDays(lifetimeDays)} is longer than browsers allow`, `Publicly trusted TLS certificates are limited to ${MAX_PUBLIC_TLS_DAYS} days. A longer one is rejected by browsers unless it chains to a private CA you have installed.`));
    }
  }

  if (WEAK_SIGNATURES.has(cert.signatureAlgorithm)) {
    out.push(finding('danger', 'weak-signature', `Weak signature algorithm: ${cert.signatureAlgorithm}`, 'MD5 and SHA-1 signatures can be forged and are rejected by modern browsers and clients. Reissue it with SHA-256 or better.'));
  }

  const { algorithm, bits } = cert.publicKey;
  if (algorithm === 'RSA' && bits !== null && bits < 2048) {
    out.push(finding('danger', 'weak-key', `RSA key is only ${bits} bits`, 'RSA keys under 2048 bits are considered breakable and are rejected by browsers. Use at least 2048 bits, or an EC key.'));
  } else if (algorithm === 'EC' && bits !== null && bits < 256) {
    out.push(finding('danger', 'weak-key', `EC key is only ${bits} bits`, 'Use P-256 or stronger.'));
  } else if (algorithm === 'DSA') {
    out.push(finding('warning', 'dsa-key', 'DSA key', 'DSA certificates are obsolete and not accepted by modern TLS clients.'));
  } else if (bits !== null) {
    out.push(finding('ok', 'key-ok', `Key strength is fine (${cert.publicKey.description})`, 'The public key meets current minimums.'));
  }

  const hasHostSan = cert.san.some((entry) => entry.type === 'DNS' || entry.type === 'IP');
  if (isTlsLeaf && !hasHostSan) {
    out.push(finding('warning', 'no-san', 'No Subject Alternative Name', `Browsers ignore the Common Name${cert.subject.commonName ? ` ("${cert.subject.commonName}")` : ''} and require the host in a Subject Alternative Name. This certificate would be rejected for a website.`));
  } else if (hasHostSan) {
    const names = cert.san.filter((entry) => entry.type === 'DNS' || entry.type === 'IP');
    const wildcards = names.filter((entry) => entry.value.startsWith('*.'));
    out.push(
      finding(
        'info',
        'san',
        `Covers ${names.length} name${names.length === 1 ? '' : 's'}`,
        `${names.slice(0, 6).map((entry) => entry.value).join(', ')}${names.length > 6 ? `, and ${names.length - 6} more` : ''}.${wildcards.length > 0 ? ' Wildcards cover one label only, so *.example.test does not cover example.test or a.b.example.test.' : ''}`
      )
    );
  }

  if (!isCsr) {
    if (cert.isSelfSigned) {
      out.push(finding('info', 'self-signed', 'Self-signed', cert.isCa ? 'It is its own issuer, which is normal for a root CA certificate.' : 'It is signed by its own key, so no browser will trust it unless it is installed as a trusted certificate. Fine for local development.'));
    }
    if (cert.version === 1) {
      out.push(finding('info', 'v1', 'Version 1 certificate', 'It has no extensions, so it cannot carry a Subject Alternative Name or mark itself as a CA.'));
    }
    if (cert.isCa === true && cert.keyUsage.length > 0 && !cert.keyUsage.includes('Certificate Sign')) {
      out.push(finding('warning', 'ca-no-keycertsign', 'CA without Certificate Sign usage', 'It is marked as a CA, but its key usage does not allow signing certificates.'));
    }
    if (cert.serialBytes > 20 || cert.serial === '00') {
      out.push(finding('warning', 'bad-serial', 'Unusual serial number', 'RFC 5280 requires a positive serial number of at most 20 bytes.'));
    }
    if (cert.mustStaple) {
      out.push(finding('info', 'must-staple', 'OCSP Must-Staple', 'Clients will reject this certificate unless the server staples a fresh OCSP response.'));
    }
    if (isTlsLeaf && !cert.isSelfSigned && cert.ocsp.length === 0 && cert.crlUrls.length === 0) {
      out.push(finding('info', 'no-revocation', 'No revocation information', 'It lists neither an OCSP responder nor a CRL, so clients cannot check whether it was revoked.'));
    }
  } else {
    out.push(finding('info', 'csr', 'Certificate request', 'A CSR carries the subject, public key and requested names but no validity dates or issuer. The CA decides those when it signs it.'));
  }
  return out;
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2, ok: 3 };

export function sortFindings(findings: CertFinding[]): CertFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Checks that each certificate in a pasted chain was issued by the next one. */
export function reviewChain(items: DecodedItem[]): CertFinding[] {
  const certs = items.filter((item) => item.certificate.kind === 'certificate').map((item) => item.certificate);
  if (certs.length < 2) return [];
  const out: CertFinding[] = [];
  for (let i = 0; i < certs.length - 1; i += 1) {
    const child = certs[i];
    const parent = certs[i + 1];
    const nameMatches = child.issuer !== null && bytesEqual(child.issuer.raw, parent.subject.raw);
    const keyMatches = child.authorityKeyId === null || parent.subjectKeyId === null || child.authorityKeyId === parent.subjectKeyId;
    if (!nameMatches || !keyMatches) {
      out.push(
        finding(
          'warning',
          `chain-${i}`,
          `Certificate ${i + 1} was not issued by certificate ${i + 2}`,
          `The issuer of "${child.subject.commonName ?? child.subject.text}" does not match the subject of the next certificate. The chain may be out of order or incomplete.`
        )
      );
    }
  }
  if (out.length === 0) {
    out.push(finding('ok', 'chain-ok', `Chain of ${certs.length} links up by name`, 'Each certificate names the next one as its issuer. Signatures are not verified by this tool.'));
  }
  return out;
}

// --- Report -------------------------------------------------------------------------

export function formatCertificateReport(item: DecodedItem, findings: CertFinding[], fingerprints: Fingerprints | null): string {
  const cert = item.certificate;
  const lines = [`${cert.kind === 'csr' ? 'Certificate request' : 'Certificate'}: ${cert.subject.commonName ?? cert.subject.text}`];
  lines.push(`Subject:   ${cert.subject.text}`);
  if (cert.issuer) lines.push(`Issuer:    ${cert.issuer.text}`);
  if (cert.notBefore && cert.notAfter) lines.push(`Valid:     ${cert.notBefore.toISOString()} to ${cert.notAfter.toISOString()}`);
  if (cert.serial) lines.push(`Serial:    ${cert.serial}`);
  lines.push(`Key:       ${cert.publicKey.description}`, `Signature: ${cert.signatureAlgorithm}`);
  if (cert.san.length > 0) lines.push(`SANs:      ${cert.san.map((entry) => entry.value).join(', ')}`);
  if (fingerprints) lines.push(`SHA-256:   ${fingerprints.sha256}`);
  if (findings.length > 0) {
    const labels: Record<Severity, string> = { danger: 'DANGER', warning: 'WARNING', info: 'NOTE', ok: 'OK' };
    lines.push('');
    for (const entry of findings) lines.push(`[${labels[entry.severity]}] ${entry.title}`, `    ${entry.detail}`);
  }
  return lines.join('\n');
}
