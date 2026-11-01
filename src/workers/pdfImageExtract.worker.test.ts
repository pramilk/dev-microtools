import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfImageExtractRequest } from './pdfImageExtract.worker';
import type { ImageExtractCodec } from '../lib/tools/pdfImageExtractEngine';

// The real OffscreenCanvas codec can't run in jsdom — these tests cover the worker's
// request/response contract with a stand-in; the browser e2e test covers the real codec.
const codec: ImageExtractCodec = {
  decodeJpeg: async (_bytes, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  encodePng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

describe('handlePdfImageExtractRequest', () => {
  it('returns a successful extract result for a valid PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const result = await handlePdfImageExtractRequest({ kind: 'extract', bytes: await doc.save() }, codec);
    if (result.kind !== 'extract' || !result.ok) throw new Error('expected a successful extract result');
    expect(result.output.report.pageCount).toBe(1);
    expect(result.output.images).toEqual([]);
  });

  it('turns a tool error into an { ok: false } result rather than throwing', async () => {
    const result = await handlePdfImageExtractRequest({ kind: 'extract', bytes: new TextEncoder().encode('not a pdf') }, codec);
    expect(result).toMatchObject({ kind: 'extract', ok: false });
  });
});
