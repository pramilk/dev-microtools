import { type ToolResult, ok, err, messageFrom } from './result';
import { parseColor, rgbToHex } from './color';

export const QR_ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorCorrectionLevel = (typeof QR_ERROR_CORRECTION_LEVELS)[number];

export interface QrMatrix {
  moduleCount: number;
  isDark: (row: number, col: number) => boolean;
}

/**
 * The library's maximum QR version (40) tops out around 2953 bytes at the lowest error
 * correction level. This cap sits comfortably under that regardless of encoding mode or
 * multi-byte UTF-8 expansion, and produces a clear error before the library's own.
 */
export const MAX_QR_TEXT_LENGTH = 1500;

/**
 * Builds a QR code as a boolean matrix — dark/light per module — rather than rendering
 * an image directly, so the island can draw it as SVG (crisp at any size, easy to theme
 * for dark mode, and trivial to export as either SVG or PNG).
 */
export async function generateQrMatrix(
  text: string,
  errorCorrection: QrErrorCorrectionLevel = 'M',
  options: { emptyMessage?: string } = {}
): Promise<ToolResult<QrMatrix>> {
  if (text.length === 0) return err(options.emptyMessage ?? 'Enter some text or a URL to generate a QR code.');
  if (text.length > MAX_QR_TEXT_LENGTH) {
    return err(`That text is too long for a QR code (limit ${MAX_QR_TEXT_LENGTH} characters).`);
  }

  // `qrcode-generator` is a CommonJS `export =` module; the bundler wraps it as
  // `{ default: QRCodeFactory }` at runtime for a dynamic `import()`, which the
  // DefinitelyTyped-style `export =` declaration doesn't reflect — hence the cast,
  // the same pattern `hash.ts` uses for `spark-md5`.
  type QrCodeFactory = typeof import('qrcode-generator');
  let createQrCode: QrCodeFactory;
  try {
    const loaded = (await import('qrcode-generator')) as unknown as { default: QrCodeFactory };
    createQrCode = loaded.default;
  } catch {
    return err('Could not load the QR code generator. Check your connection and reload the page.');
  }

  try {
    // Type number 0 asks the library to pick the smallest version that fits the data.
    const qr = createQrCode(0, errorCorrection);
    qr.addData(text);
    qr.make();
    const moduleCount = qr.getModuleCount();
    return ok({ moduleCount, isDark: (row: number, col: number) => qr.isDark(row, col) });
  } catch (error) {
    return err(messageFrom(error, 'Could not generate a QR code for that text.'));
  }
}

export interface QrLogoOptions {
  /** A `data:` URL for the logo image, e.g. read from a file with `FileReader`. */
  dataUrl: string;
  /** Fraction of the code's width the logo (including its backing pad) occupies. Clamped to a safe range. */
  sizeRatio?: number;
}

