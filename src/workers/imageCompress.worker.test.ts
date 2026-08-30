import { describe, it, expect } from 'vitest';
import { handleImageCompressRequest } from './imageCompress.worker';

describe('handleImageCompressRequest', () => {
  it('runs the lossless PNG optimize pass and returns a buffer', async () => {
    const buffer = new ArrayBuffer(16);
    const result = await handleImageCompressRequest({ kind: 'optimizePng', buffer });
    expect(result.kind).toBe('optimizePng');
    if (result.kind !== 'optimizePng') throw new Error('expected an optimizePng result');
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('runs the lossy quantize pass and returns image data of the same dimensions', async () => {
    const image = { data: new Uint8ClampedArray(4 * 2 * 2), width: 2, height: 2 };
    const result = await handleImageCompressRequest({ kind: 'quantizePng', image, quality: 0.5 });
    expect(result.kind).toBe('quantizePng');
    if (result.kind !== 'quantizePng') throw new Error('expected a quantizePng result');
    expect(result.image.width).toBe(2);
    expect(result.image.height).toBe(2);
  });
});
