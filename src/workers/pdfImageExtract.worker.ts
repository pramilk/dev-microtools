import { buildSamplePdf, extractPdfImages, type ImageExtractCodec, type PdfImageExtractOutput } from '../lib/tools/pdfImageExtractEngine';
import { offscreenCanvasCodec, samplePhotoJpeg } from './canvasCodec';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * The PDF Image Extractor pipeline runs here, off the main thread: parsing a large PDF and
 * decoding hundreds of images can take seconds, which on the main thread would freeze the
 * page (an INP failure). Created on first use, so pdf-lib is never part of any page load.
 */
export type PdfImageExtractWorkerRequest = { kind: 'extract'; bytes: Uint8Array } | { kind: 'sample' };

export type PdfImageExtractWorkerResult =
  | { kind: 'extract'; ok: true; output: PdfImageExtractOutput }
  | { kind: 'extract'; ok: false; error: string }
  | { kind: 'sample'; bytes: Uint8Array };

export async function handlePdfImageExtractRequest(request: PdfImageExtractWorkerRequest, codec: ImageExtractCodec = offscreenCanvasCodec): Promise<PdfImageExtractWorkerResult> {
  if (request.kind === 'sample') {
    return { kind: 'sample', bytes: await buildSamplePdf(await samplePhotoJpeg(1200, 800)) };
  }
  const result = await extractPdfImages(request.bytes, codec);
  return result.ok ? { kind: 'extract', ok: true, output: result.value } : { kind: 'extract', ok: false, error: result.error };
}

declare const self: WorkerScope<PdfImageExtractWorkerRequest, PdfImageExtractWorkerResult>;
listenForRequests(self, (request) => handlePdfImageExtractRequest(request));