export interface QrCaptionOptions {
  text: string;
  color?: string;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes a possibly-untrusted color string (e.g. restored from a share-link, which is
 * attacker-controlled `JSON.parse`d data) to a safe `#rrggbb[aa]` value before it's
 * interpolated into an SVG attribute below. Anything that isn't a real color — including an
 * attribute-breakout payload like `red" onmouseover="..."` — falls back instead of reaching
 * the markup, since `matrixToSvg`'s output is inserted via `dangerouslySetInnerHTML`.
 */
function safeSvgColor(value: string, fallback: string): string {
  const parsed = parseColor(value);
  return parsed.ok ? rgbToHex(parsed.value) : fallback;
}

function captionHeightFor(cellSize: number, captionText: string): number {
  return captionText.trim() !== '' ? Math.round(cellSize * 3.4) : 0;
}

/**
 * The pixel size `matrixToSvg` will render at for the same matrix/options — callers that
 * rasterize the SVG onto a canvas (PNG export, clipboard copy) need this to size the canvas
 * correctly, since a caption makes the image taller than the code itself.
 */
export function qrImageDimensions(
  matrix: QrMatrix,
  options: { cellSize?: number; caption?: QrCaptionOptions } = {}
): { width: number; height: number } {
  const { cellSize = 8, caption } = options;
  const size = matrix.moduleCount * cellSize;
  return { width: size, height: size + captionHeightFor(cellSize, caption?.text ?? '') };
}

/**
 * Renders a matrix as an inline SVG string — used for both preview and SVG download.
 *
 * A logo is drawn as a plain overlay on top of the finished code rather than by carving
 * a hole out of the module grid: the underlying modules are still fully encoded, and the
 * overlay just visually covers them. That only decodes reliably at error correction level
 * H, which has enough redundancy to reconstruct the obscured area — callers that accept a
 * logo are expected to force level H alongside it.
 *
 * A caption is drawn below the code, inside the same SVG, rather than as separate on-page
 * markup — that's the only way it survives a PNG/SVG download or a print, which is the
 * whole point of a caption like "Pay with PayPal" on a code meant to be printed.
 */
export function matrixToSvg(
  matrix: QrMatrix,
  options: {
    cellSize?: number;
    darkColor?: string;
    lightColor?: string;
    logo?: QrLogoOptions;
    caption?: QrCaptionOptions;
  } = {}
): string {
  const { cellSize = 8, logo, caption } = options;
  const darkColor = safeSvgColor(options.darkColor ?? '#000000', '#000000');
  const lightColor = safeSvgColor(options.lightColor ?? '#ffffff', '#ffffff');
  const size = matrix.moduleCount * cellSize;

  let path = '';
  for (let row = 0; row < matrix.moduleCount; row += 1) {
    for (let col = 0; col < matrix.moduleCount; col += 1) {
      if (matrix.isDark(row, col)) {
        path += `M${col * cellSize},${row * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`;
      }
    }
  }

  let overlay = '';
  if (logo) {
    const ratio = Math.min(Math.max(logo.sizeRatio ?? 0.2, 0.1), 0.3);
    const logoSize = size * ratio;
    const pad = logoSize * 0.15;
    const padded = logoSize + pad * 2;
    const padOffset = (size - padded) / 2;
    const logoOffset = (size - logoSize) / 2;
    overlay =
      `<rect x="${padOffset}" y="${padOffset}" width="${padded}" height="${padded}" rx="${pad}" fill="${lightColor}"/>` +
      `<image x="${logoOffset}" y="${logoOffset}" width="${logoSize}" height="${logoSize}" ` +
      `href="${logo.dataUrl}" xlink:href="${logo.dataUrl}" preserveAspectRatio="xMidYMid slice"/>`;
  }

  const captionText = caption?.text.trim() ?? '';
  const captionHeight = captionHeightFor(cellSize, captionText);
  const totalHeight = size + captionHeight;
  let captionMarkup = '';
  if (captionText !== '') {
    const fontSize = Math.round(cellSize * 1.7);
    const captionColor = caption?.color !== undefined ? safeSvgColor(caption.color, darkColor) : darkColor;
    captionMarkup =
      `<rect x="0" y="${size}" width="${size}" height="${captionHeight}" fill="${lightColor}"/>` +
      `<text x="${size / 2}" y="${size + captionHeight / 2}" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${fontSize}" font-weight="600" ` +
      `fill="${captionColor}">${escapeXmlText(captionText)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${size} ${totalHeight}" width="${size}" height="${totalHeight}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${totalHeight}" fill="${lightColor}"/>` +
    `<path d="${path}" fill="${darkColor}"/>` +
    overlay +
    captionMarkup +
    `</svg>`
  );
}

// --- Content-type payload builders ---------------------------------------------------
//
// Each builder turns a small set of structured fields into the plain-text payload that
// `generateQrMatrix` encodes — QR readers recognise these formats (WIFI:, vCard, SMSTO:,
// mailto:, geo:) and offer a matching action (join network, add contact, ...) instead of
// just showing raw text. The island decides *when* to call a builder (only once the
// fields that make the payload meaningful are filled in); these functions assume valid,
// present input and just format it.

export const QR_CONTENT_TYPES = ['text', 'wifi', 'vcard', 'sms', 'email', 'geo', 'payment'] as const;
export type QrContentType = (typeof QR_CONTENT_TYPES)[number];

export const WIFI_ENCRYPTION_TYPES = ['WPA', 'WEP', 'nopass'] as const;
export type WifiEncryptionType = (typeof WIFI_ENCRYPTION_TYPES)[number];

export interface WifiFields {
  ssid: string;
  password: string;
  encryption: WifiEncryptionType;
  hidden: boolean;
}

export interface VCardFields {
  name: string;
  organization: string;
  jobTitle: string;
  phone: string;
  email: string;
  website: string;
  address: string;
}

export interface SmsFields {
  phone: string;
  message: string;
}

export interface EmailFields {
  to: string;
  subject: string;
  body: string;
}

export interface GeoFields {
  latitude: string;
  longitude: string;
}

export const PAYMENT_PROVIDERS = ['paypal', 'venmo', 'cashapp'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export interface PaymentFields {
  provider: PaymentProvider;
  /** Username or $cashtag — which, depends on the provider. */
  recipient: string;
  amount: string;
  note: string;
}

/** Escapes characters that are structurally significant in WIFI:/vCard field values. */
function escapeSpecialChars(value: string, chars: string): string {
  let result = '';
  for (const char of value) {
    if (chars.includes(char)) result += '\\';
    result += char;
  }
  return result;
}

/** Builds a `WIFI:` payload — scanning it prompts most phones to join the network directly. */
export function buildWifiText(fields: WifiFields): string {
  const ssid = escapeSpecialChars(fields.ssid.trim(), '\\;,:"');
  const password = fields.encryption === 'nopass' ? '' : escapeSpecialChars(fields.password, '\\;,:"');
  const hidden = fields.hidden ? 'true' : 'false';
  return `WIFI:T:${fields.encryption};S:${ssid};P:${password};H:${hidden};;`;
}

function escapeVCardValue(value: string): string {
  return escapeSpecialChars(value, '\\;,').replace(/\r?\n/g, '\\n');
}

/** Builds a vCard 3.0 payload — scanning it prompts most phones to save a new contact. */
export function buildVCardText(fields: VCardFields): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  if (fields.name.trim() !== '') lines.push(`FN:${escapeVCardValue(fields.name.trim())}`);
  if (fields.organization.trim() !== '') lines.push(`ORG:${escapeVCardValue(fields.organization.trim())}`);
  if (fields.jobTitle.trim() !== '') lines.push(`TITLE:${escapeVCardValue(fields.jobTitle.trim())}`);
  if (fields.phone.trim() !== '') lines.push(`TEL:${escapeVCardValue(fields.phone.trim())}`);
  if (fields.email.trim() !== '') lines.push(`EMAIL:${escapeVCardValue(fields.email.trim())}`);
  if (fields.website.trim() !== '') lines.push(`URL:${escapeVCardValue(fields.website.trim())}`);
  if (fields.address.trim() !== '') lines.push(`ADR:;;${escapeVCardValue(fields.address.trim())};;;;`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

/** Builds an `SMSTO:` payload — scanning it opens a pre-filled text message. */
export function buildSmsText(fields: SmsFields): string {
  return `SMSTO:${fields.phone.trim()}:${fields.message}`;
}

/** Builds a `mailto:` payload — scanning it opens a pre-filled email. */
export function buildEmailText(fields: EmailFields): string {
  const params: string[] = [];
  if (fields.subject.trim() !== '') params.push(`subject=${encodeURIComponent(fields.subject.trim())}`);
  if (fields.body.trim() !== '') params.push(`body=${encodeURIComponent(fields.body)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return `mailto:${fields.to.trim()}${query}`;
}

/** Builds a `geo:` payload — scanning it opens the coordinates in a maps app. */
export function buildGeoText(fields: GeoFields): string {
  return `geo:${fields.latitude.trim()},${fields.longitude.trim()}`;
}

/**
 * Builds a payment payload. Each of these providers has a real link format that opens
 * straight into a pre-filled payment screen when scanned, built from just a username (or
 * $cashtag) and an optional amount — unlike, say, Zelle (bound to bank enrollment, no
 * public URL format) or Stripe/Square (opaque per-merchant links minted in their own
 * dashboard, not derivable from a username), neither of which fits this "type a username,
 * get a working link" shape.
 */
export function buildPaymentText(fields: PaymentFields): string {
  const recipient = fields.recipient.trim().replace(/^[$@]/, '');
  const amount = fields.amount.trim().replace(/^\$/, '');
  const note = fields.note.trim();

  switch (fields.provider) {
    case 'paypal':
      return `https://paypal.me/${recipient}${amount !== '' ? `/${amount}` : ''}`;
    case 'venmo': {
      const params = [`txn=pay`, `recipients=${encodeURIComponent(recipient)}`];
      if (amount !== '') params.push(`amount=${encodeURIComponent(amount)}`);
      if (note !== '') params.push(`note=${encodeURIComponent(note)}`);
      return `venmo://paycharge?${params.join('&')}`;
    }
    case 'cashapp':
      return `https://cash.app/$${recipient}${amount !== '' ? `/${amount}` : ''}`;
  }
}

/** True when both coordinates are present, numeric, and within valid ranges. */
export function isValidGeoCoordinate(latitude: string, longitude: string): boolean {
  if (latitude.trim() === '' || longitude.trim() === '') return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const COORDINATE_PATTERNS = [
  // A full Maps URL that centers on a point, e.g. .../@40.6892,-74.0445,17z
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  // A `q=`, `ll=` or `query=` parameter carrying "lat,lng", e.g. ?q=40.6892,-74.0445
  /[?&](?:q|ll|query)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  // The bare "lat, lng" pair someone copied straight out of Maps' info panel.
  /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/,
];

/**
 * Pulls a latitude/longitude pair out of a pasted Google Maps link or a bare
 * "lat, lng" string — typing raw coordinates by hand is unreasonable to expect, but a
 * Maps URL (copied from the address bar after centering on a place) or the "lat, lng"
 * text Maps shows in its info panel both carry the coordinates in plain sight in the
 * text itself, so this can be parsed without any network request. Returns null if no
 * coordinate pair is found, or if the numbers found are out of range (most often a
 * shortened maps.app.goo.gl link, which redirects server-side and carries no
 * coordinates in the URL text at all).
 */
export function parseGeoLocationInput(input: string): GeoFields | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  for (const pattern of COORDINATE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const [, latitude, longitude] = match as unknown as [string, string, string];
    if (isValidGeoCoordinate(latitude, longitude)) return { latitude, longitude };
  }
  return null;
}
