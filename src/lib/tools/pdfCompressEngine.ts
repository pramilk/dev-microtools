import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  rgb,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';
import { type ToolResult, ok, err } from './result';
import { computeTargetDimensions, type RgbaImageData } from './imageCompress';
import {
  componentsOf,
  downscaleRgba,
  encodeLossless,
  jpegComponentCount,
  packedRowBytes,
  rgbaToGrayscale,
  samplesToRgba,
  undoTiffPredictor,
  unfilterPngRows,
  unpackSamples,
  type PixelColorModel,
} from './pdfImagePixels';
import {
  looksLikePdf,
  maxImagePixels,
  type PdfCompressOptions,
  type PdfCompressReport,
  type UnsupportedImageReason,
} from './pdfCompress';

/**
 * The PDF Compressor's pipeline: parse with pdf-lib, re-encode embedded images, recompress
 * other streams, strip optional data, merge duplicates, drop unreachable objects, and save
 * with object streams. Imported only by `workers/pdfCompress.worker.ts`, so pdf-lib never
 * lands in any page's bundle — the island imports the lightweight `pdfCompress.ts` instead.
 *
 * Text and vector graphics are never rasterized: only image XObjects are re-encoded, so the
 * output stays searchable and selectable.
 */

/**
 * The browser-only half of image work (JPEG decode/encode needs a canvas), injected so this
 * module stays DOM-free and unit-testable with a fake. The worker supplies an
 * OffscreenCanvas-backed implementation.
 */
export interface RasterCodec {
  /** Decodes JPEG bytes to RGBA at exactly `width`×`height`, resampling during decode where
   *  the browser can. Must ignore EXIF orientation — PDF viewers never apply it. */
  decodeJpeg: (bytes: Uint8Array, width: number, height: number) => Promise<RgbaImageData>;
  encodeJpeg: (image: RgbaImageData, quality: number) => Promise<Uint8Array>;
  /** Only used to build the before/after preview of a lossless image. */
  encodePng: (image: RgbaImageData) => Promise<Uint8Array>;
}

export interface PreviewImage {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
}

/** A before/after pair for the document's largest re-encoded image, so a visitor can judge
 *  the quality trade-off without opening the PDF. */
