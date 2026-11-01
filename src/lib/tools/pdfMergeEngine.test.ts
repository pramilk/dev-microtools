import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFPageLeaf, PDFRef, PDFString, degrees, type PDFObject } from 'pdf-lib';
import { buildSamplePdfs, inspectPdf, mergePdfs, type MergeSourceInput } from './pdfMergeEngine';
import { DEFAULT_MERGE_OPTIONS, type PdfMergeOptions } from './pdfMerge';

const N = (value: string) => PDFName.of(value);

/** A document whose pages have distinct widths, so tests can tell which source page landed
 *  where in the merged output just by reading page sizes. */
async function docWithWidths(widths: number[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 500]);
  return doc;
}

const source = async (doc: PDFDocument, name: string, pages?: number[], rotation: MergeSourceInput['rotation'] = 0): Promise<MergeSourceInput> => ({
  name,
  bytes: await doc.save(),
  pages: pages ?? doc.getPages().map((_, i) => i),
  rotation,
});

const options = (patch: Partial<PdfMergeOptions> = {}): PdfMergeOptions => ({ ...DEFAULT_MERGE_OPTIONS, ...patch });

async function mergeOk(sources: MergeSourceInput[], opts: PdfMergeOptions = options()) {
  const result = await mergePdfs(sources, opts);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return { ...result.value, doc: await PDFDocument.load(result.value.bytes) };
}

const widths = (doc: PDFDocument) => doc.getPages().map((page) => Math.round(page.getWidth()));

const lookup = (doc: PDFDocument, value: PDFObject | undefined) => (value instanceof PDFRef ? doc.context.lookup(value) : value);

interface OutlineEntry {
  title: string;
  page: number;
  count: number | null;
  children: OutlineEntry[];
}

/** The merged document's bookmarks, with each one's target as a merged page index (-1 if
 *  it points at anything other than a page in the page tree). */
function outlineOf(doc: PDFDocument): OutlineEntry[] {
  const refs = doc.getPages().map((page) => page.ref.toString());
  const root = lookup(doc, doc.catalog.get(N('Outlines')));
  const read = (first: PDFObject | undefined): OutlineEntry[] => {
    const items: OutlineEntry[] = [];
    let node = lookup(doc, first);
    while (node instanceof PDFDict) {
      const dest = lookup(doc, node.get(N('Dest')));
      const target = dest instanceof PDFArray ? dest.get(0) : undefined;
      const title = node.get(N('Title'));
      const count = node.get(N('Count'));
      items.push({
        title: title instanceof PDFHexString || title instanceof PDFString ? title.decodeText() : '?',
        page: target instanceof PDFRef ? refs.indexOf(target.toString()) : -1,
        count: count instanceof PDFNumber ? count.asNumber() : null,
        children: read(node.get(N('First'))),
      });
      node = lookup(doc, node.get(N('Next')));
    }
    return items;
  };
  return root instanceof PDFDict ? read(root.get(N('First'))) : [];
}

/** Every link annotation on a merged page, as [page it's on, page it targets]. */
function linksOf(doc: PDFDocument): [number, number][] {
  const refs = doc.getPages().map((page) => page.ref.toString());
  const links: [number, number][] = [];
  doc.getPages().forEach((page, index) => {
    const annots = lookup(doc, page.node.get(N('Annots')));
    if (!(annots instanceof PDFArray)) return;
    for (const entry of annots.asArray()) {
      const annot = lookup(doc, entry);
      if (!(annot instanceof PDFDict) || annot.get(N('Subtype')) !== N('Link')) continue;
      const dest = lookup(doc, annot.get(N('Dest')));
      const target = dest instanceof PDFArray ? dest.get(0) : undefined;
      links.push([index, target instanceof PDFRef ? refs.indexOf(target.toString()) : -1]);
    }
  });
  return links;
}

const pageObjectCount = (doc: PDFDocument) =>
  doc.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFPageLeaf).length;

