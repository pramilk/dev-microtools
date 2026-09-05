import { applySentenceCase, classifyWithTransformer, type SentenceCaseResult } from '../lib/tools/sentenceCase';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Runs off the main thread for the same reason Background Remover's model does: the
 * transformer NER pass is a multi-second, CPU-bound WASM computation the first time it
 * loads, and blocking the UI thread for that would freeze the whole page (including the
 * textarea the user is still typing in).
 */
export interface SentenceCaseWorkerRequest {
  text: string;
}

export type SentenceCaseWorkerResult = SentenceCaseResult;

export async function handleSentenceCaseRequest(request: SentenceCaseWorkerRequest): Promise<SentenceCaseWorkerResult> {
  return applySentenceCase(request.text, classifyWithTransformer);
}

declare const self: WorkerScope<SentenceCaseWorkerRequest, SentenceCaseWorkerResult>;
listenForRequests(self, handleSentenceCaseRequest);