export interface PdfComparePreview {
  before: PreviewImage;
  after: PreviewImage;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export interface PdfCompressOutput {
  bytes: Uint8Array;
  report: PdfCompressReport;
  preview: PdfComparePreview | null;
}

/** Images this small can't meaningfully shrink, and re-encoding thousands of tiny icons
 *  would cost more time than it saves bytes. */
const MIN_IMAGE_STREAM_BYTES = 2048;
/** Non-image streams below this aren't worth a deflate pass. */
const MIN_STREAM_BYTES = 256;
/** Preview images are capped so the comparison stays light even for a 600-DPI scan. */
const PREVIEW_MAX_SIDE = 1600;

const name = (value: string): PDFName => PDFName.of(value);

const IMAGE = name('Image');
const DCT = name('DCTDecode');
const FLATE = name('FlateDecode');

/** Keys a re-encoded image stream sets itself; everything else (SMask, Intent, OC,
 *  Interpolate, StructParent…) is carried over from the original unchanged. */
const REWRITTEN_IMAGE_KEYS = new Set(['Filter', 'DecodeParms', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent', 'Decode', 'Length', 'DL']);

function numberAt(dict: PDFDict, key: string): number | undefined {
  const value = dict.lookup(name(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

/** The stream's filter chain as names, or null if `/Filter` is something unexpected. */
function filterChain(dict: PDFDict): PDFName[] | null {
  const filter = dict.lookup(name('Filter'));
  if (filter === undefined) return [];
  if (filter instanceof PDFName) return [filter];
  if (filter instanceof PDFArray) {
    const names: PDFName[] = [];
    for (let i = 0; i < filter.size(); i++) {
      const entry = filter.lookup(i);
      if (!(entry instanceof PDFName)) return null;
      names.push(entry);
    }
    return names;
  }
  return null;
}

/** The `/DecodeParms` dictionary for the last filter in the chain — the one whose predictor
 *  applies to the fully-decoded bytes. */
function lastDecodeParms(dict: PDFDict, filterCount: number): PDFDict | undefined {
  const parms = dict.lookup(name('DecodeParms'));
  if (parms instanceof PDFDict) return parms;
  if (parms instanceof PDFArray && filterCount > 0) {
    const last = parms.lookup(filterCount - 1);
    return last instanceof PDFDict ? last : undefined;
  }
  return undefined;
}

type ColorResolution =
  | { ok: true; model: PixelColorModel; original: PDFObject | undefined }
  | { ok: false; reason: UnsupportedImageReason };

function unsupported(reason: UnsupportedImageReason): { ok: false; reason: UnsupportedImageReason } {
  return { ok: false, reason };
}

function resolveColorSpace(context: PDFContext, raw: PDFObject | undefined, isMask: boolean): ColorResolution {
  // A soft mask's colour space is DeviceGray by definition, even when (as is common) the
  // entry is omitted.
  if (raw === undefined) return isMask ? { ok: true, model: { kind: 'gray' }, original: undefined } : unsupported('encoding');
  const space = raw instanceof PDFRef ? context.lookup(raw) : raw;

  if (space instanceof PDFName) {
    const value = space.asString();
    if (value === '/DeviceGray' || value === '/CalGray') return { ok: true, model: { kind: 'gray' }, original: raw };
    if (value === '/DeviceRGB' || value === '/CalRGB') return { ok: true, model: { kind: 'rgb' }, original: raw };
    if (value === '/DeviceCMYK') return unsupported('cmyk');
    return unsupported('special-color');
  }

  if (space instanceof PDFArray && space.size() > 0) {
    const family = space.lookup(0);
    const familyName = family instanceof PDFName ? family.asString() : '';

    if (familyName === '/ICCBased') {
      const profile = space.lookup(1);
      const components = profile instanceof PDFStream ? numberAt(profile.dict, 'N') : undefined;
      if (components === 1) return { ok: true, model: { kind: 'gray' }, original: raw };
      if (components === 3) return { ok: true, model: { kind: 'rgb' }, original: raw };
      if (components === 4) return unsupported('cmyk');
      return unsupported('special-color');
    }
    if (familyName === '/CalGray') return { ok: true, model: { kind: 'gray' }, original: raw };
    if (familyName === '/CalRGB') return { ok: true, model: { kind: 'rgb' }, original: raw };

    if (familyName === '/Indexed' || familyName === '/I') {
      const base = resolveColorSpace(context, space.get(1), false);
      if (!base.ok) return base;
      if (base.model.kind === 'indexed') return unsupported('special-color');
      const hival = space.lookup(2);
      if (!(hival instanceof PDFNumber)) return unsupported('corrupt');
      const table = space.lookup(3);
      let lookup: Uint8Array;
      if (table instanceof PDFString || table instanceof PDFHexString) lookup = table.asBytes();
      else if (table instanceof PDFRawStream) {
        try {
          lookup = decodePDFRawStream(table).decode();
        } catch {
          return unsupported('corrupt');
        }
      } else return unsupported('corrupt');
      return { ok: true, model: { kind: 'indexed', base: base.model.kind, hival: Math.max(0, Math.min(255, hival.asNumber())), lookup }, original: raw };
    }
    return unsupported('special-color');
  }
  return unsupported('special-color');
}

/** True when a `/Decode` array is absent or just restates the default mapping — anything
 *  else (an inverted scan is the usual case) would need re-mapping we don't attempt. */
function hasDefaultDecode(dict: PDFDict, model: PixelColorModel, bitsPerComponent: number): boolean {
  const decode = dict.lookup(name('Decode'));
  if (decode === undefined) return true;
  if (!(decode instanceof PDFArray)) return false;
  const expected: number[] = [];
  if (model.kind === 'indexed') expected.push(0, 2 ** bitsPerComponent - 1);
  else for (let i = 0; i < componentsOf(model); i++) expected.push(0, 1);
  if (decode.size() !== expected.length) return false;
  return expected.every((value, i) => {
    const entry = decode.lookup(i);
    return entry instanceof PDFNumber && entry.asNumber() === value;
  });
}

type ImageOutcome =
  | { status: 'replaced'; stream: PDFRawStream; preview: () => Promise<PdfComparePreview>; area: number; grayscaled: boolean }
  | { status: 'unchanged' }
  | { status: 'unsupported'; reason: UnsupportedImageReason };

interface ImageJobContext {
  context: PDFContext;
  options: PdfCompressOptions;
  codec: RasterCodec;
  maxPixels: number | null;
}

/** Decodes a non-JPEG image's stream (any filter chain pdf-lib understands) and undoes its
 *  predictor, returning packed samples or an unsupported reason. */
function decodeRawSamples(stream: PDFRawStream, filters: PDFName[], width: number, height: number, components: number, bitsPerComponent: number): Uint8Array | UnsupportedImageReason {
  let data: Uint8Array;
  try {
    data = filters.length === 0 ? stream.contents : decodePDFRawStream(stream).decode();
  } catch {
    return 'corrupt';
  }

  const parms = lastDecodeParms(stream.dict, filters.length);
  const predictor = parms ? (numberAt(parms, 'Predictor') ?? 1) : 1;
  if (predictor === 1) return data;

  const colors = (parms && numberAt(parms, 'Colors')) ?? components;
  const bpc = (parms && numberAt(parms, 'BitsPerComponent')) ?? bitsPerComponent;
  const columns = (parms && numberAt(parms, 'Columns')) ?? width;
  const rowBytes = packedRowBytes(columns, colors, bpc);

  if (predictor >= 10) {
    const unfiltered = unfilterPngRows(data, rowBytes, Math.max(1, Math.ceil((colors * bpc) / 8)), height);
    return unfiltered ?? 'corrupt';
  }
  if (predictor === 2 && bpc === 8) return undoTiffPredictor(data, rowBytes, colors, height) ?? 'corrupt';
  return 'bit-depth';
}

function copyImageDict(context: PDFContext, original: PDFDict, dropMetadata: boolean): PDFDict {
  const dict = context.obj({});
  for (const [key, value] of original.entries()) {
    const keyName = key.asString().slice(1);
    if (REWRITTEN_IMAGE_KEYS.has(keyName)) continue;
    if (dropMetadata && keyName === 'Metadata') continue;
    dict.set(key, value);
  }
  return dict;
}

async function toPreviewImage(image: RgbaImageData, codec: RasterCodec): Promise<PreviewImage> {
  const target = computeTargetDimensions(image.width, image.height, PREVIEW_MAX_SIDE);
  return { bytes: await codec.encodePng(downscaleRgba(image, target.width, target.height)), mime: 'image/png' };
}

async function recompressImage(job: ImageJobContext, stream: PDFRawStream, isMask: boolean): Promise<ImageOutcome> {
  const { context, options, codec } = job;
  const dict = stream.dict;

  if (dict.lookup(name('ImageMask')) === PDFBool.True) return { status: 'unsupported', reason: 'stencil-mask' };
  if (dict.lookup(name('Mask')) instanceof PDFArray) return { status: 'unsupported', reason: 'color-key-mask' };

  const filters = filterChain(dict);
  if (filters === null) return { status: 'unsupported', reason: 'encoding' };
  const filterNames = filters.map((f) => f.asString());
  if (filterNames.includes('/JPXDecode')) return { status: 'unsupported', reason: 'jpeg2000' };
  if (filterNames.includes('/JBIG2Decode')) return { status: 'unsupported', reason: 'jbig2' };
  if (filterNames.includes('/CCITTFaxDecode')) return { status: 'unsupported', reason: 'ccitt' };
  const isJpeg = filters.length === 1 && filters[0] === DCT;
  if (!isJpeg && filterNames.includes('/DCTDecode')) return { status: 'unsupported', reason: 'encoding' };

  const width = numberAt(dict, 'Width');
  const height = numberAt(dict, 'Height');
  if (!width || !height || width < 1 || height < 1) return { status: 'unsupported', reason: 'corrupt' };

  const color = resolveColorSpace(context, dict.get(name('ColorSpace')), isMask);
  if (!color.ok) return { status: 'unsupported', reason: color.reason };
  const { model } = color;
  // Grayscale is an explicit request to change how the image looks, not just a size
  // optimization, so it's honoured even for tiny images and even when the result isn't
  // smaller — otherwise a colour image would silently survive into a "grayscale" PDF.
  const grayscaled = options.grayscale && !isMask && model.kind !== 'gray';

  if (!grayscaled && stream.contents.length < MIN_IMAGE_STREAM_BYTES) return { status: 'unchanged' };
  if (isJpeg && model.kind === 'indexed') return { status: 'unsupported', reason: 'special-color' };

  const bitsPerComponent = isJpeg ? 8 : (numberAt(dict, 'BitsPerComponent') ?? 8);
  if (!hasDefaultDecode(dict, model, bitsPerComponent)) return { status: 'unsupported', reason: 'decode-array' };

  const target = computeTargetDimensions(width, height, job.maxPixels);

  let pixels: RgbaImageData;
  let beforePreview: () => Promise<PreviewImage>;
  if (isJpeg) {
    try {
      pixels = await codec.decodeJpeg(stream.contents, target.width, target.height);
    } catch {
      return { status: 'unsupported', reason: 'corrupt' };
    }
    const original = stream.contents;
    beforePreview = async () => ({ bytes: original, mime: 'image/jpeg' });
  } else {
    const samples = decodeRawSamples(stream, filters, width, height, componentsOf(model), bitsPerComponent);
    if (typeof samples === 'string') return { status: 'unsupported', reason: samples };
    const unpacked = unpackSamples(samples, width, height, componentsOf(model), bitsPerComponent);
    if (!unpacked) return { status: 'unsupported', reason: [1, 2, 4, 8, 16].includes(bitsPerComponent) ? 'corrupt' : 'bit-depth' };
    const full = samplesToRgba(unpacked.samples, width, height, model, unpacked.maxValue);
    pixels = downscaleRgba(full, target.width, target.height);
    beforePreview = () => toPreviewImage(full, codec);
  }

  if (grayscaled) pixels = rgbaToGrayscale(pixels);

  const outputJpeg = !isMask && (options.imageFormat === 'jpeg' || (options.imageFormat === 'match' && isJpeg));
  const newDict = copyImageDict(context, dict, options.removeMetadata);
  newDict.set(name('Width'), PDFNumber.of(pixels.width));
  newDict.set(name('Height'), PDFNumber.of(pixels.height));
  newDict.set(name('BitsPerComponent'), PDFNumber.of(8));

  // The original colour space object (often an ICC profile) is kept whenever the output
  // still has the same channel layout, so colour management survives re-encoding.
  const keepsRgbSpace = model.kind === 'rgb' && !grayscaled && color.original !== undefined;
  const keepsGraySpace = model.kind === 'gray' && color.original !== undefined;
  const colorSpaceFor = (channels: number): PDFObject =>
    channels === 1 ? (keepsGraySpace && color.original ? color.original : name('DeviceGray')) : keepsRgbSpace && color.original ? color.original : name('DeviceRGB');

  let bytes: Uint8Array;
  let afterPreview: () => Promise<PreviewImage>;
  if (outputJpeg) {
    try {
      bytes = await codec.encodeJpeg(pixels, options.quality);
    } catch {
      return { status: 'unchanged' };
    }
    const channels = jpegComponentCount(bytes);
    if (channels !== 1 && channels !== 3) return { status: 'unchanged' };
    newDict.set(name('Filter'), DCT);
    newDict.set(name('ColorSpace'), colorSpaceFor(channels));
    const encoded = bytes;
    afterPreview = async () => ({ bytes: encoded, mime: 'image/jpeg' });
  } else {
    const encoded = encodeLossless(pixels, isMask || grayscaled);
    bytes = encoded.data;
    newDict.set(name('Filter'), FLATE);
    newDict.set(name('DecodeParms'), context.obj(encoded.decodeParms));
    if (!isMask || dict.has(name('ColorSpace'))) newDict.set(name('ColorSpace'), colorSpaceFor(encoded.channels));
    const finalPixels = pixels;
    afterPreview = () => toPreviewImage(finalPixels, codec);
  }

  if (!grayscaled && bytes.length >= stream.contents.length) return { status: 'unchanged' };

  return {
    status: 'replaced',
    stream: PDFRawStream.of(newDict, bytes),
    area: width * height,
    grayscaled,
    preview: async () => ({
      before: await beforePreview(),
      after: await afterPreview(),
      width: pixels.width,
      height: pixels.height,
      originalWidth: width,
      originalHeight: height,
    }),
  };
}

// Deliberately a plain boolean, not a `object is PDFRawStream` type guard: a guard's false
// branch would narrow "a raw stream that isn't an image" down to `never`.
function isImageStream(object: PDFObject): boolean {
  return object instanceof PDFRawStream && object.dict.lookup(name('Subtype')) === IMAGE;
}

/** Every image referenced as another image's `/SMask` or `/Mask` — these carry
 *  transparency, so they're only ever re-encoded losslessly (JPEG artefacts in an alpha
 *  channel show up as halos around every edge). */
function collectMaskRefs(context: PDFContext): Set<string> {
  const masks = new Set<string>();
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || !isImageStream(object)) continue;
    for (const key of ['SMask', 'Mask']) {
      const value = object.dict.get(name(key));
      if (value instanceof PDFRef) masks.add(value.toString());
    }
  }
  return masks;
}

/** Deflates non-image streams that were stored uncompressed, and re-deflates plain
 *  FlateDecode streams at maximum level — many generators use a fast, low level. */
function recompressOtherStreams(context: PDFContext): number {
  let count = 0;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || isImageStream(object)) continue;
    const type = object.dict.lookup(name('Type'));
    // XMP metadata is meant to stay uncompressed so file indexers can read it as-is.
    if (type === name('Metadata') || type === name('XRef') || type === name('ObjStm')) continue;
    if (object.contents.length < MIN_STREAM_BYTES) continue;

    const filters = filterChain(object.dict);
    let plain: Uint8Array;
    if (filters !== null && filters.length === 0) {
      plain = object.contents;
    } else if (filters !== null && filters.length === 1 && filters[0] === FLATE && object.dict.lookup(name('DecodeParms')) === undefined) {
      try {
        plain = unzlibSync(object.contents);
      } catch {
        continue; // A damaged stream is left exactly as it was, not "repaired" into something else.
      }
    } else continue;

    const recompressed = zlibSync(plain, { level: 9 });
    if (recompressed.length >= object.contents.length) continue;

    const dict = context.obj({});
    for (const [key, value] of object.dict.entries()) {
      const keyName = key.asString();
      if (keyName !== '/Filter' && keyName !== '/DecodeParms' && keyName !== '/Length' && keyName !== '/DL') dict.set(key, value);
    }
    dict.set(name('Filter'), FLATE);
    context.assign(ref, PDFRawStream.of(dict, recompressed));
    count += 1;
  }
  return count;
}

/** FNV-1a, for bucketing streams before the exact byte comparison in `mergeDuplicateStreams`. */
function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Rewrites every reference in the document per `replacements` (keyed by `ref.toString()`). */
function rewriteRefs(context: PDFContext, replacements: Map<string, PDFRef>): void {
  const visit = (object: PDFObject): void => {
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const target = value instanceof PDFRef ? replacements.get(value.toString()) : undefined;
        if (target) object.set(key, target);
        else visit(value);
      }
    } else if (object instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++) {
        const value = object.get(i);
        const target = value instanceof PDFRef ? replacements.get(value.toString()) : undefined;
        if (target) object.set(i, target);
        else visit(value);
      }
    } else if (object instanceof PDFStream) {
      visit(object.dict);
    }
  };
  for (const [, object] of context.enumerateIndirectObjects()) visit(object);
}

