import { removeBackgroundFromImage } from '../lib/tools/backgroundRemove';
import type { RgbaImageData } from '../lib/tools/imageCompress';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Inference runs off the main thread since a single u2netp pass is a multi-second, CPU-bound
 * WASM computation — the same reason the Regex Tester and Bcrypt run in a worker, just with a
 * much heavier one-time cost (loading the WASM runtime + model) on top.
 */
export interface BackgroundRemoveWorkerRequest {
  image: RgbaImageData;
}

export type BackgroundRemoveWorkerResult = RgbaImageData;

export async function handleBackgroundRemoveRequest(request: BackgroundRemoveWorkerRequest): Promise<BackgroundRemoveWorkerResult> {
  return removeBackgroundFromImage(request.image);
}

declare const self: WorkerScope<BackgroundRemoveWorkerRequest, BackgroundRemoveWorkerResult>;
listenForRequests(self, handleBackgroundRemoveRequest);
