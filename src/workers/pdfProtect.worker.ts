import type { PdfProtectOptions, PdfProtectOutput, PdfProtectSourceInfo } from '../lib/tools/pdfProtect';
import { buildSamplePdf, inspectProtectSource, protectPdf } from '../lib/tools/pdfProtectEngine';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Protect PDF's pdf-lib and cipher work runs here, off the main thread: encrypting a large
 * PDF takes seconds, which on the main thread would freeze the page (an INP failure). The
 * worker is only created when the first file is chosen, so neither library is part of any
 * page load. The passwords travel to this worker in a message and nowhere else.
 *
 * Stateless, like the Split PDF worker: every request carries the file's bytes, so the
 * handler is a pure function its unit test can call directly.
 */
export type PdfProtectWorkerRequest =
  | { kind: 'inspect'; bytes: Uint8Array }
  | { kind: 'protect'; bytes: Uint8Array; options: PdfProtectOptions }
  | { kind: 'sample' };

export type PdfProtectWorkerResult =
  | { kind: 'inspect'; ok: true; info: PdfProtectSourceInfo }
  | { kind: 'inspect'; ok: false; error: string }
  | { kind: 'protect'; ok: true; output: PdfProtectOutput }
  | { kind: 'protect'; ok: false; error: string }
  | { kind: 'sample'; bytes: Uint8Array };

export async function handlePdfProtectRequest(request: PdfProtectWorkerRequest): Promise<PdfProtectWorkerResult> {
  switch (request.kind) {
    case 'inspect': {
      const result = await inspectProtectSource(request.bytes);
      return result.ok ? { kind: 'inspect', ok: true, info: result.value } : { kind: 'inspect', ok: false, error: result.error };
    }
    case 'protect': {
      const result = await protectPdf(request.bytes, request.options);
      return result.ok ? { kind: 'protect', ok: true, output: result.value } : { kind: 'protect', ok: false, error: result.error };
    }
    case 'sample':
      return { kind: 'sample', bytes: await buildSamplePdf() };
  }
}

declare const self: WorkerScope<PdfProtectWorkerRequest, PdfProtectWorkerResult>;
listenForRequests(self, handlePdfProtectRequest);
