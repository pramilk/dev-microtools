import { describe, it, expect } from 'vitest';
import {
  describeDoNotTrack,
  describeGlobalPrivacyControl,
  describeHardwareConcurrency,
  describeDeviceMemory,
  describePlatformCaveat,
  describeTouchSupport,
  describePlugins,
  describeBattery,
  describeAdBlocker,
  describePermission,
  formatUtcOffset,
  buildFingerprintReport,
  buildNetworkCategory,
  countSignals,
  reportToText,
  detectAvailableFonts,
  hashCanvasData,
  type RawSignals,
  type FingerprintCategory,
  type FingerprintSection,
  type FontDetectionResult,
  type ServerSignals,
} from './browserFingerprint';

const BASE_RAW: RawSignals = {
  userAgent: 'Mozilla/5.0 (Test)',
  platform: 'Win32',
  language: 'en-US',
  languages: ['en-US', 'en'],
  cookieEnabled: true,
  doNotTrack: null,
  globalPrivacyControl: null,
  hardwareConcurrency: 8,
  deviceMemoryGb: 8,
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  availWidth: 1920,
  availHeight: 1040,
  colorDepth: 24,
  pixelRatio: 1,
  viewportWidth: 1200,
  viewportHeight: 800,
  timeZone: 'America/New_York',
  timezoneOffsetMinutes: 300,
  localStorageAvailable: true,
  sessionStorageAvailable: true,
  indexedDbAvailable: true,
  webglVendor: 'WebKit',
  webglRenderer: 'WebKit WebGL',
  webglUnmaskedVendor: 'Google Inc. (NVIDIA)',
  webglUnmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11)',
  canvasHash: 'abc123',
  pluginNames: ['PDF Viewer'],
  batterySupported: true,
  batteryLevel: 0.87,
  batteryCharging: false,
  adBlockerDetected: false,
  permissions: { geolocation: 'prompt', camera: 'denied', microphone: 'granted', notifications: 'prompt' },
  connectionType: '4g',
  connectionDownlinkMbps: 10,
  connectionRttMs: 50,
  connectionSaveData: false,
};

const NO_FONTS: FontDetectionResult = { available: [], unavailable: [] };

/** Test helper: finds a category by id across both sections of a report. */
function findCategory(sections: readonly FingerprintSection[], id: FingerprintCategory['id']): FingerprintCategory {
  const category = sections.flatMap((s) => s.categories).find((c) => c.id === id);
  if (!category) throw new Error(`No category with id "${id}" in report`);
  return category;
}

describe('describeDoNotTrack', () => {
  it('reports enabled for "1"', () => {
    expect(describeDoNotTrack('1')).toBe('Enabled');
  });
  it('reports enabled for "yes"', () => {
    expect(describeDoNotTrack('yes')).toBe('Enabled');
  });
  it('reports disabled for "0"', () => {
    expect(describeDoNotTrack('0')).toBe('Disabled');
  });
  it('reports not set for null', () => {
    expect(describeDoNotTrack(null)).toBe('Not set by this browser');
  });
  it('reports not set for "unspecified"', () => {
    expect(describeDoNotTrack('unspecified')).toBe('Not set by this browser');
  });
});

describe('describeGlobalPrivacyControl', () => {
  it('reports signaled for true', () => {
    expect(describeGlobalPrivacyControl(true)).toMatch(/Signaled/);
  });
  it('reports not signaled for false', () => {
    expect(describeGlobalPrivacyControl(false)).toBe('Not signaled');
  });
  it('reports unsupported for null', () => {
    expect(describeGlobalPrivacyControl(null)).toBe('Not supported by this browser');
  });
});

describe('describeHardwareConcurrency', () => {
  it('pluralizes multiple cores', () => {
    expect(describeHardwareConcurrency(8)).toBe('8 logical cores');
  });
  it('singularizes one core', () => {
    expect(describeHardwareConcurrency(1)).toBe('1 logical core');
  });
  it('reports unavailable for null', () => {
    expect(describeHardwareConcurrency(null)).toBe('Not reported by this browser');
  });
});

describe('describeDeviceMemory', () => {
  it('formats a reported value', () => {
    expect(describeDeviceMemory(8)).toContain('8 GB');
  });
  it('claims the spec cap only when the value actually respects it', () => {
    expect(describeDeviceMemory(8)).toContain('capped at 8');
    expect(describeDeviceMemory(4)).toContain('capped at 8');
  });
  it('does not claim a cap at 8 when the browser reports above it', () => {
    const description = describeDeviceMemory(16);
    expect(description).toContain('16 GB');
    expect(description).not.toContain('capped at 8');
  });
  it('reports unavailable for null', () => {
    expect(describeDeviceMemory(null)).toContain('Not reported');
  });
});