/** Adds a bookmark tree to `doc`: [title, page index, children?]. */
type BookmarkSpec = [string, number, BookmarkSpec[]?];
function addBookmarks(doc: PDFDocument, specs: BookmarkSpec[]): void {
  const { context } = doc;
  const pages = doc.getPages();
  const rootRef = context.nextRef();
  const write = (items: BookmarkSpec[], parent: PDFRef): [PDFRef, PDFRef] => {
    const refs = items.map(() => context.nextRef());
    items.forEach(([title, page, children], i) => {
      const dict = context.obj({ Title: PDFHexString.fromText(title), Parent: parent, Dest: [pages[page]!.ref, 'Fit'] });
      if (i > 0) dict.set(N('Prev'), refs[i - 1]!);
      if (i < items.length - 1) dict.set(N('Next'), refs[i + 1]!);
      if (children?.length) {
        const [first, last] = write(children, refs[i]!);
        dict.set(N('First'), first);
        dict.set(N('Last'), last);
        dict.set(N('Count'), PDFNumber.of(children.length));
      }
      context.assign(refs[i]!, dict);
    });
    return [refs[0]!, refs[refs.length - 1]!];
  };
  const [first, last] = write(specs, rootRef);
  context.assign(rootRef, context.obj({ Type: 'Outlines', First: first, Last: last, Count: specs.length }));
  doc.catalog.set(N('Outlines'), rootRef);
}

function addLink(doc: PDFDocument, onPage: number, dest: PDFObject | { goTo: PDFObject }): void {
  const { context } = doc;
  const page = doc.getPage(onPage);
  const target = 'goTo' in dest ? { A: context.obj({ S: 'GoTo', D: dest.goTo }) } : { Dest: dest };
  const link = context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], ...target }));
  page.node.set(N('Annots'), context.obj([link]));
}

