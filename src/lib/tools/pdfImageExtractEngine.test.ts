import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, type PDFPage } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { buildSamplePdf, extractPdfImages, type ImageExtractCodec } from './pdfImageExtractEngine';
import type { RgbaImageData } from './imageCompress';

/** A byte string that parses as a JPEG frame header with `components` channels, padded to `size`. */
function fakeJpeg(components: number, size = 64, fill = 0): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 12)).fill(fill);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, components]);
  return bytes;
}

/** Stands in for the browser's canvas codec: records every image it's asked to encode (so
 *  tests can inspect the exact pixels that would land in the PNG) and decodes any JPEG to
 *  solid orange. */
function fakeCodec() {
  const encoded: RgbaImageData[] = [];
  const codec: ImageExtractCodec = {
    decodeJpeg: vi.fn(async (_bytes: Uint8Array, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([200, 100, 50, 255], i);
      return { data, width, height };
    }),
    encodePng: vi.fn(async (image: RgbaImageData) => {
      encoded.push(image);
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, encoded.length]);
    }),
  };
  return { codec, encoded };
}

async function newDoc(pages = 1): Promise<{ doc: PDFDocument; pages: PDFPage[] }> {
  const doc = await PDFDocument.create();
  return { doc, pages: Array.from({ length: pages }, () => doc.addPage([612, 792])) };
}

/** Registers an image XObject; places it on each of `pages` (none = an orphan). */
function addImage(doc: PDFDocument, pages: PDFPage[], contents: Uint8Array, dict: Record<string, unknown>): PDFRef {
  const ref = doc.context.register(doc.context.stream(contents, { Type: 'XObject', Subtype: 'Image', ...dict } as never));
  for (const page of pages) page.node.newXObject('Im', ref);
  return ref;
}

async function extractOk(bytes: Uint8Array, codec: ImageExtractCodec) {
  const result = await extractPdfImages(bytes, codec);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.value;
}

const pixelAt = (image: RgbaImageData, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

describe('extractPdfImages — input validation', () => {
  it('rejects bytes without a PDF header, and empty input', async () => {
    const { codec } = fakeCodec();
    for (const input of [new TextEncoder().encode('hello world'), new Uint8Array()]) {
      const result = await extractPdfImages(input, codec);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/isn’t a PDF/);
    }
  });

  it('rejects a damaged file that only has a PDF header', async () => {
    const { codec } = fakeCodec();
    const result = await extractPdfImages(new TextEncoder().encode('%PDF-1.7\n this is not a real pdf body'), codec);
    expect(result.ok).toBe(false);
  });

  it('explains how to handle an encrypted PDF', async () => {
    const { doc } = await newDoc();
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1 }));
    const { codec } = fakeCodec();
    const result = await extractPdfImages(await doc.save(), codec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/encrypted.*Print to PDF/s);
  });

  it('reports zero images for a text-only PDF rather than failing', async () => {
    const { doc, pages } = await newDoc(3);
    pages[0].drawText('Only text here');
    const { codec } = fakeCodec();
    const { images, report } = await extractOk(await doc.save(), codec);
    expect(images).toEqual([]);
    expect(report).toMatchObject({ pageCount: 3, found: 0, extracted: 0, skipped: 0 });
  });
});

