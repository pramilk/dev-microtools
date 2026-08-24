import { describe, it, expect } from 'vitest';
import {
  generateQrMatrix,
  matrixToSvg,
  qrImageDimensions,
  buildWifiText,
  buildVCardText,
  buildSmsText,
  buildEmailText,
  buildGeoText,
  isValidGeoCoordinate,
  parseGeoLocationInput,
  buildPaymentText,
  MAX_QR_TEXT_LENGTH,
} from './qrcode';

describe('generateQrMatrix', () => {
  it('rejects empty input', async () => {
    const result = await generateQrMatrix('');
    expect(result.ok).toBe(false);
  });

  it('rejects text over the length cap', async () => {
    const result = await generateQrMatrix('a'.repeat(MAX_QR_TEXT_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(String(MAX_QR_TEXT_LENGTH));
  });

  it('produces a valid QR module grid for short text', async () => {
    const result = await generateQrMatrix('https://devmicrotools.com', 'M');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Valid QR versions are 21, 25, 29, ... 177 modules (4 * version + 17).
    expect(result.value.moduleCount).toBeGreaterThanOrEqual(21);
    expect((result.value.moduleCount - 17) % 4).toBe(0);
  });

  it('reports dark/light for every module without throwing', async () => {
    const result = await generateQrMatrix('hello world', 'L');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let darkCount = 0;
    for (let row = 0; row < result.value.moduleCount; row += 1) {
      for (let col = 0; col < result.value.moduleCount; col += 1) {
        if (result.value.isDark(row, col)) darkCount += 1;
      }
    }
    // A real QR code is never all-light or all-dark — the finder patterns alone
    // guarantee a substantial mix.
    expect(darkCount).toBeGreaterThan(0);
    expect(darkCount).toBeLessThan(result.value.moduleCount * result.value.moduleCount);
  });

  it('produces a larger matrix for longer text at the same error correction level', async () => {
    const short = await generateQrMatrix('a', 'M');
    const long = await generateQrMatrix('a'.repeat(500), 'M');
    expect(short.ok && long.ok).toBe(true);
    if (short.ok && long.ok) {
      expect(long.value.moduleCount).toBeGreaterThan(short.value.moduleCount);
    }
  });

  it('produces a valid matrix at every error correction level', async () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const result = await generateQrMatrix('test data', level);
      expect(result.ok).toBe(true);
    }
  });
});