async function formDoc(fieldName: string): Promise<PDFDocument> {
  const doc = await docWithWidths([300, 301]);
  const field = doc.getForm().createTextField(fieldName);
  field.setText('filled in');
  field.addToPage(doc.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
  return doc;
}

describe('mergePdfs — pages', () => {
  it('appends every page of every file, in file order, keeping page sizes', async () => {
    const a = await docWithWidths([100, 101, 102]);
    const b = await docWithWidths([200, 201]);
    const { doc, report } = await mergeOk([await source(a, 'a.pdf'), await source(b, 'b.pdf')]);
    expect(widths(doc)).toEqual([100, 101, 102, 200, 201]);
    expect(report).toMatchObject({ pageCount: 5, fileCount: 2, blankPagesAdded: 0 });
  });

  it('takes only the selected pages, in the order given, repeating a page if asked', async () => {
    const a = await docWithWidths([100, 101, 102, 103]);
    const { doc } = await mergeOk([await source(a, 'a.pdf', [3, 0, 3, 1])]);
    expect(widths(doc)).toEqual([103, 100, 103, 101]);
    // The repeated page is its own page object, not the same one listed twice in the tree.
    const refs = doc.getPages().map((page) => page.ref.toString());
    expect(new Set(refs).size).toBe(4);
  });

  it('adds the chosen rotation on top of each page’s own rotation', async () => {
    const a = await docWithWidths([100, 101]);
    a.getPage(1).setRotation(degrees(90));
    const { doc } = await mergeOk([await source(a, 'a.pdf', undefined, 90)]);
    expect(doc.getPages().map((page) => page.getRotation().angle)).toEqual([90, 180]);

    const { doc: wrapped } = await mergeOk([await source(a, 'a.pdf', undefined, 270)]);
    expect(wrapped.getPages().map((page) => page.getRotation().angle)).toEqual([270, 0]);
  });

  it('inserts a blank page after a file with an odd page count, sized like its last page, but not after the last file', async () => {
    const a = await docWithWidths([100, 101, 102]);
    const b = await docWithWidths([200]);
    const c = await docWithWidths([300, 301]);
    const sources = [await source(a, 'a.pdf'), await source(b, 'b.pdf'), await source(c, 'c.pdf', [0])];
    const { doc, report } = await mergeOk(sources, options({ blankPageAfterOdd: true }));
    expect(widths(doc)).toEqual([100, 101, 102, 102, 200, 200, 300]);
    expect(report.blankPagesAdded).toBe(2);
  });

  it('sizes a blank page to match a rotated last page as it is displayed', async () => {
    const a = await docWithWidths([100]);
    const { doc } = await mergeOk([await source(a, 'a.pdf', undefined, 90), await source(a, 'b.pdf')], options({ blankPageAfterOdd: true }));
    const blank = doc.getPage(1);
    expect([blank.getWidth(), blank.getHeight()]).toEqual([500, 100]);
  });

  it('merges a large document without trouble', async () => {
    const big = await docWithWidths(Array.from({ length: 400 }, (_, i) => 100 + (i % 50)));
    const { report } = await mergeOk([await source(big, 'big.pdf'), await source(big, 'big-again.pdf')], options({ fileBookmarks: false }));
    expect(report.pageCount).toBe(800);
  });
});

describe('mergePdfs — metadata and bookmarks', () => {
  it('adds a bookmark per file named after it, and opens the bookmarks panel', async () => {
    const a = await docWithWidths([100, 101]);
    const b = await docWithWidths([200]);
    const { doc, report } = await mergeOk([await source(a, 'Chapter 1.pdf'), await source(b, 'résumé 📄.PDF')]);
    expect(outlineOf(doc).map(({ title, page }) => [title, page])).toEqual([
      ['Chapter 1', 0],
      ['résumé 📄', 2],
    ]);
    expect(doc.catalog.get(N('PageMode'))).toBe(N('UseOutlines'));
    expect(report.bookmarkCount).toBe(2);
  });

  it('keeps each file’s own bookmarks nested under its file bookmark, remapped to the merged pages', async () => {
    const a = await docWithWidths([100]);
    const b = await docWithWidths([200, 201, 202]);
    addBookmarks(b, [
      ['Intro', 0],
      ['Body', 1, [['Detail', 2]]],
    ]);
    const { doc, report } = await mergeOk([await source(a, 'a.pdf'), await source(b, 'b.pdf')]);
    const [, fileB] = outlineOf(doc);
    expect(fileB).toMatchObject({ title: 'b', page: 1 });
    expect(fileB?.children.map(({ title, page }) => [title, page])).toEqual([
      ['Intro', 1],
      ['Body', 2],
    ]);
    expect(fileB?.children[1]?.children).toMatchObject([{ title: 'Detail', page: 3 }]);
    expect(report.bookmarkCount).toBe(5);
  });

  it('writes outline /Count values that match the open items', async () => {
    const b = await docWithWidths([200, 201, 202]);
    addBookmarks(b, [['Body', 0, [['Detail', 1], ['More', 2]]]]);
    const { doc } = await mergeOk([await source(b, 'b.pdf')]);
    const root = lookup(doc, doc.catalog.get(N('Outlines'))) as PDFDict;
    // File bookmark + Body + Detail + More, everything open.
    expect((root.get(N('Count')) as PDFNumber).asNumber()).toBe(4);
    expect(outlineOf(doc)[0]?.count).toBe(3);
  });

  it('puts kept bookmarks at the top level when per-file bookmarks are off, and can drop them entirely', async () => {
    const b = await docWithWidths([200, 201]);
    addBookmarks(b, [['Intro', 0], ['End', 1]]);
    const flat = await mergeOk([await source(b, 'b.pdf')], options({ fileBookmarks: false }));
    expect(outlineOf(flat.doc).map(({ title }) => title)).toEqual(['Intro', 'End']);

    const none = await mergeOk([await source(b, 'b.pdf')], options({ fileBookmarks: false, keepBookmarks: false }));
    expect(none.doc.catalog.get(N('Outlines'))).toBeUndefined();
    expect(none.report.bookmarkCount).toBe(0);
  });

  it('drops bookmarks for left-out pages, but keeps a parent whose children survive', async () => {
    const b = await docWithWidths([200, 201, 202]);
    addBookmarks(b, [
      ['Gone', 0],
      ['Parent on a left-out page', 0, [['Child', 2]]],
    ]);
    const { doc } = await mergeOk([await source(b, 'b.pdf', [1, 2])], options({ fileBookmarks: false }));
    const outline = outlineOf(doc);
    expect(outline.map(({ title, page }) => [title, page])).toEqual([['Parent on a left-out page', 1]]);
    expect(outline[0]?.children).toMatchObject([{ title: 'Child', page: 1 }]);
  });

  it('sets the document title when one is given', async () => {
    const a = await docWithWidths([100]);
    const { doc } = await mergeOk([await source(a, 'a.pdf')], options({ title: '  Q3 board pack  ' }));
    expect(doc.getTitle()).toBe('Q3 board pack');
  });
});

describe('mergePdfs — links', () => {
  it('keeps an internal link pointing at the merged copy of its target page, with no stray page copies', async () => {
    const a = await docWithWidths([100]);
    const b = await docWithWidths([200, 201, 202]);
    addLink(b, 0, b.context.obj([b.getPage(2).ref, 'Fit']));
    const { doc } = await mergeOk([await source(a, 'a.pdf'), await source(b, 'b.pdf')]);
    expect(linksOf(doc)).toEqual([[1, 3]]);
    expect(pageObjectCount(doc)).toBe(doc.getPageCount());
  });

  it('turns named destinations and GoTo actions into working explicit links', async () => {
    const b = await docWithWidths([200, 201, 202]);
    b.catalog.set(N('Dests'), b.context.obj({ chapter: [b.getPage(2).ref, 'Fit'] }));
    addLink(b, 0, N('chapter'));
    addLink(b, 1, { goTo: b.context.obj([b.getPage(0).ref, 'Fit']) });
    const { doc } = await mergeOk([await source(b, 'b.pdf')]);
    expect(linksOf(doc)).toEqual([
      [0, 2],
      [1, 0],
    ]);
  });

  it('resolves named destinations from the /Names tree', async () => {
    const b = await docWithWidths([200, 201]);
    const tree = b.context.obj({ Kids: [b.context.register(b.context.obj({ Names: [PDFString.of('end'), b.context.obj([b.getPage(1).ref, 'Fit'])] }))] });
    b.catalog.set(N('Names'), b.context.obj({ Dests: b.context.register(tree) }));
    addLink(b, 0, PDFString.of('end'));
    const { doc } = await mergeOk([await source(b, 'b.pdf')]);
    expect(linksOf(doc)).toEqual([[0, 1]]);
  });

  it('removes a link whose target page was left out, without dragging that page along', async () => {
    const b = await docWithWidths([200, 201, 202]);
    addLink(b, 0, b.context.obj([b.getPage(2).ref, 'Fit']));
    const { doc, report } = await mergeOk([await source(b, 'b.pdf', [0, 1])]);
    expect(linksOf(doc)).toEqual([]);
    expect(report.linksRemoved).toBe(1);
    expect(pageObjectCount(doc)).toBe(2);
  });

  it('gives a repeated page its own copy of the link annotation', async () => {
    const b = await docWithWidths([200, 201]);
    addLink(b, 0, b.context.obj([b.getPage(1).ref, 'Fit']));
    const { doc } = await mergeOk([await source(b, 'b.pdf', [0, 0, 1])]);
    expect(linksOf(doc)).toEqual([
      [0, 2],
      [1, 2],
    ]);
    const annotRef = (index: number) => ((lookup(doc, doc.getPage(index).node.get(N('Annots'))) as PDFArray).get(0) as PDFRef).toString();
    expect(annotRef(0)).not.toBe(annotRef(1));
  });
});

describe('mergePdfs — form fields', () => {
  it('keeps form fields fillable, with their values', async () => {
    const { doc, report } = await mergeOk([await source(await formDoc('email'), 'form.pdf')]);
    const fields = doc.getForm().getFields();
    expect(fields.map((field) => field.getName())).toEqual(['email']);
    expect(doc.getForm().getTextField('email').getText()).toBe('filled in');
    expect(report.formFieldCount).toBe(1);
  });

  it('renames a field that clashes with one from an earlier file, so the two stay independent', async () => {
    const form = await formDoc('name');
    const { doc, report } = await mergeOk([await source(form, 'first.pdf'), await source(form, 'second.pdf')]);
    expect(doc.getForm().getFields().map((field) => field.getName())).toEqual(['name', 'name_2']);
    expect(report).toMatchObject({ formFieldCount: 2, renamedFields: 1 });
  });

  it('leaves out fields whose widgets are only on left-out pages', async () => {
    const { doc, report } = await mergeOk([await source(await formDoc('email'), 'form.pdf', [1])]);
    expect(doc.catalog.get(N('AcroForm'))).toBeUndefined();
    expect(report.formFieldCount).toBe(0);
  });

  it('counts files whose digital signature the merge invalidates', async () => {
    const signed = await docWithWidths([100]);
    const sig = signed.context.register(signed.context.obj({ FT: 'Sig', T: PDFHexString.fromText('Signature1'), V: signed.context.obj({ Type: 'Sig' }) }));
    signed.catalog.set(N('AcroForm'), signed.context.obj({ Fields: [sig], SigFlags: 3 }));
    const { report } = await mergeOk([await source(signed, 'signed.pdf'), await source(await docWithWidths([200]), 'plain.pdf')]);
    expect(report.signedFiles).toBe(1);
  });
});

describe('mergePdfs — errors', () => {
  it('needs at least one file', async () => {
    const result = await mergePdfs([], options());
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/at least one PDF/) });
  });

  it('names the file that isn’t a PDF', async () => {
    const good = await source(await docWithWidths([100]), 'good.pdf');
    const result = await mergePdfs([good, { name: 'notes.pdf', bytes: new TextEncoder().encode('hello'), pages: [0], rotation: 0 }], options());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/“notes\.pdf”.*PDF header/);
  });

  it('explains how to handle an encrypted file', async () => {
    const doc = await docWithWidths([100]);
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1 }));
    const result = await mergePdfs([await source(doc, 'locked.pdf', [0])], options());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked\.pdf.*encrypted.*Print to PDF/s);
  });

  it('rejects a page selection outside the file', async () => {
    const result = await mergePdfs([await source(await docWithWidths([100, 101]), 'a.pdf', [0, 2])], options());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/has 2 pages, so page 3/);
  });

  it('rejects an empty page selection', async () => {
    const result = await mergePdfs([await source(await docWithWidths([100]), 'a.pdf', [])], options());
    expect(result.ok).toBe(false);
  });

  it('rejects a truncated PDF with a helpful message', async () => {
    const bytes = await (await docWithWidths([100])).save();
    const result = await mergePdfs([{ name: 'cut.pdf', bytes: bytes.slice(0, 40), pages: [0], rotation: 0 }], options());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cut\.pdf/);
  });
});

