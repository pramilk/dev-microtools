import { resizeLanczos, type RgbaImageData } from '../lib/tools/imageUpscale';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * A Lanczos-3 resample over a full-size photo (up to `MAX_OUTPUT_PIXELS`) is a genuinely
 * heavy, multi-second, single-threaded pass — the same reason Background Remover's model
 * inference runs off the main thread, just with plain JS pixel math here instead of WASM.
 */
export interface ImageUpscaleWorkerRequest {
  image: RgbaImageData;
  targetWidth: number;
  targetHeight: number;
}

export type ImageUpscaleWorkerResult = RgbaImageData;

export async function handleImageUpscaleRequest(request: ImageUpscaleWorkerRequest): Promise<ImageUpscaleWorkerResult> {
  const { image, targetWidth, targetHeight } = request;
  const data = resizeLanczos(image.data, image.width, image.height, targetWidth, targetHeight, 4);
  return { data, width: targetWidth, height: targetHeight };
}

declare const self: WorkerScope<ImageUpscaleWorkerRequest, ImageUpscaleWorkerResult>;
listenForRequests(self, handleImageUpscaleRequest);
