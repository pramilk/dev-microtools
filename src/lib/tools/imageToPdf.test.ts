import { describe, it, expect } from 'vitest';
import {
  DEFAULT_IMAGE_TO_PDF_OPTIONS,
  MAX_IMAGES,
  MAX_PAGE_POINTS,
  batchRoom,
  drawMatrix,
  layoutPage,
  nextRotation,
  normalizeOutputName,
  readExifOrientation,
  swapsAxes,
  validateImageFile,
  withExifOrientation,
  type ExifOrientation,
  type ImageToPdfOptions,
  type Rotation,
} from './imageToPdf';

/** SOI + a dummy SOF0 + EOI — enough JPEG structure for the marker walker. */
const plainJpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);

const opts = (patch: Partial<ImageToPdfOptions> = {}): ImageToPdfOptions => ({ ...DEFAULT_IMAGE_TO_PDF_OPTIONS, ...patch });

describe('readExifOrientation / withExifOrientation', () => {
  it('returns 1 for a JPEG without EXIF, for non-JPEG bytes and for empty input', () => {
    expect(readExifOrientation(plainJpeg())).toBe(1);
    expect(readExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(readExifOrientation(new Uint8Array())).toBe(1);
  });

  it('round-trips every orientation value through a big-endian EXIF block', () => {
    for (let value = 1; value <= 8; value++) {
      expect(readExifOrientation(withExifOrientation(plainJpeg(), value as ExifOrientation))).toBe(value);
    }
  });

  it('reads a little-endian (Intel) EXIF block too', () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 2, 0, 0x0f, 0x01, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0];
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, ...plainJpeg().subarray(2)]);
    expect(readExifOrientation(jpeg)).toBe(8);
  });

  it('skips other APP segments before the EXIF one', () => {
    const jfif = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
    const withExif = withExifOrientation(plainJpeg(), 3);
    const jpeg = new Uint8Array([...withExif.subarray(0, 2), ...jfif, ...withExif.subarray(2)]);
    expect(readExifOrientation(jpeg)).toBe(3);
  });

  it('falls back to 1 for out-of-range values and truncated or malformed EXIF, without throwing', () => {
    const bad = withExifOrientation(plainJpeg(), 6);
    bad[2 + 4 + 25] = 9; // The orientation value's low byte.
    expect(readExifOrientation(bad)).toBe(1);
    const truncated = withExifOrientation(plainJpeg(), 6).subarray(0, 20);
    expect(readExifOrientation(truncated)).toBe(1);
    const wrongByteOrder = withExifOrientation(plainJpeg(), 6);
    wrongByteOrder[12] = 0x00; // First byte of the TIFF "MM" byte-order mark.
    expect(readExifOrientation(wrongByteOrder)).toBe(1);
  });

  it('stops at the image data and handles a large JPEG with no EXIF quickly', () => {
    const big = new Uint8Array(5_000_000);
    big.set([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]);
    expect(readExifOrientation(big)).toBe(1);
  });
});

describe('swapsAxes / nextRotation', () => {
  it('swaps for the quarter-turn orientations and rotations, cancelling when both apply', () => {
    expect(swapsAxes(1, 0)).toBe(false);
    expect(swapsAxes(6, 0)).toBe(true);
    expect(swapsAxes(1, 90)).toBe(true);
    expect(swapsAxes(6, 90)).toBe(false);
    expect(swapsAxes(3, 180)).toBe(false);
  });

  it('cycles rotation through 0 → 90 → 180 → 270 → 0', () => {
    expect([0, 90, 180, 270].map((r) => nextRotation(r as Rotation))).toEqual([90, 180, 270, 0]);
  });
});

describe('layoutPage', () => {
  it('picks a landscape A4 page for a wide image and centres it inside the margins', () => {
    const layout = layoutPage(2000, 1000, opts({ pageSize: 'a4', orientation: 'auto', margin: 'small' }));
    expect(layout.pageWidth).toBeCloseTo(841.89);
    expect(layout.pageHeight).toBeCloseTo(595.28);
    expect(layout.box.width).toBeCloseTo(841.89 - 36);
    expect(layout.box.height).toBeCloseTo((841.89 - 36) / 2);
    expect(layout.box.x).toBeCloseTo(18);
    expect(layout.box.y + layout.box.height / 2).toBeCloseTo(595.28 / 2);
  });

  it('honours a forced orientation, scaling a wide image down on a portrait page', () => {
    const layout = layoutPage(2000, 1000, opts({ pageSize: 'letter', orientation: 'portrait', margin: 'none' }));
    expect([layout.pageWidth, layout.pageHeight]).toEqual([612, 792]);
    expect(layout.box.width).toBeCloseTo(612);
    expect(layout.box.height).toBeCloseTo(306);
  });

  it('scales small images up to fill the page', () => {
    const layout = layoutPage(10, 10, opts({ pageSize: 'letter', margin: 'large' }));
    expect(layout.box.width).toBeCloseTo(612 - 72);
  });

  it('sizes "fit" pages to the image at 96 px per inch plus margins', () => {
    const layout = layoutPage(960, 480, opts({ pageSize: 'fit', margin: 'small' }));
    expect(layout.pageWidth).toBeCloseTo(720 + 36);
    expect(layout.pageHeight).toBeCloseTo(360 + 36);
    expect(layout.box).toEqual({ x: 18, y: 18, width: 720, height: 360 });
  });

  it('keeps a huge "fit" page inside the 200-inch PDF limit, preserving proportions', () => {
    const layout = layoutPage(40_000, 10_000, opts({ pageSize: 'fit', margin: 'none' }));
    expect(layout.pageWidth).toBeCloseTo(MAX_PAGE_POINTS);
    expect(layout.pageHeight).toBeCloseTo(MAX_PAGE_POINTS / 4);
  });
});

