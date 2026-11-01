import type { PdfSplitOptions, PdfSplitSourceInfo, SplitPlan } from '../lib/tools/pdfSplit';
import { buildSamplePdf, inspectSplitSource, splitPdf, type PdfSplitOutput } from '../lib/tools/pdfSplitEngine';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Split PDF's pdf-lib work runs here, off the main thread: writing hundreds of parts from a
 * large PDF can take seconds, which on the main thread would freeze the page (an INP
 * failure). The worker is only created when the first file is chosen, so pdf-lib is never
 * part of any page load.
 *
 * Stateless by design, like the Merge PDF worker: every split request carries the file's
 * bytes, so a crashed or recycled worker loses nothing and the handler stays a pure function
 * its unit test can call directly.
 */
export type PdfSplitWorkerRequest =
  | { kind: 'inspect'; bytes: Uint8Array }
  | { kind: 'split'; bytes: Uint8Array; plan: SplitPlan; options: PdfSplitOptions }
  | { kind: 'sample' };

export type PdfSplitWorkerResult =
  | { kind: 'inspect'; ok: true; info: PdfSplitSourceInfo }
  | { kind: 'inspect'; ok: false; error: string }
  | { kind: 'split'; ok: true; output: PdfSplitOutput }
  | { kind: 'split'; ok: false; error: string }
  | { kind: 'sample'; bytes: Uint8Array };

export async function handlePdfSplitRequest(request: PdfSplitWorkerRequest): Promise<PdfSplitWorkerResult> {
  switch (request.kind) {
    case 'inspect': {
      const result = await inspectSplitSource(request.bytes);
      return result.ok ? { kind: 'inspect', ok: true, info: result.value } : { kind: 'inspect', ok: false, error: result.error };
    }
    case 'split': {
      const result = await splitPdf(request.bytes, request.plan, request.options);
      return result.ok ? { kind: 'split', ok: true, output: result.value } : { kind: 'split', ok: false, error: result.error };
    }
    case 'sample':
      return { kind: 'sample', bytes: await buildSamplePdf() };
  }
}

declare const self: WorkerScope<PdfSplitWorkerRequest, PdfSplitWorkerResult>;
listenForRequests(self, handlePdfSplitRequest);
