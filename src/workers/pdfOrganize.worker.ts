import type { PdfSourceInfo } from '../lib/tools/pdfMerge';
import type { OrganizePlan } from '../lib/tools/pdfOrganize';
import { inspectPdf } from '../lib/tools/pdfMergeEngine';
import { buildSamplePdf, organizePdf, type OrganizeInput, type OrganizeOutput } from '../lib/tools/pdfOrganizeEngine';
import type { RasterCodec } from '../lib/tools/pdfCompressEngine';
import { listenForRequests, type WorkerScope } from './workerGlue';
import { offscreenCanvasCodec } from './canvasCodec';

/**
 * Organize PDF's pdf-lib work runs here, off the main thread: rewriting a long document — and
 * compressing it, when that's on — can take seconds, which on the main thread would freeze the
 * page (an INP failure). The worker is only created when the first file is chosen, so pdf-lib
 * is never part of any page load.
 *
 * Stateless by design, like the Merge and Split PDF workers: every organize request carries
 * the file's bytes, so a crashed or recycled worker loses nothing.
 */
export type PdfOrganizeWorkerRequest = { kind: 'inspect'; bytes: Uint8Array } | ({ kind: 'organize'; plan: OrganizePlan } & OrganizeInput) | { kind: 'sample' };

export type PdfOrganizeWorkerResult =
  | { kind: 'inspect'; ok: true; info: PdfSourceInfo }
  | { kind: 'inspect'; ok: false; error: string }
  | { kind: 'organize'; ok: true; output: OrganizeOutput }
  | { kind: 'organize'; ok: false; error: string }
  | { kind: 'sample'; bytes: Uint8Array };

export async function handlePdfOrganizeRequest(request: PdfOrganizeWorkerRequest, codec: RasterCodec = offscreenCanvasCodec): Promise<PdfOrganizeWorkerResult> {
  switch (request.kind) {
    case 'inspect': {
      const result = await inspectPdf(request.bytes);
      return result.ok ? { kind: 'inspect', ok: true, info: result.value } : { kind: 'inspect', ok: false, error: result.error };
    }
    case 'organize': {
      const result = await organizePdf({ files: request.files, backgroundImage: request.backgroundImage }, request.plan, codec);
      return result.ok ? { kind: 'organize', ok: true, output: result.value } : { kind: 'organize', ok: false, error: result.error };
    }
    case 'sample':
      return { kind: 'sample', bytes: await buildSamplePdf() };
  }
}

declare const self: WorkerScope<PdfOrganizeWorkerRequest, PdfOrganizeWorkerResult>;
listenForRequests(self, (request) => handlePdfOrganizeRequest(request));
