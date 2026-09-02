import { describe, it, expect } from 'vitest';
import {
  centerSquareCrop,
  buildMultiIco,
  buildFaviconHtmlSnippet,
  buildWebManifest,
  FAVICON_FILE_NAMES,
  ICO_SIZES,
  ANDROID_CHROME_SIZES,
  ALL_PNG_SIZES,
  type IcoEntry,
} from './favicon';

describe('centerSquareCrop', () => {
  it('crops nothing off an already-square image', () => {
    expect(centerSquareCrop(400, 400)).toEqual({ x: 0, y: 0, size: 400 });
  });

  it('centers the crop on a wide image', () => {
    expect(centerSquareCrop(800, 400)).toEqual({ x: 200, y: 0, size: 400 });
  });

  it('centers the crop on a tall image', () => {
    expect(centerSquareCrop(300, 900)).toEqual({ x: 0, y: 300, size: 300 });
  });

  it('handles a 1x1 image', () => {
    expect(centerSquareCrop(1, 1)).toEqual({ x: 0, y: 0, size: 1 });
  });

  it('floors an odd offset rather than producing a fractional pixel', () => {
    // (801 - 400) / 2 = 200.5 -> floors to 200
    expect(centerSquareCrop(801, 400)).toEqual({ x: 200, y: 0, size: 400 });
  });
});

describe('buildMultiIco', () => {
  const entries: IcoEntry[] = [
    { width: 16, height: 16, pngBytes: new Uint8Array([1, 2, 3]) },
    { width: 32, height: 32, pngBytes: new Uint8Array([4, 5, 6, 7, 8]) },
  ];

  it('writes a valid ICONDIR header for a multi-entry ICO', () => {
    const buffer = buildMultiIco(entries);
    const view = new DataView(buffer);

    expect(view.getUint16(0, true)).toBe(0); // reserved
    expect(view.getUint16(2, true)).toBe(1); // type: icon
    expect(view.getUint16(4, true)).toBe(2); // image count
  });

  it('writes each ICONDIRENTRY with correct dimensions, size, and offset', () => {
    const buffer = buildMultiIco(entries);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const dirSize = 6 + 16 * entries.length; // 38

    // Entry 0: 16x16, 3 bytes, starts right after the directory.
    expect(bytes[6]).toBe(16);
    expect(bytes[7]).toBe(16);
    expect(view.getUint16(10, true)).toBe(1); // planes
    expect(view.getUint16(12, true)).toBe(32); // bpp
    expect(view.getUint32(14, true)).toBe(3); // size
    expect(view.getUint32(18, true)).toBe(dirSize); // offset

    // Entry 1: 32x32, 5 bytes, starts right after entry 0's data.
    const entry1Base = 6 + 16;
    expect(bytes[entry1Base]).toBe(32);
    expect(bytes[entry1Base + 1]).toBe(32);
    expect(view.getUint32(entry1Base + 8, true)).toBe(5); // size
    expect(view.getUint32(entry1Base + 12, true)).toBe(dirSize + 3); // offset, right after entry 0's 3 bytes
  });

  it('appends every entry\'s PNG bytes sequentially after the directory', () => {
    const buffer = buildMultiIco(entries);
    const bytes = new Uint8Array(buffer);
    const dirSize = 6 + 16 * entries.length;

    expect(Array.from(bytes.slice(dirSize, dirSize + 3))).toEqual([1, 2, 3]);
    expect(Array.from(bytes.slice(dirSize + 3, dirSize + 3 + 5))).toEqual([4, 5, 6, 7, 8]);
    expect(buffer.byteLength).toBe(dirSize + 3 + 5);
  });

  it('encodes a 256px dimension as 0, per the ICO spec', () => {
    const buffer = buildMultiIco([{ width: 256, height: 256, pngBytes: new Uint8Array([9]) }]);
    const bytes = new Uint8Array(buffer);
    expect(bytes[6]).toBe(0);
    expect(bytes[7]).toBe(0);
  });

  it('handles a single-entry ICO the same way the multi-entry case does', () => {
    const buffer = buildMultiIco([{ width: 48, height: 48, pngBytes: new Uint8Array([1, 2]) }]);
    const view = new DataView(buffer);
    expect(view.getUint16(4, true)).toBe(1);
    expect(buffer.byteLength).toBe(6 + 16 + 2);
  });

  it('handles an empty entry list without throwing', () => {
    const buffer = buildMultiIco([]);
    const view = new DataView(buffer);
    expect(view.getUint16(4, true)).toBe(0);
    expect(buffer.byteLength).toBe(6);
  });

  it('handles an entry with an empty PNG payload', () => {
    const buffer = buildMultiIco([{ width: 16, height: 16, pngBytes: new Uint8Array(0) }]);
    expect(buffer.byteLength).toBe(6 + 16);
  });
});

describe('buildFaviconHtmlSnippet', () => {
  it('references every generated file with a leading slash', () => {
    const snippet = buildFaviconHtmlSnippet();
    expect(snippet).toContain(`href="/${FAVICON_FILE_NAMES.ico}"`);
    expect(snippet).toContain(`href="/${FAVICON_FILE_NAMES.png16}"`);
    expect(snippet).toContain(`href="/${FAVICON_FILE_NAMES.png32}"`);
    expect(snippet).toContain(`href="/${FAVICON_FILE_NAMES.appleTouch}"`);
    expect(snippet).toContain(`href="/${FAVICON_FILE_NAMES.manifest}"`);
  });

  it('marks the ICO link with sizes="any"', () => {
    expect(buildFaviconHtmlSnippet()).toContain('sizes="any"');
  });

  it('produces exactly five link tags, one per line', () => {
    const lines = buildFaviconHtmlSnippet().split('\n');
    expect(lines).toHaveLength(5);
    lines.forEach((line) => expect(line.trim().startsWith('<link')).toBe(true));
  });
});

describe('buildWebManifest', () => {
  it('produces valid JSON referencing both android-chrome icon sizes', () => {
    const manifest = JSON.parse(buildWebManifest());
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
      ANDROID_CHROME_SIZES.map((size) => `${size}x${size}`)
    );
    expect(manifest.icons.every((icon: { type: string }) => icon.type === 'image/png')).toBe(true);
  });

  it('defaults name and short_name to a generic placeholder', () => {
    const manifest = JSON.parse(buildWebManifest());
    expect(manifest.name).toBe('App');
    expect(manifest.short_name).toBe('App');
  });

  it('uses a custom app name when one is passed', () => {
    const manifest = JSON.parse(buildWebManifest('My Cool App'));
    expect(manifest.name).toBe('My Cool App');
    expect(manifest.short_name).toBe('My Cool App');
  });

  it('references the exact android-chrome filenames used elsewhere in this module', () => {
    const manifest = JSON.parse(buildWebManifest());
    expect(manifest.icons[0].src).toBe(`/${FAVICON_FILE_NAMES.android192}`);
    expect(manifest.icons[1].src).toBe(`/${FAVICON_FILE_NAMES.android512}`);
  });
});

describe('ALL_PNG_SIZES', () => {
  it('deduplicates 32px between the ICO sizes and the standalone favicon-32x32.png', () => {
    expect(ALL_PNG_SIZES.filter((size) => size === 32)).toHaveLength(1);
  });

  it('includes every ICO size and every Android/apple-touch size', () => {
    for (const size of ICO_SIZES) expect(ALL_PNG_SIZES).toContain(size);
    for (const size of ANDROID_CHROME_SIZES) expect(ALL_PNG_SIZES).toContain(size);
    expect(ALL_PNG_SIZES).toContain(180);
  });
});
