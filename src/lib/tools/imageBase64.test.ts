import { describe, it, expect } from 'vitest';
import {
  parseBase64Image,
  detectImageMimeFromBytes,
  encodeImageToBase64,
  buildImgTagSnippet,
  buildCssBackgroundSnippet,
  MAX_BASE64_LENGTH,
  MAX_IMAGE_FILE_SIZE,
} from './imageBase64';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_SIGNATURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const WEBP_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const BMP_SIGNATURE = new Uint8Array([0x42, 0x4d, 1, 2, 3, 4]);
const ICO_SIGNATURE = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 2]);
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';

describe('detectImageMimeFromBytes', () => {
  it.each([
    ['PNG', PNG_SIGNATURE, 'image/png'],
    ['JPEG', JPEG_SIGNATURE, 'image/jpeg'],
    ['GIF', GIF_SIGNATURE, 'image/gif'],
    ['WEBP', WEBP_SIGNATURE, 'image/webp'],
    ['BMP', BMP_SIGNATURE, 'image/bmp'],
    ['ICO', ICO_SIGNATURE, 'image/x-icon'],
  ])('detects %s from its magic bytes', (_name, bytes, expected) => {
    expect(detectImageMimeFromBytes(bytes)).toBe(expected);
  });

  it('detects SVG from its text content, not a byte signature', () => {
    const bytes = new TextEncoder().encode(SVG_TEXT);
    expect(detectImageMimeFromBytes(bytes)).toBe('image/svg+xml');
  });

  it('returns null for bytes that match no known image format', () => {
    expect(detectImageMimeFromBytes(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});

describe('parseBase64Image', () => {
  it('decodes a well-formed image data URL, trusting its declared mime type', () => {
    const base64 = bytesToBase64(PNG_SIGNATURE);
    const result = parseBase64Image(`data:image/png;base64,${base64}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('image/png');
    expect([...result.value.bytes]).toEqual([...PNG_SIGNATURE]);
    expect(result.value.dataUrl).toBe(`data:image/png;base64,${base64}`);
  });

  it('sniffs the format from bare base64 with no data: prefix', () => {
    const base64 = bytesToBase64(JPEG_SIGNATURE);
    const result = parseBase64Image(base64);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('image/jpeg');
    expect(result.value.dataUrl).toBe(`data:image/jpeg;base64,${base64}`);
  });

  it('tolerates whitespace/newlines wrapped in the base64 payload', () => {
    const base64 = bytesToBase64(GIF_SIGNATURE);
    const wrapped = base64.match(/.{1,4}/g)!.join('\n');
    const result = parseBase64Image(wrapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('image/gif');
  });

  it('rejects a data URL for a non-image mime type', () => {
    const result = parseBase64Image(`data:text/plain;base64,${btoa('hello')}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/base64 encoder\/decoder/i);
  });

  it('rejects a data URL missing the ";base64," marker', () => {
    const result = parseBase64Image('data:image/png,not-base64-encoded');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/base64/i);
  });

  it('rejects bare base64 that does not sniff to a known image format', () => {
    const result = parseBase64Image(btoa('just some plain text, not an image'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/doesn't look like a recognised image format/i);
  });

  it('rejects malformed base64', () => {
    const result = parseBase64Image('data:image/png;base64,not*valid*base64!!!');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid base64/i);
  });

  it('rejects empty input', () => {
    expect(parseBase64Image('   ').ok).toBe(false);
  });

  it('rejects input past the size limit', () => {
    const result = parseBase64Image('A'.repeat(MAX_BASE64_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });
});

describe('encodeImageToBase64', () => {
  it('encodes a valid image file', async () => {
    const file = new File([PNG_SIGNATURE], 'pixel.png', { type: 'image/png' });
    const result = await encodeImageToBase64(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('image/png');
    expect(result.value.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects a non-image file by its declared type', async () => {
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    const result = await encodeImageToBase64(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not an image/i);
  });

  it('rejects a file over the size limit', async () => {
    const file = new File([new Uint8Array(MAX_IMAGE_FILE_SIZE + 1)], 'huge.png', { type: 'image/png' });
    const result = await encodeImageToBase64(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });

  it('allows a blank-type file through when its extension still looks like an image', async () => {
    const file = new File([PNG_SIGNATURE], 'pixel.png', { type: '' });
    const result = await encodeImageToBase64(file);
    expect(result.ok).toBe(true);
  });

  it('rejects a blank-type file with no recognizable image extension, instead of waving it through', async () => {
    // Drag-and-drop bypasses an <input accept> filter entirely, and some drag sources omit a
    // file's type even for a genuine non-image file — this is the actual case that let one
    // through before.
    const file = new File(['not an image'], 'resume.docx', { type: '' });
    const result = await encodeImageToBase64(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/doesn't look like an image/i);
  });
});

describe('snippet builders', () => {
  it('builds an <img> tag', () => {
    expect(buildImgTagSnippet('data:image/png;base64,AAA', 'A red dot')).toBe(
      '<img src="data:image/png;base64,AAA" alt="A red dot" />'
    );
  });

  it('builds a CSS background-image rule', () => {
    expect(buildCssBackgroundSnippet('data:image/png;base64,AAA', '.icon')).toBe(
      '.icon {\n  background-image: url("data:image/png;base64,AAA");\n}'
    );
  });
});
