import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFContext,
  type PDFPage,
} from 'pdf-lib';
import { type ToolResult, ok, err } from './result';
import type { RgbaImageData } from './imageCompress';
import type { RasterCodec } from './pdfCompressEngine';
import {
  alphaFromColorKey,
  alphaFromMaskSamples,
  applyAlpha,
  applyDecodeArray,
  componentsOf,
  jpegComponentCount,
  samplesToRgba,
  unpackSamples,
  type PixelColorModel,
} from './pdfImagePixels';
import { bytesEqual, decodeRawSamples, filterChain, fnv1a, hasDefaultDecode, isImageStream, numberAt, readDecodeArray, registerLosslessImage, resolveColorSpace } from './pdfImageStream';
import {
  looksLikePdf,
  type ExtractedImageColor,
  type ExtractedImageFormat,
  type ExtractedPdfImage,
  type PdfImageExtractReport,
  type SkippedImageReason,
} from './pdfImageExtract';

/**
 * The PDF Image Extractor's pipeline: find every image drawn on every page (including inside
 * nested Form XObjects), fold byte-identical copies together, and turn each into a file.
 * Imported only by `workers/pdfImageExtract.worker.ts`, so pdf-lib never lands in any page's
 * bundle — the island imports the lightweight `pdfImageExtract.ts` instead.
 *
 * JPEG and JPEG 2000 images are saved exactly as stored (byte-for-byte, so no quality loss);
 * everything else is decoded to pixels and saved as PNG, with its transparency applied.
 */

/** The browser-only half: decoding a JPEG (only needed when it has a mask to apply) and
 *  encoding PNG. The worker supplies the OffscreenCanvas-backed implementation. */
export type ImageExtractCodec = Pick<RasterCodec, 'decodeJpeg' | 'encodePng'>;

export interface PdfImageExtractOutput {
  images: ExtractedPdfImage[];
  report: PdfImageExtractReport;
}

/** Decoding needs 4 bytes per pixel at once (plus the source samples), so this bounds the
 *  worker's peak memory at a few hundred MB. A 600 DPI A3 scan is ~70 megapixels. */
const MAX_DECODE_PIXELS = 100_000_000;
/** Safari's canvas area limit; a PNG encode failing above it is a size problem, not a
 *  damaged image, and is reported that way. */
const SAFARI_CANVAS_PIXELS = 16_777_216;
/** Form XObjects can nest (and malformed files can loop); real documents never go deep. */
const MAX_FORM_DEPTH = 32;

const name = (value: string): PDFName => PDFName.of(value);

const IMAGE = name('Image');
const FORM = name('Form');

interface FoundImage {
  stream: PDFRawStream;
  pages: Set<number>;
}

/**
 * Every image XObject reachable from a page's resources, in order of first appearance, with
 * the pages each is drawn on. Walking from the pages (rather than enumerating every object
 * in the file) skips orphans left by earlier edits, embedded page thumbnails, and masks —
 * which are reached through their image's `/SMask` entry, never from resources.
 */
function collectPageImages(context: PDFContext, pages: PDFPage[]): FoundImage[] {
  const found = new Map<string, FoundImage>();

  pages.forEach((page, index) => {
    const visitedForms = new Set<string>();
    const walk = (resources: PDFDict | undefined, depth: number): void => {
      if (!resources || depth > MAX_FORM_DEPTH) return;
      const xobjects = resources.lookup(name('XObject'));
      if (!(xobjects instanceof PDFDict)) return;
      for (const [, value] of xobjects.entries()) {
        // XObjects must be indirect objects per the spec; a direct one can't be a stream.
        if (!(value instanceof PDFRef)) continue;
        const key = value.toString();
        const object = context.lookup(value);
        if (!(object instanceof PDFStream)) continue;
        const subtype = object.dict.lookup(name('Subtype'));
        if (subtype === IMAGE && object instanceof PDFRawStream) {
          const existing = found.get(key);
          if (existing) existing.pages.add(index + 1);
          else found.set(key, { stream: object, pages: new Set([index + 1]) });
        } else if (subtype === FORM && !visitedForms.has(key)) {
          visitedForms.add(key);
          const formResources = object.dict.lookup(name('Resources'));
          walk(formResources instanceof PDFDict ? formResources : undefined, depth + 1);
        }
      }
    };
    walk(page.node.Resources(), 0);
  });

  return [...found.values()];
}

