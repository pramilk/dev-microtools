import { describe, it, expect, vi } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { imagesToPdf, type ImageDecodeCodec, type ImageSourceInput } from './imageToPdfEngine';
import { DEFAULT_IMAGE_TO_PDF_OPTIONS, withExifOrientation, type ImageToPdfOptions } from './imageToPdf';
import type { RgbaImageData } from './imageCompress';

/** A byte string that parses as a JPEG frame header (`width`×`height`, 3 components). */
function fakeJpeg(width: number, height: number, size = 400): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return bytes;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const fakePng = () => new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0]);
const fakeWebp = () => new TextEncoder().encode('RIFF....WEBPVP8 ');

function solid(width: number, height: number, alpha = 255): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([30, 60, 90, alpha], i);
  return { data, width, height };
}

/** Decodes every non-JPEG to `decoded` (or throws for names in `undecodable`), and encodes
 *  JPEG as a valid-looking frame header of the right size. */
function fakeCodec(decoded: RgbaImageData = solid(40, 20)) {
  const codec: ImageDecodeCodec = {
    decodeImage: vi.fn(async () => decoded),
    encodeJpeg: vi.fn(async (image: RgbaImageData) => fakeJpeg(image.width, image.height, 120)),
  };
  return codec;
}

const options = (patch: Partial<ImageToPdfOptions> = {}): ImageToPdfOptions => ({ ...DEFAULT_IMAGE_TO_PDF_OPTIONS, ...patch });
const source = (name: string, bytes: Uint8Array, rotation: ImageSourceInput['rotation'] = 0): ImageSourceInput => ({ name, bytes, rotation });

async function buildOk(sources: ImageSourceInput[], opts: ImageToPdfOptions, codec: ImageDecodeCodec) {
  const result = await imagesToPdf(sources, opts, codec);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  const doc = await PDFDocument.load(result.value.bytes);
  return { ...result.value, doc };
}

function imageStreams(doc: PDFDocument): PDFRawStream[] {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
}

const sizeOf = (doc: PDFDocument, index: number) => {
  const { width, height } = doc.getPage(index).getSize();
  return [Math.round(width), Math.round(height)];
};

describe('imagesToPdf — validation', () => {
  it('rejects an empty batch', async () => {
    const result = await imagesToPdf([], options(), fakeCodec());
    expect(result).toEqual({ ok: false, error: 'Add at least one image to make a PDF.' });
  });

  it('fails with the image’s own reason when the only image can’t be read', async () => {
    const codec = fakeCodec();
    vi.mocked(codec.decodeImage).mockRejectedValue(new Error('nope'));
    const result = await imagesToPdf([source('IMG_0001.HEIC', new Uint8Array([0, 0, 0, 0x18]))], options(), codec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/HEIC.*Safari/);
  });

  it('summarises when none of several images can be read', async () => {
    const codec = fakeCodec();
    vi.mocked(codec.decodeImage).mockRejectedValue(new Error('nope'));
    const result = await imagesToPdf([source('a.tiff', new Uint8Array(4)), source('b.bin', new Uint8Array(4))], options(), codec);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/None of the 2 images could be read\. First problem: TIFF/);
  });
});

describe('imagesToPdf — JPEG', () => {
  it('embeds a JPEG byte-for-byte, without decoding or re-encoding it', async () => {
    const codec = fakeCodec();
    const jpeg = fakeJpeg(800, 600);
    const { doc, report } = await buildOk([source('photo.jpg', jpeg)], options(), codec);
    expect(codec.decodeImage).not.toHaveBeenCalled();
    expect(codec.encodeJpeg).not.toHaveBeenCalled();
    const [stream] = imageStreams(doc);
    expect(stream.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(stream.contents).toEqual(jpeg);
    expect(report).toMatchObject({ pageCount: 1, embeddedAsIs: 1, lossless: 0, convertedToJpeg: 0, autoRotated: 0, failed: [] });
  });

  it('gives a sideways phone photo (EXIF orientation 6) an upright, portrait page', async () => {
    const jpeg = withExifOrientation(fakeJpeg(1200, 800), 6);
    const { doc, report } = await buildOk([source('phone.jpg', jpeg)], options({ pageSize: 'fit', margin: 'none' }), fakeCodec());
    expect(sizeOf(doc, 0)).toEqual([600, 900]);
    expect(report.autoRotated).toBe(1);
    expect(imageStreams(doc)[0].contents).toEqual(jpeg); // Rotated by the page, not the pixels.
  });

  it('applies the visitor’s rotation, and orientation + rotation can cancel out', async () => {
    const wide = fakeJpeg(1200, 800);
    const { doc } = await buildOk(
      [source('a.jpg', wide, 90), source('b.jpg', withExifOrientation(wide, 6), 270)],
      options({ pageSize: 'a4', orientation: 'auto' }),
      fakeCodec()
    );
    expect(sizeOf(doc, 0)).toEqual([595, 842]); // Turned to portrait.
    expect(sizeOf(doc, 1)).toEqual([842, 595]); // Back to landscape.
  });

  it('reports a damaged JPEG and still builds the rest', async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const { doc, report } = await buildOk([source('broken.jpg', broken), source('ok.jpg', fakeJpeg(10, 10))], options(), fakeCodec());
    expect(doc.getPageCount()).toBe(1);
    expect(report.failed).toEqual([{ index: 0, name: 'broken.jpg', error: expect.stringMatching(/damaged or truncated/) }]);
  });
});