describe('extractPdfImages — JPEG and JPEG 2000', () => {
  it('saves a JPEG byte-for-byte, without decoding or re-encoding it', async () => {
    const { doc, pages } = await newDoc();
    const jpeg = fakeJpeg(3, 5000, 7);
    addImage(doc, pages, jpeg, { Width: 640, Height: 480, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ number: 1, format: 'jpeg', width: 640, height: 480, pages: [1], color: 'rgb', hasAlpha: false });
    expect(images[0].bytes).toEqual(jpeg);
    expect(codec.decodeJpeg).not.toHaveBeenCalled();
    expect(codec.encodePng).not.toHaveBeenCalled();
  });

  it('returns JPEG bytes in their own buffer, not a view into the whole PDF', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, fakeJpeg(1, 2000), { Width: 10, Height: 10, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0].bytes.byteOffset).toBe(0);
    expect(images[0].bytes.buffer.byteLength).toBe(images[0].bytes.length);
  });

  it('labels a CMYK JPEG from its frame header and still saves it as stored', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, fakeJpeg(4, 300), { Width: 20, Height: 20, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'DCTDecode', Decode: [1, 0, 1, 0, 1, 0, 1, 0] });
    const { codec } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0]).toMatchObject({ format: 'jpeg', color: 'cmyk' });
  });

  it('skips a gray/RGB JPEG with an inverting Decode array instead of saving a negative', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, fakeJpeg(1, 300), { Width: 20, Height: 20, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'DCTDecode', Decode: [1, 0] });
    const { codec } = fakeCodec();
    const { images, report } = await extractOk(await doc.save(), codec);
    expect(images).toHaveLength(0);
    expect(report.skippedReasons).toEqual(['decode-array']);
  });

  it('decodes a JPEG that has a soft mask and saves it as a transparent PNG', async () => {
    const { doc, pages } = await newDoc();
    const mask = addImage(doc, [], zlibSync(new Uint8Array([0, 255, 128, 255])), { Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' });
    addImage(doc, pages, fakeJpeg(3, 300), { Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', SMask: mask });
    const { codec, encoded } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ format: 'png', hasAlpha: true });
    expect(pixelAt(encoded[0], 0, 0)).toEqual([200, 100, 50, 0]);
    expect(pixelAt(encoded[0], 1, 0)).toEqual([200, 100, 50, 255]);
    expect(pixelAt(encoded[0], 0, 1)[3]).toBe(128);
  });

  it('falls back to the stored JPEG (opaque) when the browser cannot decode it for masking', async () => {
    const { doc, pages } = await newDoc();
    const mask = addImage(doc, [], zlibSync(new Uint8Array([0, 255, 128, 255])), { Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' });
    addImage(doc, pages, fakeJpeg(3, 300), { Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', SMask: mask });
    const { codec } = fakeCodec();
    vi.mocked(codec.decodeJpeg).mockRejectedValue(new Error('decode failed'));
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0]).toMatchObject({ format: 'jpeg', hasAlpha: false });
  });

  it('passes JPEG 2000 through as a .jp2 file', async () => {
    const { doc, pages } = await newDoc();
    const jp2 = new Uint8Array([0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 1, 2, 3]);
    addImage(doc, pages, jp2, { Width: 100, Height: 50, BitsPerComponent: 8, Filter: 'JPXDecode' });
    const { codec } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0]).toMatchObject({ format: 'jp2', width: 100, height: 50, color: 'unknown' });
    expect(images[0].bytes).toEqual(jp2);
  });

  it('skips JBIG2 and CCITT scans with a reason, without failing the other images', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array(40), { Width: 100, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'JBIG2Decode' });
    addImage(doc, pages, new Uint8Array(40), { Width: 100, Height: 100, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode' });
    addImage(doc, pages, fakeJpeg(3, 300), { Width: 20, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const { codec } = fakeCodec();
    const { images, report } = await extractOk(await doc.save(), codec);
    expect(images).toHaveLength(1);
    expect(report).toMatchObject({ found: 3, extracted: 1, skipped: 2 });
    expect(report.skippedReasons.sort()).toEqual(['ccitt', 'jbig2']);
  });
});

describe('extractPdfImages — lossless images become PNG', () => {
  it('decodes Flate RGB pixels exactly', async () => {
    const { doc, pages } = await newDoc();
    const raw = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    addImage(doc, pages, zlibSync(raw), { Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' });
    const { codec, encoded } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0]).toMatchObject({ format: 'png', width: 2, height: 2, color: 'rgb', hasAlpha: false });
    expect(pixelAt(encoded[0], 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(encoded[0], 1, 1)).toEqual([10, 20, 30, 255]);
  });

  it('decodes uncompressed 1-bit gray, palette and CMYK images', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array([0b10000000]), { Width: 2, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 1 });
    addImage(doc, pages, new Uint8Array([1, 0]), { Width: 2, Height: 1, ColorSpace: ['Indexed', 'DeviceRGB', 1, doc.context.obj([]) as never], BitsPerComponent: 8 });
    addImage(doc, pages, new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0]), { Width: 2, Height: 1, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 });
    const { codec, encoded } = fakeCodec();
    const { images, report } = await extractOk(await doc.save(), codec);
    // The palette image's lookup is an empty array object, not a string — so it's corrupt.
    expect(report.skippedReasons).toEqual(['corrupt']);
    expect(images.map((image) => image.color)).toEqual(['gray', 'cmyk']);
    expect(pixelAt(encoded[0], 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(encoded[0], 1, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(encoded[1], 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(encoded[1], 1, 0)).toEqual([0, 255, 255, 255]);
  });

  it('reads a palette given as a hex string', async () => {
    const { doc, pages } = await newDoc();
    const stream = doc.context.stream(new Uint8Array([1, 0]), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 1, BitsPerComponent: 8 } as never);
    // pdf-lib's literal converter can't express a hex string, so the colour space array is
    // assembled from PDF objects directly.
    stream.dict.set(PDFName.of('ColorSpace'), doc.context.obj([PDFName.of('Indexed'), PDFName.of('DeviceRGB'), PDFNumber.of(1), PDFHexString.of('FF000000FF00')]));
    pages[0].node.newXObject('Im', doc.context.register(stream));
    const { codec, encoded } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0].color).toBe('indexed');
    expect(pixelAt(encoded[0], 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(encoded[0], 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it('applies an inverting Decode array to a gray scan', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array([0, 255]), { Width: 2, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Decode: [1, 0] });
    const { codec, encoded } = fakeCodec();
    await extractOk(await doc.save(), codec);
    expect(pixelAt(encoded[0], 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(encoded[0], 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it('applies a soft mask of a different resolution', async () => {
    const { doc, pages } = await newDoc();
    const mask = addImage(doc, [], new Uint8Array([0, 255]), { Width: 2, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
    addImage(doc, pages, new Uint8Array(4 * 2 * 3).fill(90), { Width: 4, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: mask });
    const { codec, encoded } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0].hasAlpha).toBe(true);
    expect(pixelAt(encoded[0], 0, 0)[3]).toBe(0);
    expect(pixelAt(encoded[0], 1, 1)[3]).toBe(0);
    expect(pixelAt(encoded[0], 2, 0)[3]).toBe(255);
    expect(pixelAt(encoded[0], 3, 1)[3]).toBe(255);
  });

  it('applies an explicit stencil /Mask image and a colour-key /Mask array', async () => {
    const { doc, pages } = await newDoc();
    const stencil = addImage(doc, [], new Uint8Array([0b01000000]), { Width: 2, Height: 1, ImageMask: true });
    addImage(doc, pages, new Uint8Array([10, 10, 10, 20, 20, 20]), { Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Mask: stencil });
    addImage(doc, pages, new Uint8Array([0, 255, 0, 9, 9, 9]), { Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Mask: [0, 0, 250, 255, 0, 0] });
    const { codec, encoded } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images.every((image) => image.hasAlpha)).toBe(true);
    // Stencil: sample 0 paints, 1 masks out.
    expect(pixelAt(encoded[0], 0, 0)[3]).toBe(255);
    expect(pixelAt(encoded[0], 1, 0)[3]).toBe(0);
    // Colour key: pure green is keyed out, the dark pixel stays.
    expect(pixelAt(encoded[1], 0, 0)[3]).toBe(0);
    expect(pixelAt(encoded[1], 1, 0)[3]).toBe(255);
  });

  it('saves an image drawn as a stencil mask as black on transparent', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array([0b01000000]), { Width: 2, Height: 1, ImageMask: true });
    const { codec, encoded } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images[0]).toMatchObject({ color: 'stencil', hasAlpha: true, format: 'png' });
    expect(pixelAt(encoded[0], 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(encoded[0], 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('skips spot-colour images and corrupt streams with reasons', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array(4), { Width: 2, Height: 2, ColorSpace: ['Separation', 'Gold', 'DeviceCMYK', 0], BitsPerComponent: 8 });
    addImage(doc, pages, new Uint8Array([1, 2, 3]), { Width: 100, Height: 100, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' });
    const { codec } = fakeCodec();
    const { report } = await extractOk(await doc.save(), codec);
    expect(report.skipped).toBe(2);
    expect(report.skippedReasons.sort()).toEqual(['corrupt', 'special-color']);
  });

  it('refuses to decode an absurdly large raw image instead of exhausting memory', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array(16), { Width: 20000, Height: 20000, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
    const { codec } = fakeCodec();
    const { report } = await extractOk(await doc.save(), codec);
    expect(report.skippedReasons).toEqual(['too-large']);
  });

  it('reports a PNG encode failure on a very large image as too large', async () => {
    const { doc, pages } = await newDoc();
    addImage(doc, pages, new Uint8Array(5000 * 4000), { Width: 5000, Height: 4000, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
    const { codec } = fakeCodec();
    vi.mocked(codec.encodePng).mockRejectedValue(new Error('canvas too big'));
    const { report } = await extractOk(await doc.save(), codec);
    expect(report.skippedReasons).toEqual(['too-large']);
  });
});

describe('extractPdfImages — locating images', () => {
  it('lists every page an image is drawn on, and folds byte-identical copies together', async () => {
    const { doc, pages } = await newDoc(4);
    const jpeg = fakeJpeg(3, 400, 3);
    const dict = { Width: 20, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' };
    addImage(doc, [pages[0], pages[2]], jpeg, dict);
    addImage(doc, [pages[3]], jpeg, dict); // A separate but identical object.
    addImage(doc, [pages[1]], fakeJpeg(3, 400, 9), dict);
    const { codec } = fakeCodec();
    const { images, report } = await extractOk(await doc.save(), codec);
    expect(images.map((image) => image.pages)).toEqual([[1, 3, 4], [2]]);
    expect(images.map((image) => image.number)).toEqual([1, 2]);
    expect(report).toMatchObject({ found: 2, extracted: 2, duplicatesMerged: 1 });
  });

  it('finds images inside nested Form XObjects, and ignores images no page draws', async () => {
    const { doc, pages } = await newDoc();
    const image = addImage(doc, [], fakeJpeg(3, 300), { Width: 20, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    addImage(doc, [], fakeJpeg(3, 300, 5), { Width: 20, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
    const inner = doc.context.register(
      doc.context.stream('/Im1 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Im1: image } } } as never)
    );
    const outer = doc.context.register(
      doc.context.stream('/Fm1 Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Fm1: inner } } } as never)
    );
    pages[0].node.newXObject('Fm', outer);
    const { codec } = fakeCodec();
    const { images, report } = await extractOk(await doc.save(), codec);
    expect(images).toHaveLength(1);
    expect(images[0].pages).toEqual([1]);
    expect(report.found).toBe(1);
  });

  it('survives a Form XObject that (illegally) contains itself', async () => {
    const { doc, pages } = await newDoc();
    const form = doc.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] } as never);
    const ref = doc.context.register(form);
    form.dict.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Self: ref } }));
    pages[0].node.newXObject('Fm', ref);
    const { codec } = fakeCodec();
    const { images } = await extractOk(await doc.save(), codec);
    expect(images).toEqual([]);
  });
});

describe('buildSamplePdf', () => {
  it('builds the example brochure: photo, shared transparent badge, tiny spacer and chart', async () => {
    const { codec } = fakeCodec();
    const bytes = await buildSamplePdf(fakeJpeg(3, 20_000));
    const { images, report } = await extractOk(bytes, codec);
    expect(report).toMatchObject({ pageCount: 2, found: 4, extracted: 4, duplicatesMerged: 1, skipped: 0 });
    expect(images.map((image) => [image.format, image.width, image.height, image.pages])).toEqual([
      ['jpeg', 16, 16, [1]],
      ['png', 160, 160, [1, 2]],
      ['png', 4, 4, [1]],
      ['png', 480, 300, [2]],
    ]);
    expect(images[1].hasAlpha).toBe(true);
  });
});
