import type { PdfCompressOptions } from '../lib/tools/pdfCompress';
import { buildSamplePdf, compressPdf, type PdfCompressOutput, type RasterCodec } from '../lib/tools/pdfCompressEngine';
import { listenForRequests, type WorkerScope } from './workerGlue';
import { offscreenCanvasCodec, samplePhotoJpeg } from './canvasCodec';

/**
 * The whole PDF Compressor pipeline runs here, off the main thread: pdf-lib parsing, image
 * decode/resample/encode and the final save can take seconds on a large scan, and doing
 * that on the main thread would freeze the page (an INP failure). This worker is only
 * created on the first compression, so pdf-lib is never part of any page load.
 */
export type PdfCompressWorkerRequest =
  | { kind: 'compress'; bytes: Uint8Array; options: PdfCompressOptions }
  | { kind: 'sample' };

export type PdfCompressWorkerResult =
  | { kind: 'compress'; ok: true; output: PdfCompressOutput }
  | { kind: 'compress'; ok: false; error: string }
  | { kind: 'sample'; bytes: Uint8Array };

export async function handlePdfCompressRequest(request: PdfCompressWorkerRequest, codec: RasterCodec = offscreenCanvasCodec): Promise<PdfCompressWorkerResult> {
  if (request.kind === 'sample') {
    return { kind: 'sample', bytes: await buildSamplePdf(await samplePhotoJpeg()) };
  }
  const result = await compressPdf(request.bytes, request.options, codec);
  return result.ok ? { kind: 'compress', ok: true, output: result.value } : { kind: 'compress', ok: false, error: result.error };
}

declare const self: WorkerScope<PdfCompressWorkerRequest, PdfCompressWorkerResult>;
listenForRequests(self, (request) => handlePdfCompressRequest(request));
