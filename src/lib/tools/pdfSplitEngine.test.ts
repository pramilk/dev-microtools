import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { buildSamplePdf, inspectSplitSource, splitPdf, type PdfSplitOutput } from './pdfSplitEngine';
import { DEFAULT_SPLIT_SETTINGS, SAMPLE_FILE_NAME, SAMPLE_RANGES, planSplit, type PdfSplitOptions, type SplitPlan } from './pdfSplit';

const N = (value: string) => PDFName.of(value);
const KEEP: PdfSplitOptions = { keepBookmarks: true };

const lookup = (doc: PDFDocument, value: PDFObject | undefined) => (value instanceof PDFRef ? doc.context.lookup(value) : value);

const partsPlan = (pageLists: number[][]): SplitPlan => ({ kind: 'parts', parts: pageLists.map((pages, i) => ({ name: `part-${i + 1}.pdf`, pages, label: `Part ${i + 1}` })) });

async function splitOk(bytes: Uint8Array, plan: SplitPlan, options: PdfSplitOptions = KEEP): Promise<PdfSplitOutput & { docs: PDFDocument[] }> {
  const result = await splitPdf(bytes, plan, options);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return { ...result.value, docs: await Promise.all(result.value.parts.map((part) => PDFDocument.load(part.bytes))) };
}

async function docWithWidths(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 500]);
  return doc.save();
}

const widths = (doc: PDFDocument) => doc.getPages().map((page) => Math.round(page.getWidth()));

/** Top-level bookmark titles with their children's titles. */
function outlineTitles(doc: PDFDocument): string[] {
  const titles: string[] = [];
  const read = (first: PDFObject | undefined, prefix: string) => {
    let node = lookup(doc, first);
    while (node instanceof PDFDict) {
      const title = node.get(N('Title'));
      titles.push(prefix + (title instanceof PDFHexString || title instanceof PDFString ? title.decodeText() : '?'));
      read(node.get(N('First')), `${prefix}  `);
      node = lookup(doc, node.get(N('Next')));
    }
  };
  const root = lookup(doc, doc.catalog.get(N('Outlines')));
  if (root instanceof PDFDict) read(root.get(N('First')), '');
  return titles;
}

/** Every link annotation, as [page it's on, page index it targets in the same document]. */
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

describe('inspectSplitSource', () => {
  it('reports pages, bookmarks with their pages and levels, and form fields', async () => {
    const result = await inspectSplitSource(await buildSamplePdf());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.pageCount).toBe(6);
    expect(result.value.bookmarkCount).toBe(9);
    expect(result.value.formFieldCount).toBe(1);
    expect(result.value.signed).toBe(false);
    expect(result.value.bookmarks.filter((bookmark) => bookmark.level === 1)).toEqual([
      { title: 'Contents', pageIndex: 0, level: 1 },
      { title: '1. Working here', pageIndex: 1, level: 1 },
      { title: '2. Benefits', pageIndex: 3, level: 1 },
      { title: '3. Sign-off', pageIndex: 5, level: 1 },
    ]);
    expect(result.value.bookmarks).toContainEqual({ title: '1.2 Remote work', pageIndex: 2, level: 2 });
  });

  it('gives a heading bookmark with no target of its own its first child’s page', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const second = doc.addPage();
    const { context } = doc;
    const rootRef = context.nextRef();
    const headingRef = context.nextRef();
    const childRef = context.nextRef();
    context.assign(childRef, context.obj({ Title: PDFHexString.fromText('Child'), Parent: headingRef, Dest: [second.ref, 'Fit'] }));
    context.assign(headingRef, context.obj({ Title: PDFHexString.fromText('Heading'), Parent: rootRef, First: childRef, Last: childRef, Count: 1 }));
    context.assign(rootRef, context.obj({ Type: 'Outlines', First: headingRef, Last: headingRef, Count: 2 }));
    doc.catalog.set(N('Outlines'), rootRef);
    const result = await inspectSplitSource(await doc.save());
    if (!result.ok) throw new Error(result.error);
    expect(result.value.bookmarks).toEqual([
      { title: 'Heading', pageIndex: 1, level: 1 },
      { title: 'Child', pageIndex: 1, level: 2 },
    ]);
  });

  it('rejects files that aren’t readable PDFs', async () => {
    expect(await inspectSplitSource(new TextEncoder().encode('hello'))).toMatchObject({ ok: false, error: expect.stringMatching(/PDF header/) });
    expect(await inspectSplitSource(new TextEncoder().encode('%PDF-1.7\ngarbage'))).toMatchObject({ ok: false });
    expect(await inspectSplitSource(new Uint8Array())).toMatchObject({ ok: false });
  });
});