describe('drawMatrix', () => {
  const box = { x: 10, y: 20, width: 300, height: 200 };
  const apply = (m: number[], p: number, q: number) => [m[0] * p + m[2] * q + m[4], m[1] * p + m[3] * q + m[5]];

  it('is a plain scale-and-translate for an upright image', () => {
    expect(drawMatrix(1, 0, box)).toEqual([300, 0, 0, 200, 10, 20]);
  });

  it('turns an orientation-6 (rotated clockwise) photo upright', () => {
    // The stored image's top-left pixel (unit square 0,1) must land at the box's top-right.
    const m = drawMatrix(6, 0, box);
    expect(apply(m, 0, 1)).toEqual([310, 220]);
    // Its bottom-left (0,0) lands at the box's top-left.
    expect(apply(m, 0, 0)).toEqual([10, 220]);
  });

  it('applies the visitor’s clockwise rotation on top of the orientation', () => {
    // Rotating 90° clockwise: the image's top-left corner goes to the top-right.
    expect(apply(drawMatrix(1, 90, box), 0, 1)).toEqual([310, 220]);
    // Orientation 6 plus a 270° turn cancels out to upright.
    expect(drawMatrix(6, 270, box)).toEqual(drawMatrix(1, 0, box));
  });

  it('mirrors for the flipped orientations', () => {
    expect(apply(drawMatrix(2, 0, box), 0, 1)).toEqual([310, 220]);
    expect(apply(drawMatrix(4, 0, box), 0, 1)).toEqual([10, 20]);
  });

  it('always maps the unit square exactly onto the box, for every orientation and rotation', () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      for (const rotation of [0, 90, 180, 270] as Rotation[]) {
        const m = drawMatrix(orientation as ExifOrientation, rotation, box);
        const corners = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)].map(([x, y]) => `${x},${y}`).sort();
        expect(corners).toEqual(['10,20', '10,220', '310,20', '310,220']);
      }
    }
  });
});

describe('validateImageFile', () => {
  it('accepts common raster formats, by type or by extension', () => {
    expect(validateImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 10 }).ok).toBe(true);
    expect(validateImageFile({ name: 'scan.WEBP', type: '', size: 10 }).ok).toBe(true);
    expect(validateImageFile({ name: 'photo.heic', type: 'image/heic', size: 10 }).ok).toBe(true);
  });

  it('rejects non-images, SVG and empty files with a reason', () => {
    const notImage = validateImageFile({ name: 'notes.txt', type: 'text/plain', size: 10 });
    expect(notImage.ok).toBe(false);
    if (!notImage.ok) expect(notImage.error).toMatch(/notes\.txt.*isn't an image/);
    const svg = validateImageFile({ name: 'logo.svg', type: 'image/svg+xml', size: 10 });
    if (svg.ok) throw new Error('expected SVG to be rejected');
    expect(svg.error).toMatch(/SVG.*PNG/);
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: 0 }).ok).toBe(false);
  });
});

describe('batchRoom / normalizeOutputName', () => {
  it('applies Image to PDF’s own caps and wording', () => {
    const full = batchRoom({ count: MAX_IMAGES - 1, bytes: 0 }, [1, 1]);
    expect(full.accepted).toBe(1);
    expect(full.error).toMatch(/Image to PDF takes up to 200 images.*1 image wasn’t added/);
    expect(batchRoom({ count: 0, bytes: 299 * 1024 * 1024 }, [2 * 1024 * 1024]).error).toMatch(/300 MB.*Image Compressor/);
  });

  it('defaults the download name to images.pdf', () => {
    expect(normalizeOutputName('')).toBe('images.pdf');
    expect(normalizeOutputName('Holiday 2026')).toBe('Holiday 2026.pdf');
  });
});
