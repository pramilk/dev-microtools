import { optimizePngLosslessly, quantizePngPixels, type RgbaImageData } from '../lib/tools/imageCompress';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Only the two PNG-specific passes live here — Oxipng's lossless WASM re-compression and
 * image-q's lossy palette quantization. Both were already DOM-free, pure functions in
 * `imageCompress.ts` (unlike decode/canvas/encode, which stay in the island — see that
 * file's own comment on why canvas work can't move to `lib/tools`), so they're the
 * lowest-risk, highest-value piece of the compression pipeline to move off the main
 * thread: no `OffscreenCanvas`/`createImageBitmap`-in-worker rewrite needed, and they're
 * exactly the two steps heavy enough to matter (a WASM optimize pass and a full-image
 * Wu-quantization + dithering pass).
 */
export type ImageCompressWorkerRequest =
  | { kind: 'optimizePng'; buffer: ArrayBuffer }
  | { kind: 'quantizePng'; image: RgbaImageData; quality: number };

export type ImageCompressWorkerResult =
  | { kind: 'optimizePng'; buffer: ArrayBuffer }
  | { kind: 'quantizePng'; image: RgbaImageData };

export async function handleImageCompressRequest(request: ImageCompressWorkerRequest): Promise<ImageCompressWorkerResult> {
  if (request.kind === 'optimizePng') {
    const buffer = await optimizePngLosslessly(request.buffer);
    return { kind: 'optimizePng', buffer };
  }
  const image = await quantizePngPixels(request.image, request.quality);
  return { kind: 'quantizePng', image };
}

declare const self: WorkerScope<ImageCompressWorkerRequest, ImageCompressWorkerResult>;
listenForRequests(self, handleImageCompressRequest);
