import { minifyCode, type MinifyLanguage } from '../lib/tools/minifier';
import { listenForRequests, type WorkerScope } from './workerGlue';

export interface MinifierWorkerRequest {
  input: string;
  language: MinifyLanguage;
}

/**
 * CSS and HTML minification are hand-rolled synchronous scans, not just the Terser (JS)
 * path — `minifier.ts`'s own comment notes all three "run on the main thread with no way
 * to show progress" today. Routing every language through the same worker, rather than
 * only JS, keeps the tool's behavior uniform regardless of which is picked.
 */
export async function handleMinifierRequest(request: MinifierWorkerRequest): Promise<string> {
  const result = await minifyCode(request.input, request.language);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

declare const self: WorkerScope<MinifierWorkerRequest, string>;
listenForRequests(self, handleMinifierRequest);
