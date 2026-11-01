import type { PdfMergeOptions, PdfSourceInfo } from '../lib/tools/pdfMerge';
import { buildSamplePdfs, inspectPdf, mergePdfs, type MergeSourceInput, type PdfMergeOutput } from '../lib/tools/pdfMergeEngine';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Merge PDF's pdf-lib work runs here, off the main thread: parsing a few large PDFs and
 * writing the merged one can take seconds, which on the main thread would freeze the page
 * (an INP failure). The worker is only created when the first file is added, so pdf-lib is
 * never part of any page load.
 *
 * Stateless by design: every merge request carries the files' bytes (transferred, not
 * copied), so a crashed or recycled worker loses nothing and the handler stays a pure
 * function its unit test can call directly.
 */
export type PdfMergeWorkerRequest =
  | { kind: 'inspect'; bytes: Uint8Array }
  | { kind: 'merge'; sources: MergeSourceInput[]; options: PdfMergeOptions }
  | { kind: 'samples' };

export type PdfMergeWorkerResult =
  | { kind: 'inspect'; ok: true; info: PdfSourceInfo }
  | { kind: 'inspect'; ok: false; error: string }
  | { kind: 'merge'; ok: true; output: PdfMergeOutput }
  | { kind: 'merge'; ok: false; error: string }
  | { kind: 'samples'; files: { name: string; bytes: Uint8Array }[] };

export async function handlePdfMergeRequest(request: PdfMergeWorkerRequest): Promise<PdfMergeWorkerResult> {
  switch (request.kind) {
    case 'inspect': {
      const result = await inspectPdf(request.bytes);
      return result.ok ? { kind: 'inspect', ok: true, info: result.value } : { kind: 'inspect', ok: false, error: result.error };
    }
    case 'merge': {
      const result = await mergePdfs(request.sources, request.options);
      return result.ok ? { kind: 'merge', ok: true, output: result.value } : { kind: 'merge', ok: false, error: result.error };
    }
    case 'samples':
      return { kind: 'samples', files: await buildSamplePdfs() };
  }
}

declare const self: WorkerScope<PdfMergeWorkerRequest, PdfMergeWorkerResult>;
listenForRequests(self, handlePdfMergeRequest);
