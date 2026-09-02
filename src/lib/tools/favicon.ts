/**
 * Pure logic for the Favicon Generator: the multi-image ICO binary format, the center-crop
 * rectangle calculation, and the two small text artifacts (the HTML `<link>` snippet and the
 * `site.webmanifest` JSON) every favicon package ships alongside its images. Decoding the
 * uploaded image and drawing it to a `<canvas>` at each target size is inherently DOM-bound
 * (`createImageBitmap`, `<canvas>`) and stays in the island, matching how Image Format
 * Converter and Image Cropper split the same concerns.
 */

/** The three sizes bundled into `favicon.ico` — the standard trio every real favicon
 *  generator (favicon.io, RealFaviconGenerator) ships, covering browser tabs, taskbar
 *  pinning, and bookmarks at the resolutions each actually renders at. */
export const ICO_SIZES = [16, 32, 48] as const;

/** iOS home-screen bookmark icon size — Apple's documented `apple-touch-icon` dimension. */
export const APPLE_TOUCH_ICON_SIZE = 180;

/** Android/PWA manifest icon sizes — the pair Chrome's install prompt and the Web App
 *  Manifest spec's own examples both use. */
export const ANDROID_CHROME_SIZES = [192, 512] as const;

/** Every PNG size this tool renders, standalone sizes plus the three bundled into the ICO —
 *  deduplicated so nothing is rendered twice (32 already covers one ICO entry and its own
 *  standalone `favicon-32x32.png`). */
export const ALL_PNG_SIZES = [...new Set<number>([...ICO_SIZES, APPLE_TOUCH_ICON_SIZE, ...ANDROID_CHROME_SIZES])];

/** The output filenames this tool always produces, in the exact shape real favicon
 *  generators (favicon.io, RealFaviconGenerator) use — so the HTML snippet, the zip archive,
 *  and any web search for "favicon.ico apple-touch-icon android-chrome" all agree. */
export const FAVICON_FILE_NAMES = {
  ico: 'favicon.ico',
  png16: 'favicon-16x16.png',
  png32: 'favicon-32x32.png',
  appleTouch: 'apple-touch-icon.png',
  android192: 'android-chrome-192x192.png',
  android512: 'android-chrome-512x512.png',
  manifest: 'site.webmanifest',
} as const;

export interface SquareCrop {
  x: number;
  y: number;
  size: number;
}

/**
 * The largest square that fits centered inside a `width` x `height` rectangle — used to crop
 * a non-square source image before resizing it down to each favicon size, so a wide logo
 * doesn't come out squashed. A source that's already square gets `x: 0, y: 0` and its own
 * full size back untouched.
 */
export function centerSquareCrop(width: number, height: number): SquareCrop {
  const size = Math.min(width, height);
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    size,
  };
}

export interface IcoEntry {
  width: number;
  height: number;
  pngBytes: Uint8Array;
}

/**
 * Wraps several already-PNG-encoded images in one multi-size ICO container — one `ICONDIR`
 * followed by one `ICONDIRENTRY` per image, then every image's PNG bytes appended back to
 * back in the same order. This is the real-world favicon.ico shape: a single file that lets
 * the browser/OS pick whichever embedded size best matches where it's rendering (a 16px
 * browser tab vs. a 48px taskbar icon), rather than the one-entry-only `encodeIco` that
 * Image Format Converter uses for a plain single-image icon conversion.
 */
export function buildMultiIco(entries: IcoEntry[]): ArrayBuffer {
  const dirSize = 6 + 16 * entries.length; // ICONDIR + one ICONDIRENTRY per image
  const totalImageBytes = entries.reduce((sum, entry) => sum + entry.pngBytes.length, 0);

  const buffer = new ArrayBuffer(dirSize + totalImageBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // reserved, must be 0
  view.setUint16(2, 1, true); // type: 1 = icon
  view.setUint16(4, entries.length, true); // image count

  // Width/height in an ICONDIRENTRY are single bytes; 0 encodes "256", the format's max.
  const dim = (n: number): number => (Math.min(n, 256) >= 256 ? 0 : Math.min(n, 256));

  let dataOffset = dirSize;
  entries.forEach((entry, index) => {
    const base = 6 + index * 16;
    bytes[base] = dim(entry.width);
    bytes[base + 1] = dim(entry.height);
    bytes[base + 2] = 0; // color count (0 = not a palette image)
    bytes[base + 3] = 0; // reserved
    view.setUint16(base + 4, 1, true); // color planes
    view.setUint16(base + 6, 32, true); // bits per pixel
    view.setUint32(base + 8, entry.pngBytes.length, true); // size of this entry's image data
    view.setUint32(base + 12, dataOffset, true); // offset to this entry's image data

    bytes.set(entry.pngBytes, dataOffset);
    dataOffset += entry.pngBytes.length;
  });

  return buffer;
}

/**
 * The HTML `<link>` tags a user pastes into their page `<head>` to wire up every file this
 * tool produces — favicon.ico (with `sizes="any"`, the modern way to tell a browser there's a
 * multi-size ICO available alongside more specific PNG entries), the two standalone PNG
 * sizes, the Apple touch icon, and the web manifest. Matches the snippet real favicon
 * generators (favicon.io, RealFaviconGenerator) hand back.
 */
export function buildFaviconHtmlSnippet(): string {
  return [
    `<link rel="icon" href="/${FAVICON_FILE_NAMES.ico}" sizes="any">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="/${FAVICON_FILE_NAMES.png16}">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/${FAVICON_FILE_NAMES.png32}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/${FAVICON_FILE_NAMES.appleTouch}">`,
    `<link rel="manifest" href="/${FAVICON_FILE_NAMES.manifest}">`,
  ].join('\n');
}

/**
 * The `site.webmanifest` JSON referencing the two Android/PWA icon sizes. `name`/`short_name`
 * default to a generic placeholder rather than anything fabricated — the tool has no way to
 * know the visitor's real app name, and the island's UI says as much so this isn't a silent
 * guess left in the downloaded file.
 */
export function buildWebManifest(appName = 'App'): string {
  const manifest = {
    name: appName,
    short_name: appName,
    icons: [
      { src: `/${FAVICON_FILE_NAMES.android192}`, sizes: '192x192', type: 'image/png' },
      { src: `/${FAVICON_FILE_NAMES.android512}`, sizes: '512x512', type: 'image/png' },
    ],
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