describe('splitPdf by parts', () => {
  it('writes each part with the chosen pages, in the chosen order', async () => {
    const { parts, docs } = await splitOk(await docWithWidths([100, 200, 300, 400]), partsPlan([[2, 0], [1], [3, 3]]));
    expect(docs.map(widths)).toEqual([[300, 100], [200], [400, 400]]);
    expect(parts.map((part) => [part.name, part.pageCount, part.pages])).toEqual([
      ['part-1.pdf', 2, [2, 0]],
      ['part-2.pdf', 1, [1]],
      ['part-3.pdf', 2, [3, 3]],
    ]);
    expect(parts.every((part) => !part.overLimit)).toBe(true);
  });

  it('splits the sample: links within a part survive, links into other parts are removed, bookmarks and fields follow their pages', async () => {
    const bytes = await buildSamplePdf();
    const inspected = await inspectSplitSource(bytes);
    if (!inspected.ok) throw new Error(inspected.error);
    const plan = planSplit({ ...DEFAULT_SPLIT_SETTINGS, ranges: SAMPLE_RANGES }, inspected.value, SAMPLE_FILE_NAME);
    if (!plan.ok) throw new Error(plan.error);
    const { parts, docs } = await splitOk(bytes, plan.value);

    expect(parts.map((part) => part.name)).toEqual(['employee-handbook-page-1.pdf', 'employee-handbook-pages-2-3.pdf', 'employee-handbook-pages-4-6.pdf']);
    expect(parts.map((part) => part.linksRemoved)).toEqual([3, 0, 0]);
    expect(linksOf(docs[0] as PDFDocument)).toEqual([]);
    expect(linksOf(docs[1] as PDFDocument)).toEqual([[0, 1]]);
    expect(outlineTitles(docs[1] as PDFDocument)).toEqual(['1. Working here', '  1.1 Hours', '  1.2 Remote work']);
    expect(outlineTitles(docs[2] as PDFDocument)).toEqual(['2. Benefits', '  2.1 Leave', '  2.2 Health cover', '3. Sign-off', '  3.1 Acknowledgement']);
    expect(parts.map((part) => part.formFieldCount)).toEqual([0, 0, 1]);
    expect((docs[2] as PDFDocument).getForm().getFields().map((field) => field.getName())).toEqual(['employee-name']);
    expect((docs[1] as PDFDocument).getTitle()).toBe('Employee handbook (sample)');
  });

  it('reuses one parse safely: each part sees the source as it was, not as the last part left it', async () => {
    const bytes = await buildSamplePdf();
    // Page 1's three contents links are stripped while writing a part without their targets.
    // If that edit leaked, the whole-document part afterwards would have lost them too.
    const { parts, docs } = await splitOk(bytes, partsPlan([[0], [0], [0, 1, 2, 3, 4, 5]]));
    expect(parts.map((part) => part.linksRemoved)).toEqual([3, 3, 0]);
    expect(linksOf(docs[2] as PDFDocument)).toEqual([
      [0, 1],
      [0, 3],
      [0, 5],
      [1, 2],
    ]);
  });

  it('leaves bookmarks out when asked', async () => {
    const { docs } = await splitOk(await buildSamplePdf(), partsPlan([[1, 2]]), { keepBookmarks: false });
    expect(outlineTitles(docs[0] as PDFDocument)).toEqual([]);
  });

  it('explains bad plans and unreadable files', async () => {
    const bytes = await docWithWidths([100, 200]);
    expect(await splitPdf(bytes, partsPlan([]), KEEP)).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to split into/) });
    expect(await splitPdf(bytes, partsPlan([[]]), KEEP)).toMatchObject({ ok: false, error: 'Part 1 has no pages.' });
    expect(await splitPdf(bytes, partsPlan([[5]]), KEEP)).toMatchObject({ ok: false, error: expect.stringMatching(/2 pages, so page 6 can’t be included/) });
    expect(await splitPdf(new TextEncoder().encode('nope'), partsPlan([[0]]), KEEP)).toMatchObject({ ok: false, error: expect.stringMatching(/PDF header/) });
  });

  it('handles a large page count', async () => {
    const bytes = await docWithWidths(Array.from({ length: 300 }, (_, i) => 100 + i));
    const { parts } = await splitOk(bytes, partsPlan(Array.from({ length: 300 }, (_, i) => [i])));
    expect(parts).toHaveLength(300);
    expect(parts.every((part) => part.pageCount === 1)).toBe(true);
  }, 30_000);
});

