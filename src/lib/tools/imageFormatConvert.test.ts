import { describe, it, expect } from 'vitest';
import {
  validateImageFile,
  inputFormatWarning,
  outputFileName,
  computeIcoDimensions,
  encodeBmp,
  encodeIco,
  MAX_INPUT_FILE_SIZE,
  MAX_ICO_DIMENSION,
} from './imageFormatConvert';

describe('validateImageFile', () => {
  it('accepts a normal image file', () => {
    const result = validateImageFile({ type: 'image/png', size: 1024, name: 'photo.png' });
    expect(result.ok).toBe(true);
  });

  it('accepts SVG, unlike Image Compressor — rasterizing a vector input is a valid use case here', () => {
    const result = validateImageFile({ type: 'image/svg+xml', size: 512, name: 'icon.svg' });
    expect(result.ok).toBe(true);
  });

  it('accepts GIF — a still-frame conversion is a valid use case here', () => {
    const result = validateImageFile({ type: 'image/gif', size: 512, name: 'anim.gif' });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-image file with a declared type', () => {
    const result = validateImageFile({ type: 'application/pdf', size: 1024, name: 'doc.pdf' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not an image/i);
  });

  it('falls back to the extension when the type is blank', () => {
    const good = validateImageFile({ type: '', size: 1024, name: 'photo.webp' });
    expect(good.ok).toBe(true);

    const bad = validateImageFile({ type: '', size: 1024, name: 'notes.txt' });
    expect(bad.ok).toBe(false);
  });

  it('rejects a file over the size limit', () => {
    const result = validateImageFile({ type: 'image/png', size: MAX_INPUT_FILE_SIZE + 1, name: 'huge.png' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('accepts a file exactly at the size limit', () => {
    const result = validateImageFile({ type: 'image/png', size: MAX_INPUT_FILE_SIZE, name: 'exact.png' });
    expect(result.ok).toBe(true);
  });
});

describe('inputFormatWarning', () => {
  it('warns for a declared GIF type', () => {
    expect(inputFormatWarning({ type: 'image/gif', name: 'anim.gif' })).toMatch(/first frame/i);
  });

  it('warns for a blank-typed file with a .gif extension', () => {
    expect(inputFormatWarning({ type: '', name: 'anim.GIF' })).toMatch(/first frame/i);
  });

  it('is null for anything else', () => {
    expect(inputFormatWarning({ type: 'image/png', name: 'photo.png' })).toBeNull();
  });
});

describe('outputFileName', () => {
  it('replaces the extension with the target format', () => {
    expect(outputFileName('photo.png', 'image/jpeg')).toBe('photo.jpg');
    expect(outputFileName('icon.svg', 'image/x-icon')).toBe('icon.ico');
    expect(outputFileName('scan.tif', 'image/bmp')).toBe('scan.bmp');
  });

  it('handles a filename with no extension', () => {
    expect(outputFileName('photo', 'image/webp')).toBe('photo.webp');
  });

  it('handles a filename with multiple dots, only stripping the last segment', () => {
    expect(outputFileName('my.photo.v2.png', 'image/png')).toBe('my.photo.v2.png');
  });

  it('handles unicode filenames', () => {
    expect(outputFileName('写真.png', 'image/webp')).toBe('写真.webp');
  });

  it('falls back to a generic name for an empty base', () => {
    expect(outputFileName('.png', 'image/png')).toBe('image.png');
  });
});

describe('computeIcoDimensions', () => {
  it('leaves a small image untouched', () => {
    expect(computeIcoDimensions(64, 64)).toEqual({ width: 64, height: 64 });
  });

  it('downscales a larger image to fit, preserving aspect ratio', () => {
    const result = computeIcoDimensions(1024, 512);
    expect(Math.max(result.width, result.height)).toBe(MAX_ICO_DIMENSION);
    expect(result.width / result.height).toBeCloseTo(1024 / 512, 2);
  });
});

describe('encodeBmp', () => {
  it('writes a valid BMP/DIB header for a 1x1 image', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255]); // R, G, B, A
    const buffer = encodeBmp(1, 1, rgba);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    expect(bytes[0]).toBe(0x42); // 'B'
    expect(bytes[1]).toBe(0x4d); // 'M'
    expect(view.getUint32(2, true)).toBe(buffer.byteLength); // file size
    expect(view.getUint32(10, true)).toBe(54); // pixel data offset
    expect(view.getUint32(14, true)).toBe(40); // DIB header size
    expect(view.getInt32(18, true)).toBe(1); // width
    expect(view.getInt32(22, true)).toBe(1); // height
    expect(view.getUint16(28, true)).toBe(32); // bits per pixel

    // Pixel data is BGRA, not RGBA.
    expect(bytes[54]).toBe(30); // B
    expect(bytes[55]).toBe(20); // G
    expect(bytes[56]).toBe(10); // R
    expect(bytes[57]).toBe(255); // A
  });

  it('writes rows bottom-up', () => {
    // A 1x2 image: top pixel red, bottom pixel blue.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const buffer = encodeBmp(1, 2, rgba);
    const bytes = new Uint8Array(buffer);

    // BMP stores rows bottom-up, so the *first* pixel written should be the blue (bottom) one.
    expect(bytes[54]).toBe(255); // B channel of the blue pixel
    expect(bytes[56]).toBe(0); // R channel of the blue pixel
    // The second row written should be the red (top) one.
    expect(bytes[58]).toBe(0); // B channel of the red pixel
    expect(bytes[60]).toBe(255); // R channel of the red pixel
  });

  it('produces the exact expected byte length with no row padding', () => {
    const width = 3;
    const height = 5;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const buffer = encodeBmp(width, height, rgba);
    expect(buffer.byteLength).toBe(54 + width * height * 4);
  });
});

describe('encodeIco', () => {
  it('writes a valid ICONDIR/ICONDIRENTRY header wrapping the PNG bytes', () => {
    const png = new Uint8Array([1, 2, 3, 4, 5]);
    const buffer = encodeIco(png, 32, 32);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    expect(view.getUint16(2, true)).toBe(1); // type: icon
    expect(view.getUint16(4, true)).toBe(1); // image count
    expect(bytes[6]).toBe(32); // width
    expect(bytes[7]).toBe(32); // height
    expect(view.getUint16(12, true)).toBe(32); // bit count
    expect(view.getUint32(14, true)).toBe(png.length); // data size
    expect(view.getUint32(18, true)).toBe(22); // data offset
    expect(buffer.byteLength).toBe(22 + png.length);

    // The embedded bytes are the PNG data verbatim, at the declared offset.
    expect(Array.from(bytes.slice(22))).toEqual(Array.from(png));
  });

  it('encodes a 256px dimension as 0, per the ICO spec', () => {
    const png = new Uint8Array([1]);
    const buffer = encodeIco(png, 256, 256);
    const bytes = new Uint8Array(buffer);
    expect(bytes[6]).toBe(0);
    expect(bytes[7]).toBe(0);
  });

  it('handles an empty PNG payload without throwing', () => {
    const buffer = encodeIco(new Uint8Array(0), 16, 16);
    expect(buffer.byteLength).toBe(22);
  });
});
