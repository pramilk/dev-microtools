import { detectFaceRegions, type RedactRegion } from '../lib/tools/imageRedact';
import type { RgbaImageData } from '../lib/tools/imageCompress';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Inference runs off the main thread since a single UltraFace pass is a CPU-bound WASM
 * computation — same reasoning as `backgroundRemove.worker.ts`, just with a much smaller
 * one-time model download (~1.2 MB vs. u2netp's 4.6 MB).
 */
export interface ImageRedactDetectWorkerRequest {
  image: RgbaImageData;
}

export type ImageRedactDetectWorkerResult = RedactRegion[];

export async function handleImageRedactDetectRequest(request: ImageRedactDetectWorkerRequest): Promise<ImageRedactDetectWorkerResult> {
  return detectFaceRegions(request.image);
}

declare const self: WorkerScope<ImageRedactDetectWorkerRequest, ImageRedactDetectWorkerResult>;
listenForRequests(self, handleImageRedactDetectRequest);
