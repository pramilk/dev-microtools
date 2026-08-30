import { compareTexts, compareJson, type DiffMode, type DiffSummary } from '../lib/tools/diff';
import { listenForRequests, type WorkerScope } from './workerGlue';

export type DiffWorkerRequest =
  | { kind: 'text'; left: string; right: string; mode: DiffMode; ignoreCase: boolean; ignoreWhitespace: boolean }
  | { kind: 'json'; left: string; right: string };

export async function handleDiffRequest(request: DiffWorkerRequest): Promise<DiffSummary> {
  const result =
    request.kind === 'json'
      ? await compareJson(request.left, request.right)
      : await compareTexts(request.left, request.right, request.mode, {
          ignoreCase: request.ignoreCase,
          ignoreWhitespace: request.ignoreWhitespace,
        });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

declare const self: WorkerScope<DiffWorkerRequest, DiffSummary>;
listenForRequests(self, handleDiffRequest);
