import { type ToolResult, ok, err, messageFrom } from './result';
import { encodeFileToBase64, fromUrlSafe } from './base64';
import { hasImageExtension } from './imageFile';

/**
 * Bounds how much base64 text this tool will attempt to decode client-side. `atob` and
 * the resulting `Uint8Array` are both synchronous and hold the whole decoded image in
 * memory with no way to show progress.
 */
export const MAX_BASE64_LENGTH = 20_000_000;

/** Source files larger than this would produce an unwieldy multi-megabyte base64 string. */
export const MAX_IMAGE_FILE_SIZE = 15 * 1024 * 1024;

export interface DecodedImage {
  bytes: Uint8Array;
  mimeType: string;
  /** A normalised `data:` URL, always carrying an explicit, sniffed-or-declared mime type. */
  dataUrl: string;
}

const MAGIC_BYTES: { mimeType: string; test: (bytes: Uint8Array) => boolean }[] = [
  { mimeType: 'image/png', test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mimeType: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: 'image/gif', test: (b) => b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    mimeType: 'image/webp',
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  { mimeType: 'image/bmp', test: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d },
  { mimeType: 'image/x-icon', test: (b) => b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00 },
];

/**
 * Identifies an image format from its content rather than trusting a filename or a
 * declared content type, since raw (non-`data:`) base64 carries no type information at
 * all. SVG is the one format here with no fixed byte signature — it's plain text, so it's
 * detected by decoding a prefix and looking for an `<svg` tag instead.
 */
export function detectImageMimeFromBytes(bytes: Uint8Array): string | null {
  for (const { mimeType, test } of MAGIC_BYTES) {
    if (test(bytes)) return mimeType;
  }

  const prefixText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1000));
  if (/<svg[\s>]/i.test(prefixText)) return 'image/svg+xml';

  return null;
}

function decodeBase64Payload(payload: string): ToolResult<Uint8Array> {
  const candidate = fromUrlSafe(payload.replace(/\s+/g, ''));
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(candidate)) {
    return err('That is not valid base64 — it contains characters outside the alphabet.');
  }

  try {
    const binary = atob(candidate);
    return ok(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch (error) {
    return err(messageFrom(error, 'That is not valid base64.'));
  }
}

/**
 * Decodes a base64 image, accepting either a full `data:image/...;base64,...` URL or a
 * bare base64 payload with no prefix. A bare payload carries no declared type, so its
 * format is sniffed from the decoded bytes; a `data:` URL's declared type is trusted
 * as-is (its bytes are still decoded and returned either way).
 */
export function parseBase64Image(input: string): ToolResult<DecodedImage> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Paste a base64 string or data URL first.');
  if (trimmed.length > MAX_BASE64_LENGTH) {
    return err(
      `Input is too large to decode in the browser (${trimmed.length.toLocaleString()} characters, limit ${MAX_BASE64_LENGTH.toLocaleString()}).`
    );
  }

  if (trimmed.startsWith('data:')) {
    const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(trimmed);
    if (!match) return err('That data URL is malformed — expected "data:<mime-type>;base64,<data>".');
    const [, declaredMime, isBase64, payload] = match;
    if (!isBase64) {
      return err('That data URL is not base64-encoded (missing ";base64,") — this tool only decodes base64 data URLs.');
    }

    const decoded = decodeBase64Payload(payload!);
    if (!decoded.ok) return decoded;

    const mimeType = declaredMime || 'application/octet-stream';
    if (!mimeType.startsWith('image/')) {
      return err(`This data URL declares "${mimeType}", not an image type — try the Base64 Encoder/Decoder tool instead.`);
    }
    return ok({ bytes: decoded.value, mimeType, dataUrl: `data:${mimeType};base64,${toCleanBase64(payload!)}` });
  }

  const decoded = decodeBase64Payload(trimmed);
  if (!decoded.ok) return decoded;

  const mimeType = detectImageMimeFromBytes(decoded.value);
  if (!mimeType) {
    return err(
      "This doesn't look like a recognised image format (PNG, JPEG, GIF, WEBP, BMP, ICO or SVG) — check the base64 was copied in full, or use the Base64 Encoder/Decoder tool for non-image data."
    );
  }

  return ok({ bytes: decoded.value, mimeType, dataUrl: `data:${mimeType};base64,${toCleanBase64(trimmed)}` });
}

const toCleanBase64 = (payload: string): string => fromUrlSafe(payload.replace(/\s+/g, ''));

/**
 * Encodes an image file to base64, rejecting anything whose declared type isn't an image. A
 * blank type (some drag sources omit it) falls back to the file's own extension rather than
 * being waved through unconditionally — drag-and-drop bypasses an `<input accept>` filter
 * entirely, so that check alone doesn't stop a non-image file with no declared type.
 */
export async function encodeImageToBase64(file: File): Promise<ToolResult<{ base64: string; dataUrl: string; mimeType: string }>> {
  if (file.type !== '' && !file.type.startsWith('image/')) {
    return err(`"${file.name}" is a ${file.type} file, not an image — choose an image file instead.`);
  }
  if (file.type === '' && !hasImageExtension(file.name)) {
    return err(`"${file.name}" doesn't look like an image (no recognized type or file extension) — choose an image file instead.`);
  }
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return err(
      `That file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB, limit ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB) — base64 inflates size by about a third, which gets unwieldy well before this.`
    );
  }

  return encodeFileToBase64(file);
}

export const buildImgTagSnippet = (dataUrl: string, altText = 'Description'): string =>
  `<img src="${dataUrl}" alt="${altText}" />`;

export const buildCssBackgroundSnippet = (dataUrl: string, selector = '.element'): string =>
  `${selector} {\n  background-image: url("${dataUrl}");\n}`;
