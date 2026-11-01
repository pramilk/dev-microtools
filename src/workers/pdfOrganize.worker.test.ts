import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfOrganizeRequest } from './pdfOrganize.worker';
import type { RasterCodec } from '../lib/tools/pdfCompressEngine';
import { DEFAULT_ORGANIZE_SETTINGS, initialPages, planOrganize, reversePages } from '../lib/tools/pdfOrganize';

// The real OffscreenCanvas codec can't run in jsdom (and only compression uses it).
const codec: RasterCodec = {
  decodeJpeg: async (_bytes, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  encodeJpeg: async () => new Uint8Array([0xff, 0xd8]),
  encodePng: async () => new Uint8Array([0x89, 0x50]),
};

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([500, 400]);
  return doc.save();
}

describe('handlePdfOrganizeRequest', () => {
  it('inspects a PDF', async () => {
    const result = await handlePdfOrganizeRequest({ kind: 'inspect', bytes: await twoPagePdf() }, codec);
    expect(result).toEqual({ kind: 'inspect', ok: true, info: { pageCount: 2, bookmarkCount: 0, formFieldCount: 0, signed: false } });
  });

  it('writes the organized PDF', async () => {
    const plan = planOrganize(reversePages(initialPages(2)), DEFAULT_ORGANIZE_SETTINGS, [2]);
    if (!plan.ok) throw new Error(plan.error);
    const result = await handlePdfOrganizeRequest({ kind: 'organize', plan: plan.value, files: [await twoPagePdf()], backgroundImage: null }, codec);
    if (result.kind !== 'organize' || !result.ok) throw new Error('expected a successful result');
    const doc = await PDFDocument.load(result.output.bytes);
    expect(doc.getPages().map((page) => page.getWidth())).toEqual([500, 300]);
  });

  it('turns tool errors into { ok: false } results rather than throwing', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    expect(await handlePdfOrganizeRequest({ kind: 'inspect', bytes }, codec)).toMatchObject({ kind: 'inspect', ok: false });
    const plan = planOrganize(initialPages(1), DEFAULT_ORGANIZE_SETTINGS, [1]);
    if (!plan.ok) throw new Error(plan.error);
    expect(await handlePdfOrganizeRequest({ kind: 'organize', plan: plan.value, files: [bytes], backgroundImage: null }, codec)).toMatchObject({ kind: 'organize', ok: false });
  });

  it('builds the example file', async () => {
    const result = await handlePdfOrganizeRequest({ kind: 'sample' }, codec);
    if (result.kind !== 'sample') throw new Error('expected a sample');
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(6);
  });
});
