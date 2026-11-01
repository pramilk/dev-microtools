import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, type PDFRef } from 'pdf-lib';
import { type ToolResult, ok, err } from './result';
import type { RgbaImageData } from './imageCompress';
import { hasTransparency } from './pdfImagePixels';
import { registerWithAlpha } from './pdfImageStream';
import { drawMatrix, layoutPage, readExifOrientation, swapsAxes, type ExifOrientation, type ImageToPdfOptions, type ImageToPdfReport, type Rotation } from './imageToPdf';

/**
 * Image to PDF's pipeline: one page per image, in order. Imported only by
 * `workers/imageToPdf.worker.ts`, so pdf-lib never lands in any page's bundle.
 *
 * - JPEG is embedded byte-for-byte — PDF stores JPEG natively, so there's no re-encoding
 *   and no quality loss. Its EXIF orientation is applied through the page's drawing matrix,
 *   since PDF viewers ignore EXIF.
 * - PNG is stored losslessly (Flate with PNG row filters), with a soft mask for alpha.
 * - Everything else the browser can decode (WebP, AVIF, GIF, BMP…) is stored losslessly if it
 *   has transparency, or as a 92% JPEG if it doesn't — those formats are almost always
 *   already-lossy photos, and storing them as raw pixels would multiply the file size.
 */

/** The browser-only half, injected so this module stays DOM-free and unit-testable. */
export interface ImageDecodeCodec {
  /** Decodes any image the browser supports to RGBA, with EXIF orientation already applied. */
  decodeImage: (bytes: Uint8Array) => Promise<RgbaImageData>;
  encodeJpeg: (image: RgbaImageData, quality: number) => Promise<Uint8Array>;
}

export interface ImageSourceInput {
  name: string;
  bytes: Uint8Array;
  rotation: Rotation;
}

export interface ImageToPdfOutput {
  bytes: Uint8Array;
  report: ImageToPdfReport;
}

/** Visually lossless for photos, and still far smaller than raw pixels. */
const CONVERTED_JPEG_QUALITY = 0.92;

const isJpeg = (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const isPng = (bytes: Uint8Array) => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

interface EmbeddedImage {
  ref: PDFRef;
  /** Stored pixel size, before any orientation is applied. */
  width: number;
  height: number;
  orientation: ExifOrientation;
  storage: 'as-is' | 'lossless' | 'jpeg';
}

/** Why the browser couldn't decode a file, phrased with what to do about it. */
function undecodableMessage(name: string): string {
  if (/\.(heic|heif)$/i.test(name)) {
    return 'HEIC/HEIF photos can only be decoded by Safari. Convert it to JPG first, or on an iPhone set Settings › Camera › Formats › Most Compatible.';
  }
  if (/\.tiff?$/i.test(name)) return 'TIFF images can only be decoded by Safari — convert it to PNG or JPG first.';
  return 'This image couldn’t be decoded — it may be damaged, or in a format this browser can’t read.';
}

async function embedImage(doc: PDFDocument, source: ImageSourceInput, codec: ImageDecodeCodec): Promise<EmbeddedImage | string> {
  if (isJpeg(source.bytes)) {
    try {
      const image = await doc.embedJpg(source.bytes);
      return { ref: image.ref, width: image.width, height: image.height, orientation: readExifOrientation(source.bytes), storage: 'as-is' };
    } catch {
      return 'This JPEG is damaged or truncated, so it can’t be placed in a PDF. Try re-saving it from an image editor.';
    }
  }

  let pixels: RgbaImageData;
  try {
    pixels = await codec.decodeImage(source.bytes);
  } catch {
    return undecodableMessage(source.name);
  }
  if (pixels.width < 1 || pixels.height < 1) return undecodableMessage(source.name);

  // Decoding already applied any EXIF orientation, so these are stored upright.
  const lossless = (): EmbeddedImage => ({ ref: registerWithAlpha(doc.context, pixels), width: pixels.width, height: pixels.height, orientation: 1, storage: 'lossless' });
  if (isPng(source.bytes) || hasTransparency(pixels)) return lossless();
  try {
    const jpeg = await doc.embedJpg(await codec.encodeJpeg(pixels, CONVERTED_JPEG_QUALITY));
    return { ref: jpeg.ref, width: jpeg.width, height: jpeg.height, orientation: 1, storage: 'jpeg' };
  } catch {
    return lossless();
  }
}

/**
 * Builds the PDF. An image that can't be read is skipped and reported (so one HEIC in a batch
 * of fifty doesn't cost the visitor the other forty-nine); the whole request only fails when
 * no image at all could be placed.
 */
export async function imagesToPdf(sources: ImageSourceInput[], options: ImageToPdfOptions, codec: ImageDecodeCodec): Promise<ToolResult<ImageToPdfOutput>> {
  if (sources.length === 0) return err('Add at least one image to make a PDF.');

  const doc = await PDFDocument.create();
  const report: ImageToPdfReport = { pageCount: 0, embeddedAsIs: 0, lossless: 0, convertedToJpeg: 0, autoRotated: 0, failed: [] };

  for (const [index, source] of sources.entries()) {
    const embedded = await embedImage(doc, source, codec);
    if (typeof embedded === 'string') {
      report.failed.push({ index, name: source.name, error: embedded });
      continue;
    }

    const swapped = swapsAxes(embedded.orientation, source.rotation);
    const layout = layoutPage(swapped ? embedded.height : embedded.width, swapped ? embedded.width : embedded.height, options);
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    const key = page.node.newXObject('Im', embedded.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...drawMatrix(embedded.orientation, source.rotation, layout.box)), drawObject(key), popGraphicsState());

    report.pageCount += 1;
    if (embedded.storage === 'as-is') report.embeddedAsIs += 1;
    else if (embedded.storage === 'lossless') report.lossless += 1;
    else report.convertedToJpeg += 1;
    if (embedded.orientation !== 1) report.autoRotated += 1;
  }

  if (report.pageCount === 0) {
    const [first] = report.failed;
    return err(sources.length === 1 && first ? first.error : `None of the ${sources.length} images could be read. ${first ? `First problem: ${first.error}` : ''}`.trim());
  }

  try {
    return ok({ bytes: await doc.save({ useObjectStreams: true }), report });
  } catch {
    return err('Writing the PDF failed unexpectedly. Try again with fewer or smaller images.');
  }
}
