import { describe, it, expect } from 'vitest';
import { parseUserAgent, explainUaTokens } from './userAgent';

// Real-world UA strings, one per client, so the regexes are checked against what
// actually ships rather than a hand-simplified approximation.
const UAS = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.79',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ie11: 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  facebookInApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0;FBBV/123456;FBDV/iPhone15,3;FBSV/17.5.1] Safari/604.1',
  instagramInApp:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 Instagram 312.0.0.34.111 Android',
};

describe('parseUserAgent', () => {
  it('rejects an empty string', () => {
    expect(parseUserAgent('').ok).toBe(false);
    expect(parseUserAgent('   ').ok).toBe(false);
  });

  it('rejects unrecognisable input with a helpful message', () => {
    const result = parseUserAgent('not a real user agent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not recognise/i);
  });

  it('identifies Chrome on Windows as desktop', () => {
    const result = parseUserAgent(UAS.chromeWindows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser).toEqual({ name: 'Chrome', version: '128.0.0.0' });
    expect(result.value.os.name).toBe('Windows');
    expect(result.value.os.version).toBe('10/11');
    expect(result.value.engine).toBe('Blink (Chromium)');
    expect(result.value.device).toBe('desktop');
    expect(result.value.architecture).toBe('x64');
    expect(result.value.deviceModel).toBeNull();
    expect(result.value.inApp).toBeNull();
  });

  it('identifies Firefox on Linux', () => {
    const result = parseUserAgent(UAS.firefoxLinux);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser).toEqual({ name: 'Firefox', version: '130.0' });
    expect(result.value.os.name).toBe('Linux');
    expect(result.value.engine).toBe('Gecko');
    expect(result.value.device).toBe('desktop');
    expect(result.value.architecture).toBe('x86_64');
  });

  it('identifies Safari on macOS, not Chrome', () => {
    const result = parseUserAgent(UAS.safariMac);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser.name).toBe('Safari');
    expect(result.value.browser.version).toBe('17.5');
    expect(result.value.os).toEqual({ name: 'macOS', version: '10.15.7' });
    expect(result.value.engine).toBe('WebKit');
    expect(result.value.architecture).toBe('Intel (x64)');
  });

  it('identifies Edge, not the Chrome it is built on', () => {
    const result = parseUserAgent(UAS.edgeWindows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser.name).toBe('Edge');
    expect(result.value.browser.version).toBe('128.0.2739.79');
  });

  it('identifies Opera, not the Chrome it is built on', () => {
    const result = parseUserAgent(UAS.operaWindows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser.name).toBe('Opera');
  });

  it('identifies Samsung Internet, not the Chrome it is built on', () => {
    const result = parseUserAgent(UAS.samsungInternet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser.name).toBe('Samsung Internet');
    expect(result.value.device).toBe('mobile');
    expect(result.value.deviceModel).toBe('SM-S918B');
  });

  it('identifies Chrome on Android as mobile, with the device model', () => {
    const result = parseUserAgent(UAS.chromeAndroid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.os).toEqual({ name: 'Android', version: '14' });
    expect(result.value.device).toBe('mobile');
    expect(result.value.deviceModel).toBe('Pixel 8');
  });

  it('identifies Safari on iPhone as mobile, with dotted iOS version', () => {
    const result = parseUserAgent(UAS.safariIphone);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.os).toEqual({ name: 'iOS', version: '17.5.1' });
    expect(result.value.device).toBe('mobile');
    expect(result.value.deviceModel).toBe('iPhone');
  });

  it('identifies Safari on iPad as tablet', () => {
    const result = parseUserAgent(UAS.safariIpad);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.os.name).toBe('iOS');
    expect(result.value.device).toBe('tablet');
    expect(result.value.deviceModel).toBe('iPad');
  });

  it('identifies Googlebot as a bot, not a desktop browser', () => {
    const result = parseUserAgent(UAS.googlebot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser).toEqual({ name: 'Googlebot', version: '2.1' });
    expect(result.value.device).toBe('bot');
  });

  it('identifies Internet Explorer 11 despite its unusual UA shape', () => {
    const result = parseUserAgent(UAS.ie11);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browser.name).toBe('Internet Explorer');
    expect(result.value.browser.version).toBe('11.0');
  });

  it('handles trailing and leading whitespace', () => {
    expect(parseUserAgent(`  ${UAS.chromeWindows}  `).ok).toBe(true);
  });

  it('reports WOW64 (32-bit process on 64-bit Windows) as x64', () => {
    const result = parseUserAgent(UAS.ie11);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.architecture).toBe('x64');
  });

  it('strips a trailing Build/ tag from an Android device model', () => {
    const result = parseUserAgent(UAS.instagramInApp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deviceModel).toBe('Pixel 8');
  });

  it('identifies the Facebook in-app browser on an otherwise-Safari UA', () => {
    const result = parseUserAgent(UAS.facebookInApp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inApp).toBe('Facebook');
    expect(result.value.deviceModel).toBe('iPhone');
  });

  it('identifies the Instagram in-app browser', () => {
    const result = parseUserAgent(UAS.instagramInApp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inApp).toBe('Instagram');
  });

  it('does not misread the Instagram-appended trailing "Android" token as a tablet signal', () => {
    // Regression: this UA's Android phone would previously be misclassified as a
    // tablet, because a lookahead anchored to the *first* "Android" token saw no
    // "Mobile" after the bare "Android" Instagram appends at the very end.
    const result = parseUserAgent(UAS.instagramInApp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.device).toBe('mobile');
  });

  it('leaves inApp null for a standalone browser', () => {
    const result = parseUserAgent(UAS.chromeWindows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inApp).toBeNull();
  });

  it('reports no device model for a desktop UA', () => {
    const result = parseUserAgent(UAS.linuxFirefox);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deviceModel).toBeNull();
  });
});