describe('describePlatformCaveat', () => {
  const WIN64_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

  it('flags Win32 as unreliable when the UA confirms 64-bit Windows', () => {
    const caveat = describePlatformCaveat('Win32', WIN64_UA);
    expect(caveat).toContain('64-bit Windows');
  });
  it('still flags Win32 as unreliable when the UA has no 64-bit marker', () => {
    const caveat = describePlatformCaveat('Win32', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36');
    expect(caveat).toContain('legacy label');
  });
  it('is undefined for non-Windows platforms', () => {
    expect(describePlatformCaveat('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)')).toBeUndefined();
    expect(describePlatformCaveat('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')).toBeUndefined();
  });
});

describe('describeTouchSupport', () => {
  it('reports no touch for zero points', () => {
    expect(describeTouchSupport(0)).toBe('No');
  });
  it('reports the point count when touch is supported', () => {
    expect(describeTouchSupport(10)).toContain('10');
  });
});

describe('formatUtcOffset', () => {
  it('formats UTC exactly', () => {
    expect(formatUtcOffset(0)).toBe('UTC±00:00');
  });
  it('formats a positive offset (ahead of UTC) from a negative getTimezoneOffset value', () => {
    // India Standard Time, UTC+5:30, getTimezoneOffset() returns -330.
    expect(formatUtcOffset(-330)).toBe('UTC+05:30');
  });
  it('formats a negative offset (behind UTC) from a positive getTimezoneOffset value', () => {
    // US Eastern Standard Time, UTC-5:00, getTimezoneOffset() returns 300.
    expect(formatUtcOffset(300)).toBe('UTC-05:00');
  });
  it('pads single-digit hours and minutes', () => {
    expect(formatUtcOffset(-60)).toBe('UTC+01:00');
  });
});

describe('buildFingerprintReport', () => {
  it('puts the Browser section first and the Server section second', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    expect(report.map((s) => s.id)).toEqual(['browser', 'server']);
  });

  it('produces one row per signal across all seven categories, split across the two sections', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    expect(report[0].categories.map((c) => c.id)).toEqual(['identity', 'display', 'locale', 'privacy', 'permissions', 'rendering', 'fonts']);
    expect(report[1].categories.map((c) => c.id)).toEqual(['network']);
    expect(report.flatMap((s) => s.categories).every((c) => c.rows.length > 0)).toBe(true);
  });

  it('defaults the network category to its not-available fallback when no server signals are given', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const network = findCategory(report, 'network');
    expect(network.rows[0].value).toBe('Not available in this environment');
  });

  it('includes the raw user agent verbatim', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const identity = findCategory(report, 'identity');
    expect(identity.rows.find((r) => r.label === 'User-Agent')?.value).toBe('Mozilla/5.0 (Test)');
  });

  it('formats screen resolution as width × height', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const display = findCategory(report, 'display');
    expect(display.rows.find((r) => r.label === 'Screen resolution')?.value).toBe('1920 × 1080');
  });

  it('shows the canvas hash while still computing as "Computing…"', () => {
    const report = buildFingerprintReport({ ...BASE_RAW, canvasHash: null }, NO_FONTS);
    const rendering = findCategory(report, 'rendering');
    expect(rendering.rows.find((r) => r.label === 'Canvas hash')?.value).toBe('Computing…');
  });

  it('lists detected font names in the fonts category', () => {
    const report = buildFingerprintReport(BASE_RAW, { available: ['Arial', 'Georgia'], unavailable: ['Impact'] });
    const fonts = findCategory(report, 'fonts');
    expect(fonts.rows[0].value).toContain('Arial');
    expect(fonts.rows[0].value).toContain('Georgia');
    expect(fonts.rows[0].value).toContain('2 of 3');
  });

  it('falls back to "Not exposed" for a null unmasked WebGL renderer', () => {
    const report = buildFingerprintReport({ ...BASE_RAW, webglUnmaskedRenderer: null }, NO_FONTS);
    const rendering = findCategory(report, 'rendering');
    expect(rendering.rows.find((r) => r.label === 'Unmasked WebGL renderer')?.value).toBe('Not exposed by this browser');
  });

  it('includes the permissions category with each permission described', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const permissions = findCategory(report, 'permissions');
    expect(permissions.rows.find((r) => r.label === 'Geolocation')?.value).toBe('Not yet asked (would prompt)');
    expect(permissions.rows.find((r) => r.label === 'Camera')?.value).toBe('Denied');
    expect(permissions.rows.find((r) => r.label === 'Microphone')?.value).toBe('Granted');
  });

  it('includes plugins and battery in the display category', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const display = findCategory(report, 'display');
    expect(display.rows.find((r) => r.label === 'Browser plugins')?.value).toContain('PDF Viewer');
    expect(display.rows.find((r) => r.label === 'Battery')?.value).toBe('87%, not charging');
  });

  it('includes ad blocker detection in the privacy category', () => {
    const report = buildFingerprintReport({ ...BASE_RAW, adBlockerDetected: true }, NO_FONTS);
    const privacy = findCategory(report, 'privacy');
    expect(privacy.rows.find((r) => r.label === 'Ad blocker')?.value).toBe('Detected');
  });

  it('includes the Network Information API signals in the display category', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const display = findCategory(report, 'display');
    expect(display.rows.find((r) => r.label === 'Connection')?.value).toBe('4g · ~10 Mbps · ~50ms RTT');
  });

  describe('data-accuracy caveats', () => {
    it('flags Browser plugins as possibly not reflecting what is actually installed', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
      const row = findCategory(report, 'display').rows.find((r) => r.label === 'Browser plugins')!;
      expect(row.caveat).toMatch(/fixed generic list/);
    });

    it('flags CPU cores as possibly capped by the browser', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
      const row = findCategory(report, 'display').rows.find((r) => r.label === 'CPU cores')!;
      expect(row.caveat).toMatch(/cap or normalize/);
    });

    it('flags network ISP/organization as reflecting a VPN, not the real network, when applicable', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS, BASE_SERVER);
      const row = findCategory(report, 'network').rows.find((r) => r.label === 'ISP / organization')!;
      expect(row.caveat).toMatch(/VPN or proxy/);
    });

    it('notes that Tor Browser and similar tools force this to UTC', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
      const row = findCategory(report, 'locale').rows.find((r) => r.label === 'Timezone')!;
      expect(row.caveat).toMatch(/Tor Browser/);
    });
  });

  describe('actionable warnings', () => {
    it('warns when no ad blocker is detected, with remediation steps', () => {
      const report = buildFingerprintReport({ ...BASE_RAW, adBlockerDetected: false }, NO_FONTS);
      const row = findCategory(report, 'privacy').rows.find((r) => r.label === 'Ad blocker')!;
      expect(row.warning).toBeDefined();
      expect(row.warning!.steps.length).toBeGreaterThan(0);
    });

    it('does not warn when an ad blocker is detected', () => {
      const report = buildFingerprintReport({ ...BASE_RAW, adBlockerDetected: true }, NO_FONTS);
      const row = findCategory(report, 'privacy').rows.find((r) => r.label === 'Ad blocker')!;
      expect(row.warning).toBeUndefined();
    });

    it('does not warn while the ad blocker check is still pending', () => {
      const report = buildFingerprintReport({ ...BASE_RAW, adBlockerDetected: null }, NO_FONTS);
      const row = findCategory(report, 'privacy').rows.find((r) => r.label === 'Ad blocker')!;
      expect(row.warning).toBeUndefined();
    });

    it('warns when Global Privacy Control is not signaled', () => {
      const report = buildFingerprintReport({ ...BASE_RAW, globalPrivacyControl: false }, NO_FONTS);
      const row = findCategory(report, 'privacy').rows.find((r) => r.label === 'Global Privacy Control')!;
      expect(row.warning).toBeDefined();
    });

    it('does not warn when Global Privacy Control is signaled or unsupported', () => {
      const signaled = buildFingerprintReport({ ...BASE_RAW, globalPrivacyControl: true }, NO_FONTS);
      const unsupported = buildFingerprintReport({ ...BASE_RAW, globalPrivacyControl: null }, NO_FONTS);
      expect(findCategory(signaled, 'privacy').rows.find((r) => r.label === 'Global Privacy Control')!.warning).toBeUndefined();
      expect(findCategory(unsupported, 'privacy').rows.find((r) => r.label === 'Global Privacy Control')!.warning).toBeUndefined();
    });

    it('warns when the unmasked WebGL renderer is exposed', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
      const row = findCategory(report, 'rendering').rows.find((r) => r.label === 'Unmasked WebGL renderer')!;
      expect(row.warning).toBeDefined();
    });

    it('does not warn when the unmasked WebGL renderer is blocked', () => {
      const report = buildFingerprintReport({ ...BASE_RAW, webglUnmaskedRenderer: null }, NO_FONTS);
      const row = findCategory(report, 'rendering').rows.find((r) => r.label === 'Unmasked WebGL renderer')!;
      expect(row.warning).toBeUndefined();
    });

    it('warns on a granted permission, with steps naming that permission in browser settings', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
      const microphone = findCategory(report, 'permissions').rows.find((r) => r.label === 'Microphone')!;
      expect(microphone.warning).toBeDefined();
      expect(microphone.warning!.steps.some((s) => s.includes('Microphone'))).toBe(true);
    });

    it('does not warn on a denied or not-yet-asked permission', () => {
      const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
      expect(findCategory(report, 'permissions').rows.find((r) => r.label === 'Camera')!.warning).toBeUndefined();
      expect(findCategory(report, 'permissions').rows.find((r) => r.label === 'Geolocation')!.warning).toBeUndefined();
    });
  });
});

