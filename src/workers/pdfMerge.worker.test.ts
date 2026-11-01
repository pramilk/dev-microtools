import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfMergeRequest } from './pdfMerge.worker';
import { DEFAULT_MERGE_OPTIONS } from '../lib/tools/pdfMerge';

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return doc.save();
}

describe('handlePdfMergeRequest', () => {
  it('inspects a PDF', async () => {
    const result = await handlePdfMergeRequest({ kind: 'inspect', bytes: await onePagePdf() });
    expect(result).toEqual({ kind: 'inspect', ok: true, info: { pageCount: 1, bookmarkCount: 0, formFieldCount: 0, signed: false } });
  });

  it('merges sources into one PDF', async () => {
    const sources = [
      { name: 'a.pdf', bytes: await onePagePdf(), pages: [0], rotation: 0 as const },
      { name: 'b.pdf', bytes: await onePagePdf(), pages: [0, 0], rotation: 90 as const },
    ];
    const result = await handlePdfMergeRequest({ kind: 'merge', sources, options: DEFAULT_MERGE_OPTIONS });
    if (result.kind !== 'merge' || !result.ok) throw new Error('expected a successful merge');
    expect(result.output.report.pageCount).toBe(3);
    expect((await PDFDocument.load(result.output.bytes)).getPageCount()).toBe(3);
  });

  it('turns tool errors into { ok: false } results rather than throwing', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    expect(await handlePdfMergeRequest({ kind: 'inspect', bytes })).toMatchObject({ kind: 'inspect', ok: false });
    expect(await handlePdfMergeRequest({ kind: 'merge', sources: [{ name: 'x.pdf', bytes, pages: [0], rotation: 0 }], options: DEFAULT_MERGE_OPTIONS })).toMatchObject({
      kind: 'merge',
      ok: false,
    });
  });

  it('builds the example files', async () => {
    const result = await handlePdfMergeRequest({ kind: 'samples' });
    if (result.kind !== 'samples') throw new Error('expected samples');
    expect(result.files).toHaveLength(3);
  });
});