/**
 * Folds byte-identical image streams (same bytes *and* same dictionary, so they really are
 * the same picture with the same mask) into the first occurrence — merge tools and some
 * generators embed a letterhead logo separately on every page.
 */
function mergeDuplicates(found: FoundImage[]): { unique: FoundImage[]; merged: number } {
  const buckets = new Map<string, FoundImage[]>();
  const unique: FoundImage[] = [];
  let merged = 0;
  for (const image of found) {
    const key = `${image.stream.contents.length}:${fnv1a(image.stream.contents)}:${image.stream.dict.toString()}`;
    const bucket = buckets.get(key) ?? [];
    const original = bucket.find((candidate) => bytesEqual(candidate.stream.contents, image.stream.contents));
    if (original) {
      for (const page of image.pages) original.pages.add(page);
      merged += 1;
      continue;
    }
    bucket.push(image);
    buckets.set(key, bucket);
    unique.push(image);
  }
  return { unique, merged };
}

type Extraction =
  | { ok: true; bytes: Uint8Array; format: ExtractedImageFormat; width: number; height: number; color: ExtractedImageColor; hasAlpha: boolean }
  | { ok: false; reason: SkippedImageReason };

const skip = (reason: SkippedImageReason): Extraction => ({ ok: false, reason });

const colorOf = (model: PixelColorModel): ExtractedImageColor => model.kind;

interface AlphaMap {
  alpha: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decodes a `/SMask` (soft, 0-255 coverage) or `/Mask` image (1-bit stencil) into an alpha
 * map. Returns null when there's no mask or it can't be decoded — the image is then saved
 * opaque rather than not at all, since the pixels themselves are still what was asked for.
 */
async function maskAlphaFor(dict: PDFDict, codec: ImageExtractCodec): Promise<AlphaMap | null> {
  const soft = dict.lookup(name('SMask'));
  const stencil = dict.lookup(name('Mask'));
  const mask = isImageStream(soft) ? soft : isImageStream(stencil) ? stencil : undefined;
  if (!(mask instanceof PDFRawStream)) return null;
  const kind = mask === soft ? 'soft' : 'stencil';

  const width = numberAt(mask.dict, 'Width');
  const height = numberAt(mask.dict, 'Height');
  if (!width || !height || width < 1 || height < 1 || width * height > MAX_DECODE_PIXELS) return null;

  const filters = filterChain(mask.dict);
  if (filters === null) return null;
  const names = filters.map((filter) => filter.asString());

  if (names.length === 1 && names[0] === '/DCTDecode') {
    try {
      const pixels = await codec.decodeJpeg(mask.contents, width, height);
      const alpha = new Uint8Array(width * height);
      for (let p = 0; p < alpha.length; p++) alpha[p] = pixels.data[p * 4];
      return { alpha, width, height };
    } catch {
      return null;
    }
  }
  if (names.some((filter) => filter === '/DCTDecode' || filter === '/JPXDecode' || filter === '/JBIG2Decode' || filter === '/CCITTFaxDecode')) return null;

  const bitsPerComponent = kind === 'stencil' ? 1 : (numberAt(mask.dict, 'BitsPerComponent') ?? 8);
  const packed = decodeRawSamples(mask, filters, width, height, 1, bitsPerComponent);
  if (typeof packed === 'string') return null;
  const unpacked = unpackSamples(packed, width, height, 1, bitsPerComponent);
  if (!unpacked) return null;

  const decode = readDecodeArray(mask.dict, 1);
  if (kind === 'stencil') {
    return { alpha: alphaFromMaskSamples(unpacked.samples, unpacked.maxValue, 'stencil', Array.isArray(decode) && decode[0] === 1), width, height };
  }
  const samples = Array.isArray(decode) ? applyDecodeArray(unpacked.samples, 1, unpacked.maxValue, decode) : unpacked.samples;
  return { alpha: alphaFromMaskSamples(samples, unpacked.maxValue, 'soft'), width, height };
}

async function toPng(pixels: RgbaImageData, codec: ImageExtractCodec, color: ExtractedImageColor, hasAlpha: boolean): Promise<Extraction> {
  try {
    const bytes = await codec.encodePng(pixels);
    return { ok: true, bytes, format: 'png', width: pixels.width, height: pixels.height, color, hasAlpha };
  } catch {
    return skip(pixels.width * pixels.height > SAFARI_CANVAS_PIXELS ? 'too-large' : 'corrupt');
  }
}

/** A 1-bit stencil mask drawn as an image in its own right: black where it paints (the
 *  fill colour isn't part of the image), transparent everywhere else. */
async function extractStencil(stream: PDFRawStream, filters: PDFName[], width: number, height: number, codec: ImageExtractCodec): Promise<Extraction> {
  const packed = decodeRawSamples(stream, filters, width, height, 1, 1);
  if (typeof packed === 'string') return skip(packed);
  const unpacked = unpackSamples(packed, width, height, 1, 1);
  if (!unpacked) return skip('corrupt');
  const decode = readDecodeArray(stream.dict, 1);
  const alpha = alphaFromMaskSamples(unpacked.samples, unpacked.maxValue, 'stencil', Array.isArray(decode) && decode[0] === 1);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < alpha.length; p++) data[p * 4 + 3] = alpha[p];
  return toPng({ data, width, height }, codec, 'stencil', true);
}

