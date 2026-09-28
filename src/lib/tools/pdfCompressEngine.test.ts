import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFPage } from 'pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';
import { buildSamplePdf, compressPdf, type RasterCodec } from './pdfCompressEngine';
import { PDF_PRESETS, type PdfCompressOptions } from './pdfCompress';
import { unfilterPngRows, filterPngRowsAdaptive } from './pdfImagePixels';
import type { RgbaImageData } from './imageCompress';

/** A byte string that parses as a JPEG frame header with `components` channels, padded to `size`. */
function fakeJpeg(components: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 12));
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, components]);
  return bytes;
}

function noise(length: number, seed = 7): Uint8Array {
  let state = seed;
  return new Uint8Array(length).map(() => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state >>> 24;
  });
}

/** Stands in for the browser's canvas codec: decodes to a solid colour at the requested
 *  size and encodes to a tiny, valid-looking JPEG — enough to exercise every PDF-side path. */
function fakeCodec(jpegComponents = 3) {
  const encoded: RgbaImageData[] = [];
  const codec: RasterCodec = {
    decodeJpeg: vi.fn(async (_bytes: Uint8Array, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([200, 100, 50, 255], i);
      return { data, width, height };
    }),
    encodeJpeg: vi.fn(async (image: RgbaImageData) => {
      encoded.push(image);
      return fakeJpeg(jpegComponents, 100);
    }),
    encodePng: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
  };
  return { codec, encoded };
}

const options = (patch: Partial<PdfCompressOptions> = {}): PdfCompressOptions => ({ ...PDF_PRESETS.balanced.options, ...patch });

async function newDoc(): Promise<{ doc: PDFDocument; page: PDFPage }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  return { doc, page };
}

/** Registers an image XObject and places it on `page`'s resources so it's reachable. */
function addImage(doc: PDFDocument, page: PDFPage, contents: Uint8Array, dict: Record<string, unknown>): PDFRef {
  const stream = doc.context.stream(contents, { Type: 'XObject', Subtype: 'Image', ...dict } as never);
  const ref = doc.context.register(stream);
  page.node.newXObject('Im', ref);
  return ref;
}

async function imageStreams(bytes: Uint8Array): Promise<PDFRawStream[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
}

const num = (stream: PDFRawStream, key: string) => (stream.dict.lookup(PDFName.of(key)) as PDFNumber).asNumber();
const filterOf = (stream: PDFRawStream) => stream.dict.lookup(PDFName.of('Filter'))?.toString();

async function compressOk(input: Uint8Array, opts: PdfCompressOptions, codec: RasterCodec) {
  const result = await compressPdf(input, opts, codec);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.value;
}

describe('compressPdf — input validation', () => {
  it('rejects bytes without a PDF header, and empty input', async () => {
    const { codec } = fakeCodec();
    for (const input of [new TextEncoder().encode('hello world'), new Uint8Array()]) {
      const result = await compressPdf(input, options(), codec);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/isn’t a PDF/);
    }
  });

  it('rejects a damaged file that only has a PDF header', async () => {
    const { codec } = fakeCodec();
    const result = await compressPdf(new TextEncoder().encode('%PDF-1.7\n this is not a real pdf body'), options(), codec);
    expect(result.ok).toBe(false);
  });

  it('explains how to handle an encrypted PDF', async () => {
    const { doc } = await newDoc();
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1 }));
    const { codec } = fakeCodec();
    const result = await compressPdf(await doc.save(), options(), codec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/encrypted.*Print to PDF/s);
  });
});

