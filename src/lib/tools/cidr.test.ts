import { describe, it, expect } from 'vitest';
import { parseCidr, CIDR_PRESETS } from './cidr';

describe('parseCidr', () => {
  it('computes a typical /24 home network', () => {
    const result = parseCidr('192.168.1.0/24');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      networkAddress: '192.168.1.0',
      broadcastAddress: '192.168.1.255',
      netmask: '255.255.255.0',
      wildcardMask: '0.0.0.255',
      firstUsableHost: '192.168.1.1',
      lastUsableHost: '192.168.1.254',
      totalAddresses: 256,
      usableHosts: 254,
      ipClass: 'C',
      addressType: 'Private',
    });
  });

  it('derives the network from a host address that is not the network address itself', () => {
    const result = parseCidr('192.168.1.130/25');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.networkAddress).toBe('192.168.1.128');
    expect(result.value.broadcastAddress).toBe('192.168.1.255');
  });

  it('treats /31 as a point-to-point link with both addresses usable (RFC 3021)', () => {
    const result = parseCidr('10.0.0.0/31');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      totalAddresses: 2,
      usableHosts: 2,
      firstUsableHost: '10.0.0.0',
      lastUsableHost: '10.0.0.1',
    });
  });

  it('treats /32 as a single usable host', () => {
    const result = parseCidr('127.0.0.1/32');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      totalAddresses: 1,
      usableHosts: 1,
      firstUsableHost: '127.0.0.1',
      lastUsableHost: '127.0.0.1',
      addressType: 'Loopback',
    });
  });

  it('handles /0, the entire IPv4 space', () => {
    const result = parseCidr('0.0.0.0/0');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.netmask).toBe('0.0.0.0');
    expect(result.value.broadcastAddress).toBe('255.255.255.255');
    expect(result.value.totalAddresses).toBe(2 ** 32);
  });

  it('accepts a dotted-decimal subnet mask instead of a prefix length', () => {
    const withPrefix = parseCidr('192.168.1.0/24');
    const withMask = parseCidr('192.168.1.0/255.255.255.0');
    expect(withPrefix.ok).toBe(true);
    expect(withMask.ok).toBe(true);
    if (withPrefix.ok && withMask.ok) expect(withMask.value).toEqual(withPrefix.value);
  });

  it('accepts a space-separated address and mask', () => {
    const result = parseCidr('192.168.1.0 255.255.255.0');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prefixLength).toBe(24);
  });

  it('reports the binary form of the address and netmask', () => {
    const result = parseCidr('192.168.1.1/24');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.binaryIp).toBe('11000000.10101000.00000001.00000001');
    expect(result.value.binaryNetmask).toBe('11111111.11111111.11111111.00000000');
  });

  it.each([
    ['1.2.3.4', 'A'],
    ['128.0.0.1', 'B'],
    ['192.0.0.1', 'C'],
    ['224.0.0.1', 'D'],
    ['240.0.0.1', 'E'],
  ] as const)('classifies %s as class %s', (ip, expectedClass) => {
    const result = parseCidr(`${ip}/32`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ipClass).toBe(expectedClass);
  });

  it.each([
    ['8.8.8.8', 'Public'],
    ['10.1.2.3', 'Private'],
    ['172.16.5.5', 'Private'],
    ['192.168.5.5', 'Private'],
    ['127.0.0.1', 'Loopback'],
    ['169.254.1.1', 'Link-local'],
    ['224.0.0.1', 'Multicast'],
    ['0.5.5.5', 'This network'],
  ] as const)('classifies %s as %s', (ip, expectedType) => {
    const result = parseCidr(`${ip}/32`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addressType).toBe(expectedType);
  });

  it('every preset parses successfully', () => {
    for (const preset of CIDR_PRESETS) {
      expect(parseCidr(preset.expression).ok).toBe(true);
    }
  });

  describe('validation', () => {
    it('rejects empty input', () => {
      expect(parseCidr('').ok).toBe(false);
    });

    it('rejects an address with the wrong number of octets', () => {
      const result = parseCidr('192.168.1/24');
      expect(result.ok).toBe(false);
    });

    it('rejects an octet greater than 255', () => {
      const result = parseCidr('192.168.1.256/24');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/256/);
    });

    it('rejects a non-numeric octet', () => {
      expect(parseCidr('192.168.1.x/24').ok).toBe(false);
    });

    it('rejects an octet with an ambiguous leading zero', () => {
      const result = parseCidr('192.168.001.1/24');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/leading zero/i);
    });

    it('rejects a prefix length greater than 32', () => {
      const result = parseCidr('192.168.1.0/33');
      expect(result.ok).toBe(false);
    });

    it('rejects a non-contiguous subnet mask', () => {
      const result = parseCidr('192.168.1.0/255.255.0.255');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/contiguous/i);
    });

    it('rejects input with no prefix and no mask', () => {
      expect(parseCidr('192.168.1.0').ok).toBe(false);
    });

    it('rejects completely unrelated input', () => {
      expect(parseCidr('not an address').ok).toBe(false);
    });
  });
});