/**
 * Collapses byte-identical streams (the same logo embedded separately on every page, a font
 * subset embedded twice by a merge tool) into one shared object. Compares the dictionary as
 * well as the bytes, so two streams only merge if they're genuinely interchangeable.
 */
function mergeDuplicateStreams(context: PDFContext): number {
  const buckets = new Map<string, { ref: PDFRef; stream: PDFRawStream }[]>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.contents.length < MIN_STREAM_BYTES) continue;
    const key = `${object.contents.length}:${fnv1a(object.contents)}:${object.dict.toString()}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ ref, stream: object });
    else buckets.set(key, [{ ref, stream: object }]);
  }

  const replacements = new Map<string, PDFRef>();
  for (const bucket of buckets.values()) {
    const [canonical, ...rest] = bucket;
    for (const candidate of rest) {
      if (bytesEqual(canonical.stream.contents, candidate.stream.contents)) replacements.set(candidate.ref.toString(), canonical.ref);
    }
  }
  if (replacements.size === 0) return 0;

  rewriteRefs(context, replacements);
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (replacements.has(ref.toString())) context.delete(ref);
  }
  return replacements.size;
}

/**
 * Deletes every object no longer reachable from the trailer — superseded versions left
 * behind by incremental saves, the XMP/thumbnail streams just detached, duplicates just
 * merged, and old image streams just replaced. A valid PDF reaches everything it renders
 * from `/Root` (or `/Info`), so this can never drop visible content.
 */
function removeUnreachableObjects(context: PDFContext): number {
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const entry of [Root, Info, Encrypt]) if (entry) stack.push(entry);

  while (stack.length > 0) {
    const object = stack.pop();
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) {
      stack.push(...object.values());
    } else if (object instanceof PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref);
      removed += 1;
    }
  }
  return removed;
}

/** Strips the Info dictionary, every XMP `/Metadata` stream and editor-private `/PieceInfo`. */
function removeMetadata(context: PDFContext): boolean {
  let removed = context.trailerInfo.Info !== undefined;
  context.trailerInfo.Info = undefined;
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : null;
    if (!dict) continue;
    if (dict.delete(name('Metadata'))) removed = true;
    if (dict.delete(name('PieceInfo'))) removed = true;
  }
  return removed;
}

const ENCRYPTED_MESSAGE =
  'This PDF is encrypted (it has a password or permission restrictions), and an encrypted PDF can’t be rewritten in the browser. Open it in a PDF viewer, “Print to PDF” to save an unprotected copy, and compress that instead.';
const UNREADABLE_MESSAGE = 'This file couldn’t be read as a PDF — it may be damaged or truncated. Try re-exporting it from the app that created it.';

/**
 * Compresses a PDF. Never makes it bigger: if the rewritten file isn't smaller, the original
 * bytes come back with `report.keptOriginal` set, so the UI can say so honestly instead of
 * offering a "compressed" file that's actually larger. The one exception is grayscale: once
 * an image has been converted, the converted file is returned whatever its size.
 */
export async function compressPdf(input: Uint8Array, options: PdfCompressOptions, codec: RasterCodec): Promise<ToolResult<PdfCompressOutput>> {
  if (!looksLikePdf(input)) {
    return err('This file doesn’t start with a PDF header, so it isn’t a PDF — it may be a different file type renamed to .pdf.');
  }

  let doc: PDFDocument;
  try {
    // Encryption is checked via `isEncrypted` below rather than by catching pdf-lib's
    // `EncryptedPDFError`: pdf-lib is compiled to ES5, where `instanceof` on an Error
    // subclass is always false, so that error can't be told apart from any other.
    doc = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: true });
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
  if (doc.isEncrypted) return err(ENCRYPTED_MESSAGE);
  const { context } = doc;

  let pageCount: number;
  let largestSide = 0;
  try {
    const pages = doc.getPages();
    pageCount = pages.length;
    for (const page of pages) {
      const { width, height } = page.getSize();
      largestSide = Math.max(largestSide, Math.abs(width), Math.abs(height));
    }
  } catch {
    return err('This PDF’s page structure is damaged, so it can’t be safely rewritten. Try re-exporting it from the app that created it.');
  }

  const job: ImageJobContext = { context, options, codec, maxPixels: maxImagePixels(options.maxDpi, largestSide) };
  const maskRefs = collectMaskRefs(context);
  const report: PdfCompressReport = {
    pageCount,
    originalBytes: input.length,
    outputBytes: input.length,
    keptOriginal: false,
    images: { total: 0, recompressed: 0, unchanged: 0, unsupported: 0 },
    unsupportedReasons: [],
    streamsRecompressed: 0,
    duplicatesMerged: 0,
    unusedObjectsRemoved: 0,
    metadataRemoved: false,
    thumbnailsRemoved: 0,
  };

  // Thumbnails go first, so their image streams are never pointlessly re-encoded below.
  if (options.removeThumbnails) {
    for (const page of doc.getPages()) {
      if (page.node.delete(name('Thumb'))) report.thumbnailsRemoved += 1;
    }
  }
  if (options.removeMetadata) report.metadataRemoved = removeMetadata(context);
  // Drop what's already unreachable before the expensive image pass, so orphaned images
  // (old revisions, the thumbnails just detached) aren't decoded and re-encoded for nothing.
  report.unusedObjectsRemoved += removeUnreachableObjects(context);

  let best: { area: number; preview: () => Promise<PdfComparePreview> } | null = null;
  const reasons = new Set<UnsupportedImageReason>();
  let grayscaledImages = 0;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || !isImageStream(object)) continue;
    report.images.total += 1;
    const isMask = maskRefs.has(ref.toString());
    const outcome = await recompressImage(job, object, isMask);
    if (outcome.status === 'replaced') {
      context.assign(ref, outcome.stream);
      report.images.recompressed += 1;
      if (outcome.grayscaled) grayscaledImages += 1;
      if (!isMask && (!best || outcome.area > best.area)) best = { area: outcome.area, preview: outcome.preview };
    } else if (outcome.status === 'unchanged') {
      report.images.unchanged += 1;
    } else {
      report.images.unsupported += 1;
      reasons.add(outcome.reason);
    }
  }
  report.unsupportedReasons = [...reasons];

  report.streamsRecompressed = recompressOtherStreams(context);
  report.duplicatesMerged = mergeDuplicateStreams(context);
  report.unusedObjectsRemoved += removeUnreachableObjects(context);

  let output: Uint8Array;
  try {
    output = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  } catch {
    return err('Compression failed while writing the new PDF — the file may use a structure this tool can’t rewrite. The original is unchanged.');
  }

  let preview: PdfComparePreview | null = null;
  if (best) {
    try {
      preview = await best.preview();
    } catch {
      preview = null; // The preview is a convenience; failing to build it must not fail the compression.
    }
  }

  // A grayscale conversion changed what the document looks like, so handing back the colour
  // original would ignore the request; the UI shows the size increase honestly instead.
  if (output.length >= input.length && grayscaledImages === 0) {
    return ok({ bytes: input, report: { ...report, outputBytes: input.length, keptOriginal: true }, preview: null });
  }
  return ok({ bytes: output, report: { ...report, outputBytes: output.length }, preview });
}

/**
 * Builds the "Load example" document: a one-page report with a headline, body text and a
 * large, high-quality photo — the shape of PDF people most often need to shrink. Saved
 * without object streams, like many real-world generators, so the structural passes have
 * something to find too.
 */
export async function buildSamplePdf(photoJpeg: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Site inspection report (sample)');
  doc.setAuthor('DevMicroTools sample generator');
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  page.drawText('Site inspection report', { x: 54, y: 726, size: 24, font: bold, color: rgb(0.1, 0.12, 0.16) });
  const lines = [
    'This sample PDF contains selectable text plus one large, high-quality photo,',
    'which is where almost all of a typical document’s file size comes from.',
    'Compressing it re-encodes the photo and leaves this text exactly as it is.',
  ];
  lines.forEach((line, i) => page.drawText(line, { x: 54, y: 690 - i * 18, size: 12, font: regular, color: rgb(0.25, 0.28, 0.33) }));

  const photo = await doc.embedJpg(photoJpeg);
  const drawWidth = 504;
  const drawHeight = (drawWidth * photo.height) / photo.width;
  page.drawImage(photo, { x: 54, y: 620 - drawHeight, width: drawWidth, height: drawHeight });

  return doc.save({ useObjectStreams: false });
}