describe('describePlugins', () => {
  it('reports none for an empty list', () => {
    expect(describePlugins([])).toBe('None reported');
  });
  it('counts and lists plugin names', () => {
    expect(describePlugins(['PDF Viewer', 'Chrome PDF Viewer'])).toBe('2: PDF Viewer, Chrome PDF Viewer');
  });
});

describe('describeBattery', () => {
  it('reports unsupported with an explanation when the API does not exist', () => {
    expect(describeBattery(false, null, null)).toContain('Not supported');
  });
  it('reports "Computing…" while supported but still pending', () => {
    expect(describeBattery(true, null, null)).toBe('Computing…');
  });
  it('formats a resolved level and charging state', () => {
    expect(describeBattery(true, 0.5, true)).toBe('50%, charging');
  });
  it('rounds a fractional percentage', () => {
    expect(describeBattery(true, 0.873, false)).toBe('87%, not charging');
  });
});

describe('describeAdBlocker', () => {
  it('reports "Checking…" for null', () => {
    expect(describeAdBlocker(null)).toBe('Checking…');
  });
  it('reports detected', () => {
    expect(describeAdBlocker(true)).toBe('Detected');
  });
  it('reports not detected', () => {
    expect(describeAdBlocker(false)).toBe('Not detected');
  });
});