describe('splitPdf by size', () => {
  /** Pages each carrying their own incompressible-looking image of `kb` KB (pdf-lib never
   *  recompresses a raw stream, so its bytes land in the output as-is), plus optionally one
   *  shared image drawn on every page. */
  async function docWithPayloads(kbs: number[], sharedKb = 0): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const { context } = doc;
    const stream = (kb: number, seed: number) => {
      const data = new Uint8Array(kb * 1024);
      let x = seed;
      for (let i = 0; i < data.length; i++) data[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
      return context.register(context.stream(data, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }));
    };
    const shared = sharedKb > 0 ? stream(sharedKb, 7) : null;
    kbs.forEach((kb, i) => {
      const page = doc.addPage([200 + i, 300]);
      page.node.setXObject(N('Own'), stream(kb, i + 1));
      if (shared) page.node.setXObject(N('Shared'), shared);
    });
    return doc.save();
  }

  const plan = (maxKb: number, pages: number[]): SplitPlan => ({ kind: 'size', maxBytes: maxKb * 1024, base: 'scan', pages });
  const allPages = (count: number) => Array.from({ length: count }, (_, i) => i);

  it('packs consecutive pages into as few files as fit under the limit', async () => {
    const { parts, docs } = await splitOk(await docWithPayloads([30, 30, 30, 30, 30, 30, 30]), plan(100, allPages(7)));
    expect(parts.every((part) => part.bytes.length <= 100 * 1024)).toBe(true);
    expect(parts.flatMap((part) => part.pages)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parts.map((part) => part.pageCount)).toEqual([3, 3, 1]);
    expect(docs.flatMap(widths)).toEqual([200, 201, 202, 203, 204, 205, 206]);
    expect(parts.map((part) => part.name)).toEqual(['scan-pages-1-3.pdf', 'scan-pages-4-6.pdf', 'scan-page-7.pdf']);
  });

  it('counts an image shared by every page once per file, not once per page', async () => {
    // Naively 40 + 10 KB per page → 1 page per 60 KB file. Counting the shared 40 KB once
    // leaves room for 2 pages.
    const { parts } = await splitOk(await docWithPayloads([10, 10, 10, 10], 40), plan(70, allPages(4)));
    expect(parts.map((part) => part.pageCount)).toEqual([2, 2]);
    expect(parts.every((part) => part.bytes.length <= 70 * 1024)).toBe(true);
  });

  it('gives a page bigger than the limit a file of its own and flags it', async () => {
    const { parts } = await splitOk(await docWithPayloads([20, 150, 20]), plan(100, allPages(3)));
    expect(parts.map((part) => [part.pages, part.overLimit])).toEqual([
      [[0], false],
      [[1], true],
      [[2], false],
    ]);
  });

  it('packs only the pages it is given, naming gaps by position', async () => {
    const { parts, docs } = await splitOk(await docWithPayloads([30, 30, 30, 30, 30]), plan(100, [0, 2, 3, 4]));
    expect(parts.map((part) => part.pages)).toEqual([[0, 2, 3], [4]]);
    expect(docs.flatMap(widths)).toEqual([200, 202, 203, 204]);
    expect(parts.map((part) => part.name)).toEqual(['scan-part-01.pdf', 'scan-page-5.pdf']);
  });

  it('rejects an empty or out-of-range page list', async () => {
    const bytes = await docWithPayloads([5, 5]);
    expect(await splitPdf(bytes, plan(100, []), KEEP)).toMatchObject({ ok: false, error: expect.stringMatching(/no pages to split/) });
    expect(await splitPdf(bytes, plan(100, [0, 7]), KEEP)).toMatchObject({ ok: false, error: expect.stringMatching(/page 8 can’t be included/) });
  });

  it('puts the whole document in one file when it already fits', async () => {
    const { parts } = await splitOk(await docWithPayloads([5, 5, 5]), plan(1024, allPages(3)));
    expect(parts).toHaveLength(1);
    expect(parts[0]?.name).toBe('scan-pages-1-3.pdf');
  });
});

describe('buildSamplePdf', () => {
  it('builds a valid six-page PDF', async () => {
    expect((await PDFDocument.load(await buildSamplePdf())).getPageCount()).toBe(6);
  });
});
