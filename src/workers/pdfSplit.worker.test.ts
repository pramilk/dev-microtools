import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfSplitRequest } from './pdfSplit.worker';

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([300, 400]);
  return doc.save();
}

describe('handlePdfSplitRequest', () => {
  it('inspects a PDF', async () => {
    const result = await handlePdfSplitRequest({ kind: 'inspect', bytes: await twoPagePdf() });
    expect(result).toEqual({ kind: 'inspect', ok: true, info: { pageCount: 2, bookmarks: [], bookmarkCount: 0, formFieldCount: 0, signed: false } });
  });

  it('splits a PDF into parts', async () => {
    const plan = { kind: 'parts' as const, parts: [{ name: 'a.pdf', pages: [0], label: 'Page 1' }, { name: 'b.pdf', pages: [1], label: 'Page 2' }] };
    const result = await handlePdfSplitRequest({ kind: 'split', bytes: await twoPagePdf(), plan, options: { keepBookmarks: true } });
    if (result.kind !== 'split' || !result.ok) throw new Error('expected a successful split');
    expect(result.output.parts.map((part) => part.name)).toEqual(['a.pdf', 'b.pdf']);
    expect((await PDFDocument.load(result.output.parts[1]?.bytes ?? new Uint8Array())).getPageCount()).toBe(1);
  });

  it('turns tool errors into { ok: false } results rather than throwing', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    expect(await handlePdfSplitRequest({ kind: 'inspect', bytes })).toMatchObject({ kind: 'inspect', ok: false });
    expect(await handlePdfSplitRequest({ kind: 'split', bytes, plan: { kind: 'size', maxBytes: 1024 * 1024, base: 'x', pages: [0] }, options: { keepBookmarks: true } })).toMatchObject({
      kind: 'split',
      ok: false,
    });
  });

  it('builds the example file', async () => {
    const result = await handlePdfSplitRequest({ kind: 'sample' });
    if (result.kind !== 'sample') throw new Error('expected a sample');
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(6);
  });
});