describe('imagesToPdf — other formats', () => {
  it('stores a PNG losslessly, even when it is opaque', async () => {
    const codec = fakeCodec(solid(40, 20));
    const { doc, report } = await buildOk([source('chart.png', fakePng())], options(), codec);
    expect(codec.encodeJpeg).not.toHaveBeenCalled();
    const [stream] = imageStreams(doc);
    expect(stream.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(stream.dict.has(PDFName.of('SMask'))).toBe(false);
    expect(report.lossless).toBe(1);
  });

  it('keeps transparency as a soft mask', async () => {
    const { doc } = await buildOk([source('logo.png', fakePng())], options(), fakeCodec(solid(8, 8, 128)));
    const color = imageStreams(doc).find((stream) => stream.dict.has(PDFName.of('SMask')));
    expect(color).toBeDefined();
    expect(color?.dict.get(PDFName.of('SMask'))).toBeInstanceOf(PDFRef);
  });

  it('stores an opaque WebP as JPEG, and a transparent one losslessly', async () => {
    const opaque = fakeCodec(solid(40, 20));
    const first = await buildOk([source('photo.webp', fakeWebp())], options(), opaque);
    expect(opaque.encodeJpeg).toHaveBeenCalledWith(expect.objectContaining({ width: 40, height: 20 }), 0.92);
    expect(first.report.convertedToJpeg).toBe(1);

    const transparent = fakeCodec(solid(40, 20, 0));
    const second = await buildOk([source('sticker.webp', fakeWebp())], options(), transparent);
    expect(transparent.encodeJpeg).not.toHaveBeenCalled();
    expect(second.report.lossless).toBe(1);
  });

  it('falls back to lossless if the JPEG encode fails', async () => {
    const codec = fakeCodec(solid(40, 20));
    vi.mocked(codec.encodeJpeg).mockRejectedValue(new Error('no canvas'));
    const { report } = await buildOk([source('photo.gif', fakeWebp())], options(), codec);
    expect(report.lossless).toBe(1);
  });

  it('explains a TIFF or unknown format the browser can’t decode', async () => {
    const codec = fakeCodec();
    vi.mocked(codec.decodeImage).mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'));
    const { report } = await buildOk([source('scan.tif', new Uint8Array(8)), source('mystery.dat', new Uint8Array(8)), source('ok.jpg', fakeJpeg(10, 10))], options(), codec);
    expect(report.failed.map((failure) => failure.error)).toEqual([expect.stringMatching(/TIFF.*Safari/), expect.stringMatching(/couldn’t be decoded/)]);
  });
});

describe('imagesToPdf — pages', () => {
  it('makes one page per image, in order, with each page shaped by its option', async () => {
    const images = [source('wide.jpg', fakeJpeg(2000, 1000)), source('tall.jpg', fakeJpeg(1000, 2000))];
    const a4 = await buildOk(images, options({ pageSize: 'a4', orientation: 'auto' }), fakeCodec());
    expect([sizeOf(a4.doc, 0), sizeOf(a4.doc, 1)]).toEqual([
      [842, 595],
      [595, 842],
    ]);
    const letterLandscape = await buildOk(images, options({ pageSize: 'letter', orientation: 'landscape' }), fakeCodec());
    expect([sizeOf(letterLandscape.doc, 0), sizeOf(letterLandscape.doc, 1)]).toEqual([
      [792, 612],
      [792, 612],
    ]);
    const fit = await buildOk(images, options({ pageSize: 'fit', margin: 'large' }), fakeCodec());
    expect(sizeOf(fit.doc, 0)).toEqual([1500 + 72, 750 + 72]);
  });

  it('draws the image with a transformation that fills the layout box', async () => {
    const { doc } = await buildOk([source('wide.jpg', fakeJpeg(2000, 1000))], options({ pageSize: 'fit', margin: 'none' }), fakeCodec());
    const contents = doc.getPage(0).node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((entry) => doc.context.lookup(entry)) : [contents];
    const text = streams
      .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
      .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
      .join('\n');
    expect(text).toMatch(/1500 0 0 750 0 0 cm/);
    expect(text).toMatch(/\/Im-?\d* Do/);
  });

  it('handles a large batch of images', async () => {
    const many = Array.from({ length: 120 }, (_, i) => source(`p${i}.jpg`, fakeJpeg(100 + i, 100)));
    const { doc, report } = await buildOk(many, options(), fakeCodec());
    expect(doc.getPageCount()).toBe(120);
    expect(report.embeddedAsIs).toBe(120);
  });
});
