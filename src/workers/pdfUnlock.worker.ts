import type { PdfUnlockOptions, PdfUnlockOutput, PdfUnlockSourceInfo } from '../lib/tools/pdfUnlock';
import { buildSamplePdf, inspectUnlockSource, unlockPdf } from '../lib/tools/pdfUnlockEngine';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Unlock PDF's pdf-lib and cipher work runs here, off the main thread: decrypting a large PDF
 * takes seconds, which on the main thread would freeze the page (an INP failure). The worker
 * is only created when the first file is chosen, so neither library is part of any page load.
 * The password travels to this worker in a message and nowhere else.
 *
 * Stateless, like the Protect PDF worker: every request carries the file's bytes, so the
 * handler is a pure function its unit test can call directly.
 */
export type PdfUnlockWorkerRequest =
  | { kind: 'inspect'; bytes: Uint8Array }
  | { kind: 'unlock'; bytes: Uint8Array; options: PdfUnlockOptions }
  | { kind: 'sample' };

export type PdfUnlockWorkerResult =
  | { kind: 'inspect'; ok: true; info: PdfUnlockSourceInfo }
  | { kind: 'inspect'; ok: false; error: string }
  | { kind: 'unlock'; ok: true; output: PdfUnlockOutput }
  | { kind: 'unlock'; ok: false; error: string }
  | { kind: 'sample'; bytes: Uint8Array };

export async function handlePdfUnlockRequest(request: PdfUnlockWorkerRequest): Promise<PdfUnlockWorkerResult> {
  switch (request.kind) {
    case 'inspect': {
      const result = await inspectUnlockSource(request.bytes);
      return result.ok ? { kind: 'inspect', ok: true, info: result.value } : { kind: 'inspect', ok: false, error: result.error };
    }
    case 'unlock': {
      const result = await unlockPdf(request.bytes, request.options);
      return result.ok ? { kind: 'unlock', ok: true, output: result.value } : { kind: 'unlock', ok: false, error: result.error };
    }
    case 'sample':
      return { kind: 'sample', bytes: await buildSamplePdf() };
  }
}

declare const self: WorkerScope<PdfUnlockWorkerRequest, PdfUnlockWorkerResult>;
listenForRequests(self, handlePdfUnlockRequest);
