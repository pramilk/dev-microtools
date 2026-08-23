import { type ToolResult, ok, err } from './result';

export type AddressType = 'Private' | 'Public' | 'Loopback' | 'Link-local' | 'Multicast' | 'This network' | 'Reserved';

export interface CidrInfo {
  ip: string;
  prefixLength: number;
  netmask: string;
  wildcardMask: string;
  networkAddress: string;
  broadcastAddress: string;
  firstUsableHost: string;
  lastUsableHost: string;
  totalAddresses: number;
  usableHosts: number;
  ipClass: 'A' | 'B' | 'C' | 'D' | 'E';
  addressType: AddressType;
  binaryIp: string;
  binaryNetmask: string;
}

export interface CidrPreset {
  label: string;
  expression: string;
}

export const CIDR_PRESETS: CidrPreset[] = [
  { label: 'Typical home network', expression: '192.168.1.0/24' },
  { label: 'Private Class A block', expression: '10.0.0.0/8' },
  { label: 'Private Class B block', expression: '172.16.0.0/12' },
  { label: 'Private Class C block', expression: '192.168.0.0/16' },
  { label: 'Point-to-point link', expression: '10.0.0.0/31' },
  { label: 'Single host', expression: '127.0.0.1/32' },
  { label: 'Entire IPv4 space', expression: '0.0.0.0/0' },
];

const ip4 = (a: number, b: number, c: number, d: number): number => a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d;

function ipToInt(text: string): ToolResult<number> {
  const trimmed = text.trim();
  const octets = trimmed.split('.');
  if (octets.length !== 4) {
    return err(`"${trimmed}" isn't a valid IPv4 address — expected 4 dot-separated numbers, like 192.168.1.0.`);
  }

  let result = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      return err(`"${trimmed}" isn't a valid IPv4 address — "${octet}" isn't a whole number.`);
    }
    if (octet.length > 1 && octet.startsWith('0')) {
      return err(`"${trimmed}" isn't a valid IPv4 address — "${octet}" has a leading zero, which is ambiguous (some systems read it as octal) and isn't accepted.`);
    }
    const n = Number(octet);
    if (n > 255) return err(`"${trimmed}" isn't a valid IPv4 address — "${octet}" is greater than 255.`);
    result = result * 256 + n;
  }
  return ok(result);
}

function intToIp(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function toBinaryDotted(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
    .map((octet) => octet.toString(2).padStart(8, '0'))
    .join('.');
}

function prefixToNetmaskInt(prefix: number): number {
  if (prefix === 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function maskToPrefixLength(mask: number): number | null {
  let prefix = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    const isSet = ((mask >>> bit) & 1) === 1;
    if (isSet) {
      if (seenZero) return null;
      prefix += 1;
    } else {
      seenZero = true;
    }
  }
  return prefix;
}

function parsePrefixOrMask(text: string): ToolResult<number> {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const prefix = Number(trimmed);
    if (prefix > 32) return err(`"${trimmed}" isn't a valid prefix length — expected 0-32.`);
    return ok(prefix);
  }

  const maskInt = ipToInt(trimmed);
  if (!maskInt.ok) return err(`"${trimmed}" isn't a valid prefix length or subnet mask.`);
  const prefix = maskToPrefixLength(maskInt.value);
  if (prefix === null) {
    return err(`"${trimmed}" isn't a valid subnet mask — its bits aren't a contiguous block of 1s followed by 0s.`);
  }
  return ok(prefix);
}

function inSubnet(ip: number, base: number, prefixLen: number): boolean {
  const mask = prefixToNetmaskInt(prefixLen);
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
}

/** Classful designation (A/B/C/D/E) — historical, since classless (CIDR) addressing replaced it, but still commonly asked about. */
function ipClass(ip: number): CidrInfo['ipClass'] {
  const firstOctet = (ip >>> 24) & 255;
  if (firstOctet < 128) return 'A';
  if (firstOctet < 192) return 'B';
  if (firstOctet < 224) return 'C';
  if (firstOctet < 240) return 'D';
  return 'E';
}

function addressType(ip: number): AddressType {
  if (ip === ip4(255, 255, 255, 255)) return 'Reserved';
  if (inSubnet(ip, ip4(0, 0, 0, 0), 8)) return 'This network';
  if (inSubnet(ip, ip4(127, 0, 0, 0), 8)) return 'Loopback';
  if (inSubnet(ip, ip4(169, 254, 0, 0), 16)) return 'Link-local';
  if (inSubnet(ip, ip4(10, 0, 0, 0), 8)) return 'Private';
  if (inSubnet(ip, ip4(172, 16, 0, 0), 12)) return 'Private';
  if (inSubnet(ip, ip4(192, 168, 0, 0), 16)) return 'Private';
  if (inSubnet(ip, ip4(224, 0, 0, 0), 4)) return 'Multicast';
  if (inSubnet(ip, ip4(240, 0, 0, 0), 4)) return 'Reserved';
  return 'Public';
}

/** Parses "ip/prefix", "ip/dotted-mask", or "ip dotted-mask" into full subnet details. */
export function parseCidr(input: string): ToolResult<CidrInfo> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter an address in CIDR notation, e.g. 192.168.1.0/24.');

  let ipPart: string;
  let maskPart: string;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex !== -1) {
    ipPart = trimmed.slice(0, slashIndex);
    maskPart = trimmed.slice(slashIndex + 1);
  } else {
    const spaceParts = trimmed.split(/\s+/).filter(Boolean);
    if (spaceParts.length !== 2) {
      return err('Enter an address with a prefix, e.g. "192.168.1.0/24", or an address and mask, e.g. "192.168.1.0 255.255.255.0".');
    }
    [ipPart, maskPart] = spaceParts as [string, string];
  }

  const ipResult = ipToInt(ipPart);
  if (!ipResult.ok) return ipResult;
  const prefixResult = parsePrefixOrMask(maskPart);
  if (!prefixResult.ok) return prefixResult;

  const ip = ipResult.value;
  const prefixLength = prefixResult.value;
  const netmaskInt = prefixToNetmaskInt(prefixLength);
  const wildcardInt = ~netmaskInt >>> 0;
  const networkInt = (ip & netmaskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardInt) >>> 0;
  const totalAddresses = 2 ** (32 - prefixLength);

  // /31 is a point-to-point link (RFC 3021): both addresses are usable, neither is a
  // network/broadcast address. /32 is a single host. Everything else reserves the
  // first address for the network and the last for broadcast.
  const reservesNetworkAndBroadcast = prefixLength < 31;
  const firstUsableInt = reservesNetworkAndBroadcast ? networkInt + 1 : networkInt;
  const lastUsableInt = reservesNetworkAndBroadcast ? broadcastInt - 1 : broadcastInt;
  const usableHosts = reservesNetworkAndBroadcast ? totalAddresses - 2 : totalAddresses;

  return ok({
    ip: intToIp(ip),
    prefixLength,
    netmask: intToIp(netmaskInt),
    wildcardMask: intToIp(wildcardInt),
    networkAddress: intToIp(networkInt),
    broadcastAddress: intToIp(broadcastInt),
    firstUsableHost: intToIp(firstUsableInt),
    lastUsableHost: intToIp(lastUsableInt),
    totalAddresses,
    usableHosts,
    ipClass: ipClass(ip),
    addressType: addressType(ip),
    binaryIp: toBinaryDotted(ip),
    binaryNetmask: toBinaryDotted(netmaskInt),
  });
}