async function extractImage(context: PDFContext, stream: PDFRawStream, codec: ImageExtractCodec): Promise<Extraction> {
  const { dict } = stream;
  const filters = filterChain(dict);
  if (filters === null) return skip('encoding');
  const names = filters.map((filter) => filter.asString());
  if (names.includes('/JBIG2Decode')) return skip('jbig2');
  if (names.includes('/CCITTFaxDecode')) return skip('ccitt');

  const width = numberAt(dict, 'Width');
  const height = numberAt(dict, 'Height');
  if (!width || !height || width < 1 || height < 1 || !Number.isInteger(width) || !Number.isInteger(height)) return skip('corrupt');

  // JPEG and JPEG 2000 are only handled as the sole filter: pdf-lib can't decode either, so
  // an earlier filter in the chain can't be peeled off to reach the encoded image.
  const encoded = names.find((filter) => filter === '/DCTDecode' || filter === '/JPXDecode');
  if (encoded && names.length !== 1) return skip('encoding');
  const isStencil = dict.lookup(name('ImageMask')) === PDFBool.True;

  if (isStencil) {
    if (encoded) return skip('encoding');
    if (width * height > MAX_DECODE_PIXELS) return skip('too-large');
    return extractStencil(stream, filters, width, height, codec);
  }

  const color = resolveColorSpace(context, dict.get(name('ColorSpace')), false);

  if (encoded === '/JPXDecode') {
    // A JPEG 2000 stream is a complete .jp2 codestream with its own colour information.
    return { ok: true, bytes: stream.contents.slice(), format: 'jp2', width, height, color: color.ok ? colorOf(color.model) : 'unknown', hasAlpha: false };
  }

  if (encoded === '/DCTDecode') {
    const components = jpegComponentCount(stream.contents);
    const jpegColor: ExtractedImageColor = color.ok ? colorOf(color.model) : components === 1 ? 'gray' : components === 3 ? 'rgb' : components === 4 ? 'cmyk' : 'unknown';
    // An inverting /Decode on a gray or RGB JPEG would save as a negative. CMYK JPEGs are
    // let through regardless: Photoshop's inverted-CMYK convention pairs `/Decode [1 0 …]`
    // with an Adobe marker inside the JPEG itself, which image viewers already honour.
    if (color.ok && (color.model.kind === 'gray' || color.model.kind === 'rgb') && !hasDefaultDecode(dict, color.model, 8)) return skip('decode-array');

    // `.slice()`: `contents` is a view into the whole PDF's buffer, and posting a view back
    // from the worker would structured-clone that entire buffer once per image.
    const asStored: Extraction = { ok: true, bytes: stream.contents.slice(), format: 'jpeg', width, height, color: jpegColor, hasAlpha: false };
    if (width * height > MAX_DECODE_PIXELS) return asStored;
    const mask = await maskAlphaFor(dict, codec);
    if (!mask) return asStored;
    let pixels: RgbaImageData;
    try {
      pixels = await codec.decodeJpeg(stream.contents, width, height);
    } catch {
      return asStored;
    }
    return toPng(applyAlpha(pixels, mask.alpha, mask.width, mask.height), codec, jpegColor, true);
  }

  if (!color.ok) return skip(color.reason);
  const { model } = color;
  if (width * height > MAX_DECODE_PIXELS) return skip('too-large');

  const bitsPerComponent = numberAt(dict, 'BitsPerComponent') ?? 8;
  const components = componentsOf(model);
  const packed = decodeRawSamples(stream, filters, width, height, components, bitsPerComponent);
  if (typeof packed === 'string') return skip(packed);
  const unpacked = unpackSamples(packed, width, height, components, bitsPerComponent);
  if (!unpacked) return skip([1, 2, 4, 8, 16].includes(bitsPerComponent) ? 'corrupt' : 'bit-depth');

  let samples = unpacked.samples;
  if (!hasDefaultDecode(dict, model, bitsPerComponent)) {
    const ranges = model.kind === 'indexed' ? null : readDecodeArray(dict, components);
    if (!ranges) return skip('decode-array');
    samples = applyDecodeArray(samples, components, unpacked.maxValue, ranges);
  }
  let pixels = samplesToRgba(samples, width, height, model, unpacked.maxValue);

  let hasAlpha = false;
  const colorKey = dict.has(name('SMask')) ? undefined : dict.lookup(name('Mask'));
  if (colorKey instanceof PDFArray) {
    const ranges: number[] = [];
    for (let i = 0; i < colorKey.size(); i++) {
      const entry = colorKey.lookup(i);
      if (entry instanceof PDFNumber) ranges.push(entry.asNumber());
    }
    if (ranges.length === components * 2) {
      pixels = applyAlpha(pixels, alphaFromColorKey(unpacked.samples, components, ranges, bitsPerComponent), width, height);
      hasAlpha = true;
    }
  } else {
    const mask = await maskAlphaFor(dict, codec);
    if (mask) {
      pixels = applyAlpha(pixels, mask.alpha, mask.width, mask.height);
      hasAlpha = true;
    }
  }
  return toPng(pixels, codec, colorOf(model), hasAlpha);
}

