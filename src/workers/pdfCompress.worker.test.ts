import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfCompressRequest } from './pdfCompress.worker';
import { PDF_PRESETS } from '../lib/tools/pdfCompress';
import type { RasterCodec } from '../lib/tools/pdfCompressEngine';

// The real OffscreenCanvas codec can't run in jsdom — these tests cover the worker's
// request/response contract with a stand-in; the browser e2e test covers the real codec.
const codec: RasterCodec = {
  decodeJpeg: async (_bytes, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  encodeJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 3]),
  encodePng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

describe('handlePdfCompressRequest', () => {
  it('returns a successful compress result for a valid PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save({ useObjectStreams: false });
    const result = await handlePdfCompressRequest({ kind: 'compress', bytes, options: PDF_PRESETS.balanced.options }, codec);
    expect(result.kind).toBe('compress');
    if (result.kind !== 'compress' || !result.ok) throw new Error('expected a successful compress result');
    expect(result.output.report.pageCount).toBe(1);
    expect(result.output.bytes.length).toBeLessThanOrEqual(bytes.length);
  });

  it('turns a tool error into an { ok: false } result rather than throwing', async () => {
    const result = await handlePdfCompressRequest(
      { kind: 'compress', bytes: new TextEncoder().encode('not a pdf'), options: PDF_PRESETS.balanced.options },
      codec
    );
    expect(result).toMatchObject({ kind: 'compress', ok: false });
  });
});