describe('matrixToSvg', () => {
  const flatMatrix = { moduleCount: 3, isDark: (row: number, col: number) => (row + col) % 2 === 0 };

  it('renders a well-formed SVG string sized to the module count and cell size', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="30"');
    expect(svg).toContain('height="30"');
    expect(svg).toContain('</svg>');
  });

  it('uses the default colours when none are given', () => {
    const svg = matrixToSvg(flatMatrix);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
  });

  it('honours custom dark and light colours', () => {
    const svg = matrixToSvg(flatMatrix, { darkColor: '#123456', lightColor: '#abcdef' });
    expect(svg).toContain('fill="#abcdef"');
    expect(svg).toContain('fill="#123456"');
  });

  it('draws one path command per dark module', () => {
    const allDark = { moduleCount: 2, isDark: () => true };
    const svg = matrixToSvg(allDark, { cellSize: 5 });
    const commandCount = (svg.match(/M\d/g) ?? []).length;
    expect(commandCount).toBe(4);
  });

  it('omits the logo overlay when no logo is given', () => {
    const svg = matrixToSvg(flatMatrix);
    expect(svg).not.toContain('<image');
  });

  it('draws a backing rect and an image element when a logo is given', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10, logo: { dataUrl: 'data:image/png;base64,AAAA' } });
    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('<rect x=');
  });

  it('clamps an out-of-range logo size ratio', () => {
    const tooSmall = matrixToSvg(flatMatrix, { cellSize: 100, logo: { dataUrl: 'x', sizeRatio: 0.01 } });
    const tooBig = matrixToSvg(flatMatrix, { cellSize: 100, logo: { dataUrl: 'x', sizeRatio: 0.9 } });
    // 3 modules * 100 cellSize = 300; clamped ratio range is [0.1, 0.3].
    expect(tooSmall).toContain('width="30"'); // 300 * 0.1
    expect(tooBig).toContain('width="90"'); // 300 * 0.3
  });

  it('omits a caption when none is given', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10 });
    expect(svg).not.toContain('<text');
    expect(svg).toContain('height="30"');
  });

  it('draws a caption below the code and grows the SVG height to fit it', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10, caption: { text: 'Pay with PayPal' } });
    expect(svg).toContain('<text');
    expect(svg).toContain('Pay with PayPal');
    expect(svg).toContain('width="30"'); // width unchanged — only height grows
    expect(svg).not.toContain('height="30"'); // height must have grown past the bare code size
  });

  it('omits a caption that is only whitespace', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10, caption: { text: '   ' } });
    expect(svg).not.toContain('<text');
  });

  it('escapes XML-significant characters in the caption', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10, caption: { text: '<Pay> "Me" & Co' } });
    expect(svg).toContain('&lt;Pay&gt; &quot;Me&quot; &amp; Co');
    expect(svg).not.toContain('<Pay>');
  });

  it('uses a custom caption colour, falling back to the dark colour', () => {
    const withColor = matrixToSvg(flatMatrix, { cellSize: 10, darkColor: '#111', caption: { text: 'Hi', color: '#f00' } });
    expect(withColor).toContain('fill="#f00">Hi');
    const withoutColor = matrixToSvg(flatMatrix, { cellSize: 10, darkColor: '#111', caption: { text: 'Hi' } });
    expect(withoutColor).toContain('fill="#111">Hi');
  });
});

describe('qrImageDimensions', () => {
  it('returns the bare code size when there is no caption', () => {
    const matrix = { moduleCount: 21, isDark: () => false };
    expect(qrImageDimensions(matrix, { cellSize: 10 })).toEqual({ width: 210, height: 210 });
  });

  it('adds extra height for a caption without changing the width', () => {
    const matrix = { moduleCount: 21, isDark: () => false };
    const { width, height } = qrImageDimensions(matrix, { cellSize: 10, caption: { text: 'Pay with PayPal' } });
    expect(width).toBe(210);
    expect(height).toBeGreaterThan(210);
  });

  it('matches the height matrixToSvg actually renders at', () => {
    const matrix = { moduleCount: 21, isDark: () => false };
    const options = { cellSize: 10, caption: { text: 'Scan me' } };
    const svg = matrixToSvg(matrix, options);
    const { height } = qrImageDimensions(matrix, options);
    expect(svg).toContain(`height="${height}"`);
  });
});

describe('buildWifiText', () => {
  it('builds a WIFI payload for a WPA network', () => {
    const text = buildWifiText({ ssid: 'MyNet', password: 'secret1', encryption: 'WPA', hidden: false });
    expect(text).toBe('WIFI:T:WPA;S:MyNet;P:secret1;H:false;;');
  });

  it('omits the password for an open network', () => {
    const text = buildWifiText({ ssid: 'FreeWifi', password: 'ignored', encryption: 'nopass', hidden: false });
    expect(text).toBe('WIFI:T:nopass;S:FreeWifi;P:;H:false;;');
  });

  it('marks a hidden network', () => {
    const text = buildWifiText({ ssid: 'Hidden', password: 'pw', encryption: 'WEP', hidden: true });
    expect(text).toContain('H:true');
  });

  it('escapes special characters in the SSID and password', () => {
    const text = buildWifiText({ ssid: 'a;b,c:d"e\\f', password: 'p;q', encryption: 'WPA', hidden: false });
    expect(text).toBe('WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;q;H:false;;');
  });

  it('handles unicode SSIDs', () => {
    const text = buildWifiText({ ssid: '咖啡店', password: 'pw', encryption: 'WPA', hidden: false });
    expect(text).toContain('S:咖啡店');
  });
});