const ENCRYPTED_MESSAGE =
  'This PDF is encrypted (it has a password or permission restrictions), so its images can’t be read in the browser. Open it in a PDF viewer, “Print to PDF” to save an unprotected copy, and extract from that instead.';
const UNREADABLE_MESSAGE = 'This file couldn’t be read as a PDF — it may be damaged or truncated. Try re-exporting it from the app that created it.';

/**
 * Extracts every image drawn on the PDF's pages. An image that can't be decoded is counted
 * and reported (with the reason) rather than failing the whole run, so one exotic scan
 * doesn't cost the visitor every other picture in the document.
 */
export async function extractPdfImages(input: Uint8Array, codec: ImageExtractCodec): Promise<ToolResult<PdfImageExtractOutput>> {
  if (!looksLikePdf(input)) {
    return err('This file doesn’t start with a PDF header, so it isn’t a PDF — it may be a different file type renamed to .pdf.');
  }

  let doc: PDFDocument;
  try {
    // Encryption is checked via `isEncrypted` rather than by catching pdf-lib's
    // `EncryptedPDFError`, whose ES5-compiled class breaks `instanceof` (see PDF Compressor).
    doc = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: true });
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
  if (doc.isEncrypted) return err(ENCRYPTED_MESSAGE);

  let pageCount: number;
  let found: FoundImage[];
  try {
    const pages = doc.getPages();
    pageCount = pages.length;
    found = collectPageImages(doc.context, pages);
  } catch {
    return err('This PDF’s page structure is damaged, so its images can’t be located. Try re-exporting it from the app that created it.');
  }

  const { unique, merged } = mergeDuplicates(found);
  const images: ExtractedPdfImage[] = [];
  const reasons = new Set<SkippedImageReason>();
  let skipped = 0;

  for (const entry of unique) {
    const result = await extractImage(doc.context, entry.stream, codec);
    if (!result.ok) {
      skipped += 1;
      reasons.add(result.reason);
      continue;
    }
    images.push({
      number: images.length + 1,
      bytes: result.bytes,
      format: result.format,
      width: result.width,
      height: result.height,
      color: result.color,
      hasAlpha: result.hasAlpha,
      pages: [...entry.pages].sort((a, b) => a - b),
    });
  }

  return ok({
    images,
    report: { pageCount, found: unique.length, extracted: images.length, duplicatesMerged: merged, skipped, skippedReasons: [...reasons] },
  });
}

