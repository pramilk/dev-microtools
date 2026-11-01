import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { removeUnreachableObjects } from './pdfObjectGraph';

describe('removeUnreachableObjects', () => {
  it('deletes objects nothing points at and keeps everything reachable from the trailer', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const kept = doc.context.register(doc.context.obj({ Kept: true }));
    page.node.set(PDFName.of('Extra'), kept);
    const orphan = doc.context.register(doc.context.obj({ Orphan: true }));

    expect(removeUnreachableObjects(doc.context)).toBe(1);
    expect(doc.context.lookup(orphan)).toBeUndefined();
    expect(doc.context.lookup(kept)).toBeDefined();
    expect((await PDFDocument.load(await doc.save())).getPageCount()).toBe(1);
  });

  it('copes with reference cycles and removes nothing from a clean document', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const a = doc.context.nextRef();
    const b = doc.context.nextRef();
    doc.context.assign(a, doc.context.obj({ Next: b }));
    doc.context.assign(b, doc.context.obj({ Next: a }));
    page.node.set(PDFName.of('Loop'), a);
    expect(removeUnreachableObjects(doc.context)).toBe(0);
  });
});