describe('buildVCardText', () => {
  it('includes only the fields that are filled in', () => {
    const text = buildVCardText({
      name: 'Jordan Lee',
      organization: '',
      jobTitle: '',
      phone: '+1 555 0100',
      email: '',
      website: '',
      address: '',
    });
    expect(text).toContain('BEGIN:VCARD');
    expect(text).toContain('FN:Jordan Lee');
    expect(text).toContain('TEL:+1 555 0100');
    expect(text).not.toContain('ORG:');
    expect(text).not.toContain('EMAIL:');
    expect(text.trim().endsWith('END:VCARD')).toBe(true);
  });

  it('produces an empty card when every field is blank', () => {
    const text = buildVCardText({
      name: '',
      organization: '',
      jobTitle: '',
      phone: '',
      email: '',
      website: '',
      address: '',
    });
    expect(text).toBe('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD');
  });

  it('escapes commas, semicolons and newlines', () => {
    const text = buildVCardText({
      name: 'Doe, Jane',
      organization: 'A; B\nC',
      jobTitle: '',
      phone: '',
      email: '',
      website: '',
      address: '',
    });
    expect(text).toContain('FN:Doe\\, Jane');
    expect(text).toContain('ORG:A\\; B\\nC');
  });
});

describe('buildSmsText', () => {
  it('builds an SMSTO payload', () => {
    expect(buildSmsText({ phone: '+15550100', message: 'Hi there' })).toBe('SMSTO:+15550100:Hi there');
  });

  it('trims the phone number but keeps the message intact', () => {
    expect(buildSmsText({ phone: ' +15550100 ', message: '  spaced  ' })).toBe('SMSTO:+15550100:  spaced  ');
  });

  it('handles an empty message', () => {
    expect(buildSmsText({ phone: '123', message: '' })).toBe('SMSTO:123:');
  });
});

describe('buildEmailText', () => {
  it('builds a bare mailto with no subject or body', () => {
    expect(buildEmailText({ to: 'hello@example.com', subject: '', body: '' })).toBe('mailto:hello@example.com');
  });

  it('percent-encodes subject and body', () => {
    const text = buildEmailText({ to: 'a@b.com', subject: 'Hi there', body: 'Line one & two' });
    expect(text).toBe('mailto:a@b.com?subject=Hi%20there&body=Line%20one%20%26%20two');
  });

  it('includes only the subject when the body is blank', () => {
    const text = buildEmailText({ to: 'a@b.com', subject: 'Hi', body: '' });
    expect(text).toBe('mailto:a@b.com?subject=Hi');
  });
});

describe('buildGeoText', () => {
  it('builds a geo URI from coordinates', () => {
    expect(buildGeoText({ latitude: '40.6892', longitude: '-74.0445' })).toBe('geo:40.6892,-74.0445');
  });

  it('trims whitespace', () => {
    expect(buildGeoText({ latitude: ' 1.5 ', longitude: ' -2.5 ' })).toBe('geo:1.5,-2.5');
  });
});

describe('isValidGeoCoordinate', () => {
  it('accepts valid coordinates', () => {
    expect(isValidGeoCoordinate('40.6892', '-74.0445')).toBe(true);
    expect(isValidGeoCoordinate('-90', '180')).toBe(true);
    expect(isValidGeoCoordinate('0', '0')).toBe(true);
  });

  it('rejects blank fields', () => {
    expect(isValidGeoCoordinate('', '-74.0445')).toBe(false);
    expect(isValidGeoCoordinate('40.6892', '')).toBe(false);
    expect(isValidGeoCoordinate('', '')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidGeoCoordinate('north', '-74.0445')).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isValidGeoCoordinate('91', '0')).toBe(false);
    expect(isValidGeoCoordinate('0', '181')).toBe(false);
    expect(isValidGeoCoordinate('-91', '0')).toBe(false);
    expect(isValidGeoCoordinate('0', '-181')).toBe(false);
  });
});