// ─── "Load example" document ─────────────────────────────────────────────────────────────

function rgbaImage(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}

function placeImage(page: PDFPage, ref: PDFRef, x: number, y: number, width: number, height: number): void {
  const key = page.node.newXObject('Im', ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, x, y), drawObject(key), popGraphicsState());
}

/** A round teal badge with a soft-edged alpha mask, so the example shows transparency
 *  surviving extraction. Returns the colour pixels and the matching coverage map. */
function badgeImages(size: number): { color: RgbaImageData; alpha: RgbaImageData } {
  const centre = size / 2;
  const radius = size * 0.45;
  const coverage = (x: number, y: number) => Math.max(0, Math.min(1, radius - Math.hypot(x + 0.5 - centre, y + 0.5 - centre) + 0.5));
  const color = rgbaImage(size, size, (x, y) => {
    const ring = Math.abs(Math.hypot(x + 0.5 - centre, y + 0.5 - centre) - radius * 0.6) < size * 0.05;
    return ring ? [255, 255, 255, 255] : [11, 110 + Math.round((y / size) * 60), 128, 255];
  });
  const alpha = rgbaImage(size, size, (x, y) => {
    const a = Math.round(coverage(x, y) * 255);
    return [a, a, a, 255];
  });
  return { color, alpha };
}

/** A small bar chart — the kind of crisp, flat-colour graphic PDFs store losslessly. */
function chartImage(width: number, height: number): RgbaImageData {
  const bars = [0.45, 0.7, 0.55, 0.9, 0.75];
  const colors: [number, number, number][] = [
    [11, 110, 128],
    [60, 188, 212],
    [11, 110, 128],
    [60, 188, 212],
    [11, 110, 128],
  ];
  const margin = 24;
  const slot = (width - margin * 2) / bars.length;
  return rgbaImage(width, height, (x, y) => {
    if (y === height - margin || x === margin) return [87, 99, 111, 255];
    const index = Math.floor((x - margin) / slot);
    const inBar = index >= 0 && index < bars.length && (x - margin) % slot > slot * 0.2 && (x - margin) % slot < slot * 0.8;
    const top = height - margin - bars[index] * (height - margin * 2);
    if (inBar && y > top && y < height - margin) return [...colors[index], 255];
    return [255, 255, 255, 255];
  });
}

/**
 * Builds the "Load example" document: a two-page brochure with a JPEG photo, a bar chart, a
 * transparent badge drawn on both pages (embedded twice, byte-identical, as merge tools
 * often leave it) and a tiny spacer dot — one of each case the gallery handles.
 */
export async function buildSamplePdf(photoJpeg: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Product brochure (sample)');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.34, 0.39, 0.44);
  const { context } = doc;

  const badge = badgeImages(160);
  const badgeMask = registerLosslessImage(context, badge.alpha);
  const spacer = registerLosslessImage(context, rgbaImage(4, 4, () => [200, 200, 200, 255]));

  const first = doc.addPage([612, 792]);
  first.drawText('Product brochure', { x: 54, y: 726, size: 24, font: bold, color: ink });
  first.drawText('A sample PDF with a photo, a chart and a transparent logo to extract.', { x: 54, y: 700, size: 12, font: regular, color: muted });
  const photo = await doc.embedJpg(photoJpeg);
  const photoWidth = 504;
  const photoHeight = (photoWidth * photo.height) / photo.width;
  first.drawImage(photo, { x: 54, y: 670 - photoHeight, width: photoWidth, height: photoHeight });
  placeImage(first, registerLosslessImage(context, badge.color, { SMask: badgeMask }), 490, 712, 64, 64);
  placeImage(first, spacer, 54, 60, 4, 4);

  const second = doc.addPage([612, 792]);
  second.drawText('Quarterly results', { x: 54, y: 726, size: 24, font: bold, color: ink });
  placeImage(second, registerLosslessImage(context, chartImage(480, 300)), 54, 380, 480, 300);
  placeImage(second, registerLosslessImage(context, badge.color, { SMask: badgeMask }), 490, 712, 64, 64);

  return doc.save({ useObjectStreams: false });
}