describe('explainUaTokens', () => {
  it('returns nothing for an empty string', () => {
    expect(explainUaTokens('')).toEqual([]);
  });

  it('reassembles back to the exact original string', () => {
    for (const ua of Object.values(UAS)) {
      const segments = explainUaTokens(ua);
      expect(segments.map((segment) => segment.text).join('')).toBe(ua);
    }
  });

  it('labels the historical Mozilla/5.0 token', () => {
    const segments = explainUaTokens(UAS.chromeWindows);
    const mozilla = segments.find((segment) => segment.text === 'Mozilla/5.0');
    expect(mozilla?.label).toBe('Mozilla/5.0');
    expect(mozilla?.explain).toMatch(/Netscape/);
  });

  it('distinguishes the Chrome token from the trailing legacy Safari token', () => {
    const segments = explainUaTokens(UAS.chromeWindows);
    const chrome = segments.find((segment) => segment.text === 'Chrome/128.0.0.0');
    const safari = segments.find((segment) => segment.text === 'Safari/537.36');
    expect(chrome?.label).toBe('Chrome');
    expect(safari?.label).toBe('Safari');
    expect(safari?.explain).toMatch(/not proof/i);
  });

  it('labels Version/x.y as the real Safari version, distinct from the Safari build token', () => {
    const segments = explainUaTokens(UAS.safariMac);
    const version = segments.find((segment) => segment.text === 'Version/17.5');
    expect(version?.label).toBe('Version');
  });

  it('leaves punctuation and whitespace between tokens unlabelled', () => {
    const segments = explainUaTokens(UAS.chromeWindows);
    const gap = segments.find((segment) => segment.text === ' (');
    expect(gap).toBeDefined();
    expect(gap?.label).toBeNull();
    expect(gap?.explain).toBeNull();
  });

  it('does not double-count overlapping tokens, e.g. AppleWebKit is not also matched as Safari', () => {
    const segments = explainUaTokens(UAS.chromeWindows);
    const total = segments.reduce((sum, segment) => sum + segment.text.length, 0);
    expect(total).toBe(UAS.chromeWindows.length);
  });
});
