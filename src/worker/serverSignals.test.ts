import { describe, it, expect } from 'vitest';
import { extractServerSignals, serializeServerSignals, type IncomingRequestCfProperties } from './serverSignals';

const CF: IncomingRequestCfProperties = {
  city: 'New York',
  region: 'New York',
  country: 'US',
  continent: 'NA',
  postalCode: '10001',
  latitude: '40.71427',
  longitude: '-74.00597',
  timezone: 'America/New_York',
  colo: 'EWR',
  asn: 7922,
  asOrganization: 'Comcast Cable',
  httpProtocol: 'HTTP/3',
  tlsVersion: 'TLSv1.3',
  tlsCipher: 'AEAD-AES128-GCM-SHA256',
};

describe('extractServerSignals', () => {
  it('reads the client IP from CF-Connecting-IP', () => {
    const request = new Request('https://devmicrotools.com/browser-fingerprint-inspector/', {
      headers: { 'cf-connecting-ip': '203.0.113.42' },
    });
    expect(extractServerSignals(request, CF).ip).toBe('203.0.113.42');
  });

  it('reports a null IP when the header is absent (e.g. local dev)', () => {
    const request = new Request('https://devmicrotools.com/');
    expect(extractServerSignals(request, CF).ip).toBeNull();
  });

  it('maps every cf property onto the matching field', () => {
    const request = new Request('https://devmicrotools.com/');
    const signals = extractServerSignals(request, CF);
    expect(signals.city).toBe('New York');
    expect(signals.asn).toBe(7922);
    expect(signals.asOrganization).toBe('Comcast Cable');
    expect(signals.httpProtocol).toBe('HTTP/3');
    expect(signals.tlsVersion).toBe('TLSv1.3');
  });

  it('nulls out every cf-derived field when cf is undefined', () => {
    const request = new Request('https://devmicrotools.com/');
    const signals = extractServerSignals(request, undefined);
    expect(signals.city).toBeNull();
    expect(signals.asn).toBeNull();
    expect(signals.colo).toBeNull();
  });

  it('collects only the allowlisted headers, lowercased', () => {
    const request = new Request('https://devmicrotools.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Test)',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Not-Allowlisted': 'should not appear',
      },
    });
    const signals = extractServerSignals(request, CF);
    expect(signals.headers['user-agent']).toBe('Mozilla/5.0 (Test)');
    expect(signals.headers['accept-language']).toBe('en-US,en;q=0.9');
    expect(signals.headers['x-not-allowlisted']).toBeUndefined();
  });

  it('omits a header entirely from the map when the browser did not send it', () => {
    const request = new Request('https://devmicrotools.com/', { headers: { 'user-agent': 'Mozilla/5.0 (Test)' } });
    const signals = extractServerSignals(request, CF);
    expect(Object.keys(signals.headers)).toEqual(['user-agent']);
  });

  it('reports cookiesSent as true only when a Cookie header is present, and never the raw value', () => {
    const withCookie = new Request('https://devmicrotools.com/', { headers: { cookie: 'session=secret-token' } });
    const without = new Request('https://devmicrotools.com/');

    expect(extractServerSignals(withCookie, CF).cookiesSent).toBe(true);
    expect(extractServerSignals(without, CF).cookiesSent).toBe(false);
    expect(JSON.stringify(extractServerSignals(withCookie, CF))).not.toContain('secret-token');
  });
});

describe('serializeServerSignals', () => {
  it('produces valid JSON', () => {
    const request = new Request('https://devmicrotools.com/', { headers: { 'cf-connecting-ip': '203.0.113.42' } });
    const json = serializeServerSignals(extractServerSignals(request, CF));
    expect(() => JSON.parse(json.replace(/\\u003c/g, '<'))).not.toThrow();
  });

  it('escapes "<" so a malicious header value cannot break out of the injected <script> tag', () => {
    const request = new Request('https://devmicrotools.com/', {
      headers: { referer: 'https://evil.example/</script><script>alert(1)</script>' },
    });
    const json = serializeServerSignals(extractServerSignals(request, CF));
    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c/script>');
  });
});