describe('compressPdf — JPEG images', () => {
  it('downsamples an oversized JPEG to the DPI cap and re-encodes it', async () => {
    const { doc, page } = await newDoc();
    addImage(doc, page, noise(60_000), { Width: 3000, Height: 2000, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const input = await doc.save();
    const { codec } = fakeCodec();

    const output = await compressOk(input, options(), codec);
    expect(output.bytes.length).toBeLessThan(input.length);
    expect(output.report.images).toEqual({ total: 1, recompressed: 1, unchanged: 0, unsupported: 0 });
    // Letter's 11in long side at 150 DPI = 1650px.
    expect(codec.decodeJpeg).toHaveBeenCalledWith(expect.any(Uint8Array), 1650, 1100);

    const [image] = await imageStreams(output.bytes);
    expect([num(image, 'Width'), num(image, 'Height')]).toEqual([1650, 1100]);
    expect(filterOf(image)).toBe('/DCTDecode');
    expect(image.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
  });

  it('labels the colour space from the encoded JPEG’s real component count', async () => {
    const { doc, page } = await newDoc();
    addImage(doc, page, noise(20_000), { Width: 800, Height: 600, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec } = fakeCodec(1);
    const output = await compressOk(await doc.save(), options({ grayscale: true }), codec);
    const [image] = await imageStreams(output.bytes);
    expect(image.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
  });

  it('converts to grayscale before encoding when asked', async () => {
    const { doc, page } = await newDoc();
    addImage(doc, page, noise(20_000), { Width: 800, Height: 600, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec, encoded } = fakeCodec();
    await compressOk(await doc.save(), options({ grayscale: true }), codec);
    const [r, g, b] = encoded[0].data;
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('keeps the original image when re-encoding would not make it smaller', async () => {
    const { doc, page } = await newDoc();
    const original = noise(3000);
    addImage(doc, page, original, { Width: 50, Height: 50, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec } = fakeCodec();
    codec.encodeJpeg = vi.fn(async () => fakeJpeg(3, 10_000));
    const output = await compressOk(await doc.save(), options(), codec);
    expect(output.report.images.unchanged).toBe(1);
  });

  it('builds a before/after preview from the largest re-encoded image', async () => {
    const { doc, page } = await newDoc();
    addImage(doc, page, noise(10_000), { Width: 400, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    addImage(doc, page, noise(40_000, 3), { Width: 2400, Height: 1600, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save(), options(), codec);
    expect(output.preview).toMatchObject({ originalWidth: 2400, originalHeight: 1600, width: 1650, height: 1100 });
    expect(output.preview?.before.mime).toBe('image/jpeg');
    expect(output.preview?.after.mime).toBe('image/jpeg');
  });
});

describe('compressPdf — lossless images', () => {
  it('re-encodes a raw RGB image losslessly with the exact same pixels', async () => {
    const width = 120;
    const height = 90;
    const pixels = new Uint8Array(width * height * 3).map((_, i) => ((i % 360) * 3) & 255);
    const { doc, page } = await newDoc();
    // Stored uncompressed, the way some scanners write images.
    addImage(doc, page, pixels, { Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
    const { codec } = fakeCodec();

    const output = await compressOk(await doc.save(), options({ imageFormat: 'lossless', maxDpi: null }), codec);
    const [image] = await imageStreams(output.bytes);
    expect(filterOf(image)).toBe('/FlateDecode');
    const restored = unfilterPngRows(unzlibSync(image.contents), width * 3, 3, height);
    expect(restored).toEqual(pixels);
    expect(codec.encodeJpeg).not.toHaveBeenCalled();
  });

  it('decodes an indexed 4-bit image with a PNG predictor and expands its palette', async () => {
    const width = 64;
    const height = 64;
    const rowBytes = width / 2;
    const packed = new Uint8Array(rowBytes * height).map((_, i) => (i % 2 ? 0x01 : 0x10));
    const filtered = filterPngRowsAdaptive(packed, rowBytes, 1, height);
    const { doc, page } = await newDoc();
    const palette = doc.context.stream(new Uint8Array([255, 0, 0, 0, 0, 255]));
    addImage(doc, page, zlibSync(filtered, { level: 0 }), {
      Width: width,
      Height: height,
      BitsPerComponent: 4,
      ColorSpace: ['Indexed', 'DeviceRGB', 1, doc.context.register(palette)],
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 4, Columns: width },
    });
    const { codec } = fakeCodec();

    const output = await compressOk(await doc.save(), options({ imageFormat: 'lossless', maxDpi: null }), codec);
    expect(output.report.images.recompressed).toBe(1);
    const [image] = await imageStreams(output.bytes);
    expect(image.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    const rgb = unfilterPngRows(unzlibSync(image.contents), width * 3, 3, height);
    // Pixels alternate palette entries 1,0,0,1,… → blue, red, red, blue.
    expect(Array.from(rgb?.subarray(0, 12) ?? [])).toEqual([0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 255]);
  });

  it('“Match original” keeps lossless images lossless and JPEG images JPEG', async () => {
    const { doc, page } = await newDoc();
    addImage(doc, page, noise(30_000), { Width: 400, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    addImage(doc, page, new Uint8Array(300 * 200 * 3).fill(128), { Width: 300, Height: 200, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save(), options({ imageFormat: 'match', maxDpi: null }), codec);
    const filters = (await imageStreams(output.bytes)).map(filterOf).sort();
    expect(filters).toEqual(['/DCTDecode', '/FlateDecode']);
  });

  it('keeps soft masks lossless even when JPEG output is selected', async () => {
    const { doc, page } = await newDoc();
    const mask = doc.context.register(
      doc.context.stream(new Uint8Array(200 * 200).map((_, i) => (i % 200 > 100 ? 255 : 0)), { Type: 'XObject', Subtype: 'Image', Width: 200, Height: 200, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })
    );
    addImage(doc, page, noise(30_000), { Width: 400, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', SMask: mask });
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save(), options({ imageFormat: 'jpeg', maxDpi: null }), codec);
    const streams = await imageStreams(output.bytes);
    const maskStream = streams.find((s) => num(s, 'Width') === 200);
    expect(maskStream && filterOf(maskStream)).toBe('/FlateDecode');
    const base = streams.find((s) => num(s, 'Width') === 400);
    expect(base?.dict.get(PDFName.of('SMask'))).toBeInstanceOf(PDFRef);
  });
});

describe('compressPdf — unsupported images are left untouched and explained', () => {
  it.each([
    [{ Filter: 'JPXDecode', ColorSpace: 'DeviceRGB' }, 'jpeg2000'],
    [{ Filter: 'JBIG2Decode', ColorSpace: 'DeviceGray', BitsPerComponent: 1 }, 'jbig2'],
    [{ Filter: 'CCITTFaxDecode', ColorSpace: 'DeviceGray', BitsPerComponent: 1 }, 'ccitt'],
    [{ Filter: 'DCTDecode', ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }, 'cmyk'],
    [{ Filter: 'DCTDecode', ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Decode: [1, 0, 1, 0, 1, 0] }, 'decode-array'],
    [{ ImageMask: true, BitsPerComponent: 1 }, 'stencil-mask'],
    [{ Filter: 'DCTDecode', ColorSpace: ['Separation', 'Spot', 'DeviceCMYK', 0], BitsPerComponent: 8 }, 'special-color'],
  ])('skips %o as %s', async (dict, reason) => {
    const { doc, page } = await newDoc();
    const contents = noise(5000);
    addImage(doc, page, contents, { Width: 300, Height: 300, ...dict });
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save(), options(), codec);
    expect(output.report.images.unsupported).toBe(1);
    expect(output.report.unsupportedReasons).toEqual([reason]);
    expect(codec.decodeJpeg).not.toHaveBeenCalled();
  });

  it('reports a corrupt Flate image rather than crashing', async () => {
    const { doc, page } = await newDoc();
    addImage(doc, page, noise(5000), { Width: 300, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' });
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save(), options(), codec);
    expect(output.report.unsupportedReasons).toEqual(['corrupt']);
  });
});

describe('compressPdf — structural optimizations', () => {
  it('removes metadata only when asked', async () => {
    const make = async () => {
      const { doc } = await newDoc();
      doc.setTitle('Secret project');
      doc.setAuthor('Jane Doe');
      doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream('<x:xmpmeta/>'.repeat(100), { Type: 'Metadata', Subtype: 'XML' })));
      return doc.save();
    };
    const { codec } = fakeCodec();

    const stripped = await compressOk(await make(), options({ removeMetadata: true }), codec);
    expect(stripped.report.metadataRemoved).toBe(true);
    const strippedDoc = await PDFDocument.load(stripped.bytes);
    expect(strippedDoc.getTitle()).toBeUndefined();
    expect(strippedDoc.getAuthor()).toBeUndefined();
    expect(strippedDoc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();

    const kept = await compressOk(await make(), options({ removeMetadata: false }), codec);
    if (!kept.report.keptOriginal) expect((await PDFDocument.load(kept.bytes)).getTitle()).toBe('Secret project');
    expect(kept.report.metadataRemoved).toBe(false);
  });

  it('removes embedded thumbnails before the image pass, so they are never re-encoded', async () => {
    const { doc, page } = await newDoc();
    const thumb = doc.context.register(doc.context.stream(noise(10_000), { Width: 100, Height: 130, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }));
    page.node.set(PDFName.of('Thumb'), thumb);
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save(), options({ removeThumbnails: true }), codec);
    expect(output.report.thumbnailsRemoved).toBe(1);
    expect(output.report.unusedObjectsRemoved).toBeGreaterThanOrEqual(1);
    expect(output.bytes.length).toBeLessThan(10_000);
  });

  it('deflates uncompressed content streams and removes unreachable objects', async () => {
    const { doc, page } = await newDoc();
    const content = doc.context.register(doc.context.stream('BT /F1 12 Tf 72 712 Td (Hello world) Tj ET\n'.repeat(300)));
    page.node.addContentStream(content);
    doc.context.register(doc.context.stream(noise(20_000))); // Orphan: referenced by nothing.
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save({ useObjectStreams: false }), options(), codec);
    expect(output.report.streamsRecompressed).toBeGreaterThanOrEqual(1);
    expect(output.report.unusedObjectsRemoved).toBeGreaterThanOrEqual(1);
    expect(output.bytes.length).toBeLessThan(5000);
  });

  it('merges byte-identical streams into one shared object', async () => {
    const { doc, page } = await newDoc();
    const second = doc.addPage([612, 792]);
    const contents = noise(8000, 99);
    const cmyk = { Width: 200, Height: 200, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'DCTDecode' };
    addImage(doc, page, contents, cmyk);
    addImage(doc, second, contents, cmyk);
    const input = await doc.save();
    const { codec } = fakeCodec();

    const output = await compressOk(input, options(), codec);
    expect(output.report.duplicatesMerged).toBe(1);
    expect(await imageStreams(output.bytes)).toHaveLength(1);
    // Both pages still point at an image.
    const reloaded = await PDFDocument.load(output.bytes);
    for (const p of reloaded.getPages()) {
      const xobjects = p.node.Resources()?.lookup(PDFName.of('XObject'));
      expect(xobjects?.toString()).toMatch(/Im/);
    }
  });

  it('never returns a larger file — it hands back the original instead', async () => {
    const { doc } = await newDoc();
    const input = await doc.save({ useObjectStreams: true });
    const { codec } = fakeCodec();
    const output = await compressOk(input, options(), codec);
    expect(output.bytes.length).toBeLessThanOrEqual(input.length);
    if (output.report.keptOriginal) {
      expect(output.bytes).toBe(input);
      expect(output.preview).toBeNull();
    }
  });

  it('preserves page count and page contents references', async () => {
    const { doc } = await newDoc();
    doc.addPage();
    doc.addPage();
    const { codec } = fakeCodec();
    const output = await compressOk(await doc.save({ useObjectStreams: false }), options(), codec);
    expect(output.report.pageCount).toBe(3);
    expect((await PDFDocument.load(output.bytes)).getPageCount()).toBe(3);
  });
});

describe('buildSamplePdf', () => {
  it('builds a one-page PDF with text and the given photo', async () => {
    // Minimal baseline JPEG header pdf-lib's embedder can parse (it only reads SOF).
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x09, 0x60, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
    const bytes = await buildSamplePdf(jpeg);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toMatch(/sample/i);
    const images = await imageStreams(bytes);
    expect(images).toHaveLength(1);
    expect([num(images[0], 'Width'), num(images[0], 'Height')]).toEqual([2400, 1600]);
    expect(images[0].dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
  });
});