describe('buildPaymentText', () => {
  it('builds a bare PayPal.me link with no amount', () => {
    expect(buildPaymentText({ provider: 'paypal', recipient: 'yourname', amount: '', note: '' })).toBe(
      'https://paypal.me/yourname'
    );
  });

  it('appends the amount to a PayPal.me link', () => {
    expect(buildPaymentText({ provider: 'paypal', recipient: 'yourname', amount: '25', note: '' })).toBe(
      'https://paypal.me/yourname/25'
    );
  });

  it('builds a Venmo deep link with recipient, amount, and note', () => {
    const text = buildPaymentText({ provider: 'venmo', recipient: 'jordan-lee', amount: '10', note: 'Lunch' });
    expect(text).toBe('venmo://paycharge?txn=pay&recipients=jordan-lee&amount=10&note=Lunch');
  });

  it('omits Venmo amount and note params when blank', () => {
    expect(buildPaymentText({ provider: 'venmo', recipient: 'jordan-lee', amount: '', note: '' })).toBe(
      'venmo://paycharge?txn=pay&recipients=jordan-lee'
    );
  });

  it('percent-encodes the Venmo note', () => {
    const text = buildPaymentText({ provider: 'venmo', recipient: 'jordan-lee', amount: '', note: 'Thanks & bye' });
    expect(text).toContain('note=Thanks%20%26%20bye');
  });

  it('strips a leading $ or @ from the recipient', () => {
    expect(buildPaymentText({ provider: 'cashapp', recipient: '$yourtag', amount: '', note: '' })).toBe(
      'https://cash.app/$yourtag'
    );
    expect(buildPaymentText({ provider: 'venmo', recipient: '@jordan-lee', amount: '', note: '' })).toBe(
      'venmo://paycharge?txn=pay&recipients=jordan-lee'
    );
  });

  it('appends the amount to a Cash App link', () => {
    expect(buildPaymentText({ provider: 'cashapp', recipient: 'yourtag', amount: '25', note: '' })).toBe(
      'https://cash.app/$yourtag/25'
    );
  });

  it('strips a leading $ from the amount', () => {
    expect(buildPaymentText({ provider: 'paypal', recipient: 'yourname', amount: '$25', note: '' })).toBe(
      'https://paypal.me/yourname/25'
    );
  });
});

describe('parseGeoLocationInput', () => {
  it('extracts coordinates from a full Maps place URL', () => {
    const url = 'https://www.google.com/maps/place/New+York/@40.6892,-74.0445,17z/data=...';
    expect(parseGeoLocationInput(url)).toEqual({ latitude: '40.6892', longitude: '-74.0445' });
  });

  it('extracts coordinates from a q= query parameter', () => {
    expect(parseGeoLocationInput('https://maps.google.com/?q=40.6892,-74.0445')).toEqual({
      latitude: '40.6892',
      longitude: '-74.0445',
    });
  });

  it('extracts coordinates from an ll= query parameter', () => {
    expect(parseGeoLocationInput('https://maps.google.com/maps?ll=-33.8688,151.2093&z=12')).toEqual({
      latitude: '-33.8688',
      longitude: '151.2093',
    });
  });

  it('accepts a bare "lat, lng" pair', () => {
    expect(parseGeoLocationInput('40.6892, -74.0445')).toEqual({ latitude: '40.6892', longitude: '-74.0445' });
  });

  it('returns null for a shortened link with no coordinates in the text', () => {
    expect(parseGeoLocationInput('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseGeoLocationInput('')).toBeNull();
    expect(parseGeoLocationInput('   ')).toBeNull();
  });

  it('returns null when the numbers found are out of range', () => {
    expect(parseGeoLocationInput('200, 300')).toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(parseGeoLocationInput('just some notes, nothing here')).toBeNull();
  });
});