describe('describePermission', () => {
  it('reports "Checking…" for null', () => {
    expect(describePermission(null)).toBe('Checking…');
  });
  it('reports each terminal state', () => {
    expect(describePermission('granted')).toBe('Granted');
    expect(describePermission('denied')).toBe('Denied');
    expect(describePermission('prompt')).toContain('Not yet asked');
    expect(describePermission('unsupported')).toBe('Not supported by this browser');
  });
});

const BASE_SERVER: ServerSignals = {
  ip: '203.0.113.42',
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
  cookiesSent: false,
  headers: { 'user-agent': 'Mozilla/5.0 (Test)', 'accept-language': 'en-US,en;q=0.9' },
};

describe('buildNetworkCategory', () => {
  it('renders a not-available fallback for null server signals', () => {
    const category = buildNetworkCategory(null);
    expect(category.id).toBe('network');
    expect(category.rows).toHaveLength(1);
    expect(category.rows[0].label).toBe('Status');
  });

  it('formats the IP address and derived location', () => {
    const category = buildNetworkCategory(BASE_SERVER);
    expect(category.rows.find((r) => r.label === 'IP address')?.value).toBe('203.0.113.42');
    expect(category.rows.find((r) => r.label === 'Approximate location')?.value).toBe('New York, New York, US');
    expect(category.rows.find((r) => r.label === 'Coordinates')?.value).toBe('40.71427, -74.00597');
  });

  it('formats the ASN with an "AS" prefix', () => {
    const category = buildNetworkCategory(BASE_SERVER);
    expect(category.rows.find((r) => r.label === 'ASN')?.value).toBe('AS7922');
  });

  it('joins HTTP and TLS version into one connection value', () => {
    const category = buildNetworkCategory(BASE_SERVER);
    expect(category.rows.find((r) => r.label === 'Connection')?.value).toBe('HTTP/3 over TLSv1.3');
  });

  it('renders a friendly label for each known header and passes through the raw value', () => {
    const category = buildNetworkCategory(BASE_SERVER);
    expect(category.rows.find((r) => r.label === 'User-Agent')?.value).toBe('Mozilla/5.0 (Test)');
    expect(category.rows.find((r) => r.label === 'Accept-Language')?.value).toBe('en-US,en;q=0.9');
  });

  it('falls back to the raw header name when no friendly label is known', () => {
    const category = buildNetworkCategory({ ...BASE_SERVER, headers: { 'x-custom-header': 'value' } });
    expect(category.rows.find((r) => r.label === 'x-custom-header')?.value).toBe('value');
  });

  it('reports missing location parts as "Not reported"', () => {
    const category = buildNetworkCategory({ ...BASE_SERVER, city: null, region: null, country: null, latitude: null, longitude: null });
    expect(category.rows.find((r) => r.label === 'Approximate location')?.value).toBe('Not reported');
    expect(category.rows.find((r) => r.label === 'Coordinates')?.value).toBe('Not reported');
  });
});