describe('inspectPdf', () => {
  it('reports pages, bookmarks and form fields', async () => {
    const doc = await formDoc('email');
    addBookmarks(doc, [['One', 0, [['Two', 1]]]]);
    const result = await inspectPdf(await doc.save());
    expect(result).toEqual({ ok: true, value: { pageCount: 2, bookmarkCount: 2, formFieldCount: 1, signed: false } });
  });

  it('rejects non-PDFs, encrypted PDFs and empty documents', async () => {
    expect((await inspectPdf(new Uint8Array())).ok).toBe(false);
    expect((await inspectPdf(new TextEncoder().encode('%PDF-1.7 garbage'))).ok).toBe(false);

    const locked = await docWithWidths([100]);
    locked.context.trailerInfo.Encrypt = locked.context.register(locked.context.obj({ Filter: 'Standard', V: 1 }));
    const encrypted = await inspectPdf(await locked.save());
    expect(encrypted.ok).toBe(false);
    if (!encrypted.ok) expect(encrypted.error).toMatch(/encrypted/);

    const empty = await inspectPdf(await (await PDFDocument.create()).save({ addDefaultPage: false }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/no pages/);
  });

  it('survives a cyclic bookmark list', async () => {
    const doc = await docWithWidths([100]);
    addBookmarks(doc, [['Loop', 0], ['Back', 0]]);
    const root = lookup(doc, doc.catalog.get(N('Outlines'))) as PDFDict;
    const last = lookup(doc, root.get(N('Last'))) as PDFDict;
    last.set(N('Next'), root.get(N('First')) as PDFRef);
    const result = await inspectPdf(await doc.save());
    expect(result).toMatchObject({ ok: true, value: { bookmarkCount: 2 } });
  });
});

describe('buildSamplePdfs', () => {
  it('builds three valid files that merge into a 6-page PDF keeping bookmarks, the named link and the form field', async () => {
    const samples = await buildSamplePdfs();
    expect(samples.map((sample) => sample.name)).toEqual(['cover-letter.pdf', 'quarterly-report.pdf', 'appendix.pdf']);
    const infos = await Promise.all(samples.map((sample) => inspectPdf(sample.bytes)));
    expect(infos.map((info) => (info.ok ? info.value.pageCount : -1))).toEqual([1, 3, 2]);

    const sources = await Promise.all(
      samples.map(async (sample, i) => ({ ...sample, pages: Array.from({ length: [1, 3, 2][i]! }, (_, p) => p), rotation: 0 as const }))
    );
    const { doc, report } = await mergeOk(sources);
    expect(report).toMatchObject({ pageCount: 6, fileCount: 3, formFieldCount: 1, renamedFields: 0, linksRemoved: 0 });
    expect(linksOf(doc)).toEqual([[1, 3]]);
    const outline = outlineOf(doc);
    expect(outline.map(({ title, page }) => [title, page])).toEqual([
      ['cover-letter', 0],
      ['quarterly-report', 1],
      ['appendix', 4],
    ]);
    expect(outline[1]?.children.map(({ title, page }) => [title, page])).toEqual([
      ['1. Summary', 1],
      ['2. Findings', 2],
      ['3. Next steps', 3],
    ]);
    expect(doc.getForm().getFields().map((field) => field.getName())).toEqual(['reviewer']);
    expect(pageObjectCount(doc)).toBe(6);
  });
});
