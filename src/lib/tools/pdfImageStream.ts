import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, decodePDFRawStream, type PDFContext, type PDFObject } from 'pdf-lib';
import { componentsOf, packedRowBytes, undoTiffPredictor, unfilterPngRows, type PixelColorModel } from './pdfImagePixels';

/**
 * Reading image XObjects out of a pdf-lib object graph — the parts every PDF image tool
 * needs (PDF Compressor re-encodes them, PDF Image Extractor saves them out): the filter
 * chain, the colour space, the `/Decode` mapping, and the decoded, un-predicted sample
 * bytes. Worker-only, like everything else that imports pdf-lib.
 */

const name = (value: string): PDFName => PDFName.of(value);

const IMAGE = name('Image');

export function numberAt(dict: PDFDict, key: string): number | undefined {
  const value = dict.lookup(name(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

// Deliberately a plain boolean, not a `object is PDFRawStream` type guard: a guard's false
// branch would narrow "a raw stream that isn't an image" down to `never`.
export function isImageStream(object: PDFObject | undefined): boolean {
  return object instanceof PDFRawStream && object.dict.lookup(name('Subtype')) === IMAGE;
}

/** The stream's filter chain as names, or null if `/Filter` is something unexpected. */
export function filterChain(dict: PDFDict): PDFName[] | null {
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

/** Why a colour space can't be turned into pixels. */
export type ColorSpaceProblem = 'encoding' | 'special-color' | 'corrupt';

export type ColorResolution =
  | { ok: true; model: PixelColorModel; original: PDFObject | undefined }
  | { ok: false; reason: ColorSpaceProblem };

function unsupported(reason: ColorSpaceProblem): { ok: false; reason: ColorSpaceProblem } {
  return { ok: false, reason };
}

/** Maps an image's `/ColorSpace` to a pixel colour model. CMYK resolves (to `cmyk`, or an
 *  indexed palette on a CMYK base) — whether a tool can handle it is that tool's call. */
export function resolveColorSpace(context: PDFContext, raw: PDFObject | undefined, isMask: boolean): ColorResolution {
  // A soft mask's colour space is DeviceGray by definition, even when (as is common) the
  // entry is omitted.
  if (raw === undefined) return isMask ? { ok: true, model: { kind: 'gray' }, original: undefined } : unsupported('encoding');
  const space = raw instanceof PDFRef ? context.lookup(raw) : raw;

  if (space instanceof PDFName) {
    const value = space.asString();
    if (value === '/DeviceGray' || value === '/CalGray') return { ok: true, model: { kind: 'gray' }, original: raw };
    if (value === '/DeviceRGB' || value === '/CalRGB') return { ok: true, model: { kind: 'rgb' }, original: raw };
    if (value === '/DeviceCMYK') return { ok: true, model: { kind: 'cmyk' }, original: raw };
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
      if (components === 4) return { ok: true, model: { kind: 'cmyk' }, original: raw };
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

/** The `/Decode` array as numbers, when it's well-formed with exactly `2 × components`
 *  entries; undefined when absent, null when present but malformed. */
export function readDecodeArray(dict: PDFDict, components: number): number[] | null | undefined {
  const decode = dict.lookup(name('Decode'));
  if (decode === undefined) return undefined;
  if (!(decode instanceof PDFArray) || decode.size() !== components * 2) return null;
  const values: number[] = [];
  for (let i = 0; i < decode.size(); i++) {
    const entry = decode.lookup(i);
    if (!(entry instanceof PDFNumber)) return null;
    values.push(entry.asNumber());
  }
  return values;
}

/** True when a `/Decode` array is absent or just restates the default mapping — anything
 *  else (an inverted scan is the usual case) needs re-mapping. */
export function hasDefaultDecode(dict: PDFDict, model: PixelColorModel, bitsPerComponent: number): boolean {
  if (dict.lookup(name('Decode')) === undefined) return true;
  const expected: number[] = [];
  if (model.kind === 'indexed') expected.push(0, 2 ** bitsPerComponent - 1);
  else for (let i = 0; i < componentsOf(model); i++) expected.push(0, 1);
  const actual = readDecodeArray(dict, expected.length / 2);
  return Array.isArray(actual) && expected.every((value, i) => actual[i] === value);
}

/** Decodes a non-JPEG image's stream (any filter chain pdf-lib understands) and undoes its
 *  predictor, returning packed samples or why that wasn't possible. */
export function decodeRawSamples(
  stream: PDFRawStream,
  filters: PDFName[],
  width: number,
  height: number,
  components: number,
  bitsPerComponent: number
): Uint8Array | 'corrupt' | 'bit-depth' {
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

/** FNV-1a, for bucketing streams before an exact byte comparison. */
export function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