describe('countSignals', () => {
  it('sums rows across every category in both sections', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const total = report.flatMap((s) => s.categories).reduce((sum, c) => sum + c.rows.length, 0);
    expect(countSignals(report)).toBe(total);
    expect(countSignals(report)).toBeGreaterThan(20);
  });
});

describe('reportToText', () => {
  it('renders section and category headers with indented rows', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const text = reportToText(report);
    expect(text).toContain('What your browser reveals');
    expect(text).toContain('What the server already saw');
    expect(text).toContain('Identity');
    expect(text).toContain('  User-Agent: Mozilla/5.0 (Test)');
  });

  it('separates categories with a blank line', () => {
    const report = buildFingerprintReport(BASE_RAW, NO_FONTS);
    const text = reportToText(report);
    expect(text).toContain('\n\n');
  });
});

describe('detectAvailableFonts', () => {
  const baseline = { serif: 100, 'sans-serif': 90, monospace: 80 };

  it('flags a font as available when its measured width differs from the baseline', () => {
    const result = detectAvailableFonts(
      [{ candidate: 'Georgia', widths: { serif: 105, 'sans-serif': 90, monospace: 80 } }],
      baseline
    );
    expect(result.available).toEqual(['Georgia']);
    expect(result.unavailable).toEqual([]);
  });

  it('flags a font as unavailable when every measured width matches the baseline', () => {
    const result = detectAvailableFonts(
      [{ candidate: 'NotInstalledFont', widths: { serif: 100, 'sans-serif': 90, monospace: 80 } }],
      baseline
    );
    expect(result.unavailable).toEqual(['NotInstalledFont']);
    expect(result.available).toEqual([]);
  });

  it('treats a difference in only one generic family as available', () => {
    const result = detectAvailableFonts(
      [{ candidate: 'Consolas', widths: { serif: 100, 'sans-serif': 90, monospace: 88 } }],
      baseline
    );
    expect(result.available).toEqual(['Consolas']);
  });

  it('ignores generic families missing from the measurement', () => {
    const result = detectAvailableFonts([{ candidate: 'Partial', widths: { monospace: 80 } }], baseline);
    expect(result.unavailable).toEqual(['Partial']);
  });

  it('preserves input order across multiple candidates', () => {
    const result = detectAvailableFonts(
      [
        { candidate: 'A', widths: { serif: 100, 'sans-serif': 90, monospace: 80 } },
        { candidate: 'B', widths: { serif: 999, 'sans-serif': 90, monospace: 80 } },
        { candidate: 'C', widths: { serif: 100, 'sans-serif': 90, monospace: 80 } },
      ],
      baseline
    );
    expect(result.unavailable).toEqual(['A', 'C']);
    expect(result.available).toEqual(['B']);
  });
});

describe('hashCanvasData', () => {
  it('returns a 64-character hex SHA-256 digest', async () => {
    const result = await hashCanvasData('data:image/png;base64,AAAA');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is deterministic for the same input', async () => {
    const a = await hashCanvasData('data:image/png;base64,same-input');
    const b = await hashCanvasData('data:image/png;base64,same-input');
    expect(a).toEqual(b);
  });

  it('produces different hashes for different input', async () => {
    const a = await hashCanvasData('data:image/png;base64,one');
    const b = await hashCanvasData('data:image/png;base64,two');
    expect(a).not.toEqual(b);
  });

  it('errors on empty input', async () => {
    const result = await hashCanvasData('');
    expect(result.ok).toBe(false);
  });
});
