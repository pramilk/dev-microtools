import { describe, it, expect } from 'vitest';
import { handleImageToPdfRequest } from './imageToPdf.worker';
import { DEFAULT_IMAGE_TO_PDF_OPTIONS } from '../lib/tools/imageToPdf';
import type { ImageDecodeCodec } from '../lib/tools/imageToPdfEngine';

// The real codec (createImageBitmap + OffscreenCanvas) and the canvas-drawn samples can't
// run in jsdom — these tests cover the request/response contract; e2e covers the rest.
const codec: ImageDecodeCodec = {
  decodeImage: async () => ({ data: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 }),
  encodeJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 4, 0, 4, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
};

describe('handleImageToPdfRequest', () => {
  it('returns a successful build result', async () => {
    const result = await handleImageToPdfRequest(
      { kind: 'build', sources: [{ name: 'a.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), rotation: 0 }], options: DEFAULT_IMAGE_TO_PDF_OPTIONS },
      codec
    );
    if (result.kind !== 'build' || !result.ok) throw new Error('expected a successful build');
    expect(result.output.report.pageCount).toBe(1);
  });

  it('turns a tool error into an { ok: false } result rather than throwing', async () => {
    const result = await handleImageToPdfRequest({ kind: 'build', sources: [], options: DEFAULT_IMAGE_TO_PDF_OPTIONS }, codec);
    expect(result).toEqual({ kind: 'build', ok: false, error: 'Add at least one image to make a PDF.' });
  });
});
