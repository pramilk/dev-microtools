import { describe, it, expect } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, degrees } from 'pdf-lib';
import { unzlibSync } from 'fflate';
import { buildSamplePdf, organizePdf, type OrganizeInput } from './pdfOrganizeEngine';
import { DestinationResolver, readOutline } from './pdfPageAssembly';
import type { RasterCodec } from './pdfCompressEngine';
import { DEFAULT_ORGANIZE_SETTINGS, initialPages, planOrganize, type OrganizePage, type OrganizePlan, type OrganizeSettings } from './pdfOrganize';

const codec: RasterCodec = {
  decodeJpeg: async (_bytes, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  encodeJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 3]),
  encodePng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

/** A 1×1 PNG. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** Pages 300, 301, 302 … points wide, so the output order can be read back from the widths. */
async function pdf(pages: number, options: { field?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300 + i, 400]);
  if (options.field) doc.getForm().createTextField(options.field).addToPage(doc.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
  return doc.save();
}

function plan(pages: readonly OrganizePage[], pageCounts: number[], patch: Partial<OrganizeSettings> = {}, image: { type: string; name: string; size: number } | null = null): OrganizePlan {
  const result = planOrganize(pages, { ...DEFAULT_ORGANIZE_SETTINGS, ...patch }, pageCounts, image);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function organize(input: OrganizeInput, organizePlan: OrganizePlan) {
  const result = await organizePdf(input, organizePlan, codec);
  if (!result.ok) throw new Error(result.error);
  return { ...result.value, doc: await PDFDocument.load(result.value.bytes) };
}

const widths = (doc: PDFDocument) => doc.getPages().map((page) => Math.round(page.getWidth()));

/** Every content stream of a page, decoded, in drawing order. */
function contentStreams(doc: PDFDocument, index: number): string[] {
  const page = doc.getPage(index);
  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  const refs = resolved instanceof PDFArray ? resolved.asArray() : contents ? [contents] : [];
  return refs.map((ref) => {
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(stream instanceof PDFRawStream)) return stream instanceof PDFStream ? '' : '';
    const filter = stream.dict.get(PDFName.of('Filter'));
    const bytes = filter === PDFName.of('FlateDecode') ? unzlibSync(stream.contents) : stream.contents;
    return new TextDecoder('latin1').decode(bytes);
  });
}

const hex = (text: string) => Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
const drawsText = (doc: PDFDocument, index: number, text: string) => contentStreams(doc, index).join('\n').toUpperCase().includes(`<${hex(text)}>`);

describe('organizePdf — pages', () => {
  it('writes the pages in the new order, without the removed ones', async () => {
    const pages = initialPages(4);
    const reordered = [pages[2], pages[0], pages[3]] as OrganizePage[];
    const { doc, pageCount } = await organize({ files: [await pdf(4)], backgroundImage: null }, plan(reordered, [4]));
    expect(pageCount).toBe(3);
    expect(widths(doc)).toEqual([302, 300, 303]);
  });

  it('rotates pages on top of their own rotation', async () => {
    const source = await PDFDocument.load(await pdf(2));
    source.getPage(1).setRotation(degrees(90));
    const pages = initialPages(2).map((page) => ({ ...page, rotation: 90 as const }));
    const { doc } = await organize({ files: [await source.save()], backgroundImage: null }, plan(pages, [2]));
    expect(doc.getPages().map((page) => page.getRotation().angle)).toEqual([90, 180]);
  });

  it('inserts blank pages the size of the page before them, as shown', async () => {
    const source = await PDFDocument.load(await pdf(2));
    source.getPage(0).setRotation(degrees(90));
    const [first, second] = initialPages(2) as [OrganizePage, OrganizePage];
    const blank = (id: number): OrganizePage => ({ id, source: null, rotation: 0 });
    const { doc } = await organize({ files: [await source.save()], backgroundImage: null }, plan([blank(10), first, blank(11), second], [2]));
    expect(doc.getPageCount()).toBe(4);
    // The leading blank takes the first page's shown size (rotated: 400 × 300); so does the one after it.
    expect(doc.getPages().map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())])).toEqual([
      [400, 300],
      [300, 400],
      [400, 300],
      [301, 400],
    ]);
  });

  it('writes a page used twice as two pages', async () => {
    const [first, second] = initialPages(2) as [OrganizePage, OrganizePage];
    const { doc } = await organize({ files: [await pdf(2)], backgroundImage: null }, plan([first, second, { ...first, id: 9 }], [2]));
    expect(widths(doc)).toEqual([300, 301, 300]);
  });

  it('interleaves pages from an inserted PDF, keeping and renaming form fields', async () => {
    const main = await pdf(2, { field: 'name' });
    const other = await pdf(2, { field: 'name' });
    const pages: OrganizePage[] = [
      { id: 1, source: { file: 0, page: 0 }, rotation: 0 },
      { id: 2, source: { file: 1, page: 1 }, rotation: 0 },
      { id: 3, source: { file: 0, page: 1 }, rotation: 0 },
      { id: 4, source: { file: 1, page: 0 }, rotation: 0 },
    ];
    const result = await organize({ files: [main, other], backgroundImage: null }, plan(pages, [2, 2]));
    expect(widths(result.doc)).toEqual([300, 301, 301, 300]);
    expect(result.fileCount).toBe(2);
    expect(result.renamedFields).toBe(1);
    expect(result.doc.getForm().getFields().map((field) => field.getName()).sort()).toEqual(['name', 'name_2']);
  });

  it('skips files no page uses any more', async () => {
    const { fileCount } = await organize({ files: [await pdf(1), null], backgroundImage: null }, plan(initialPages(1), [1, 3]));
    expect(fileCount).toBe(1);
  });

  it('keeps bookmarks pointing at their pages after a reorder', async () => {
    const sample = await buildSamplePdf();
    const pages = initialPages(6);
    // Swap "3. Results" (page 2) and "2. Summary" (page 3).
    const reordered = [pages[0], pages[2], pages[1], pages[3], pages[4], pages[5]] as OrganizePage[];
    const { doc, bookmarkCount } = await organize({ files: [sample], backgroundImage: null }, plan(reordered, [6]));
    expect(bookmarkCount).toBe(6);
    const outline = readOutline(doc, new DestinationResolver(doc));
    expect(outline.map((item) => [item.title, item.target?.pageIndex])).toEqual([
      ['Cover', 0],
      ['2. Summary', 1],
      ['3. Results', 2],
      ['4. Revenue chart', 3],
      ['Draft notes', 4],
      ['5. Appendix', 5],
    ]);
  });

  it('drops bookmarks to removed pages', async () => {
    const pages = initialPages(6).filter((page) => page.source?.page !== 4);
    const { doc } = await organize({ files: [await buildSamplePdf()], backgroundImage: null }, plan(pages, [6]));
    expect(readOutline(doc, null).map((item) => item.title)).not.toContain('Draft notes');
  });

  it('builds a six-page example with a sideways chart page', async () => {
    const doc = await PDFDocument.load(await buildSamplePdf());
    expect(doc.getPageCount()).toBe(6);
    expect(doc.getPage(3).getRotation().angle).toBe(90);
  });
});

describe('organizePdf — stamps', () => {
  it('numbers pages, from a chosen page and number, skipping blanks', async () => {
    const pages: OrganizePage[] = [...initialPages(3), { id: 9, source: null, rotation: 0 }];
    const numbers = { ...DEFAULT_ORGANIZE_SETTINGS.numbers, enabled: true, format: 'page-n-of-total' as const, fromPage: '2', start: '1' };
    const result = await organize({ files: [await pdf(3)], backgroundImage: null }, plan(pages, [3], { numbers }));
    expect(result.numberedPages).toBe(2);
    expect(drawsText(result.doc, 0, 'Page')).toBe(false);
    expect(drawsText(result.doc, 1, 'Page 1 of 3')).toBe(true);
    expect(drawsText(result.doc, 2, 'Page 2 of 3')).toBe(true);
  });

  it('gives each copy of a duplicated page its own number', async () => {
    const [first] = initialPages(1) as [OrganizePage];
    const numbers = { ...DEFAULT_ORGANIZE_SETTINGS.numbers, enabled: true };
    // A page with real content, so the copies share a content stream to begin with.
    const source = await PDFDocument.create();
    source.addPage([300, 400]).drawText('hello');
    const { doc } = await organize({ files: [await source.save()], backgroundImage: null }, plan([first, { ...first, id: 2 }], [1], { numbers }));
    expect(drawsText(doc, 0, '1')).toBe(true);
    expect(drawsText(doc, 0, '2')).toBe(false);
    expect(drawsText(doc, 1, '2')).toBe(true);
    expect(drawsText(doc, 1, '1')).toBe(false);
  });

  it('draws the header/footer and the watermark', async () => {
    const headerFooter = { ...DEFAULT_ORGANIZE_SETTINGS.headerFooter, enabled: true, text: 'Acme Corp' };
    const watermark = { ...DEFAULT_ORGANIZE_SETTINGS.watermark, enabled: true, text: 'DRAFT' };
    const { doc } = await organize({ files: [await pdf(2)], backgroundImage: null }, plan(initialPages(2), [2], { headerFooter, watermark }));
    for (const index of [0, 1]) {
      expect(drawsText(doc, index, 'Acme Corp')).toBe(true);
      expect(drawsText(doc, index, 'DRAFT')).toBe(true);
    }
  });

  it('draws text upright on a rotated page (rotated with it in user space)', async () => {
    const source = await PDFDocument.load(await pdf(1));
    source.getPage(0).setRotation(degrees(90));
    const numbers = { ...DEFAULT_ORGANIZE_SETTINGS.numbers, enabled: true };
    const { doc } = await organize({ files: [await source.save()], backgroundImage: null }, plan(initialPages(1), [1], { numbers }));
    // A 90° text matrix (cos ≈ 0, sin 1) placed 28 pt in from the user-space right edge — the
    // bottom of the page as shown.
    const matrix = /(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) Tm/.exec(contentStreams(doc, 0).join('\n'))?.slice(1).map(Number) ?? [];
    expect(matrix.map((value) => Math.round(value * 100) / 100)).toEqual([0, 1, -1, 0, 272, 197.22]);
  });

  it('draws a colour background underneath the existing content', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 400]).drawText('hello');
    const background = { ...DEFAULT_ORGANIZE_SETTINGS.background, kind: 'color' as const, color: '#ff0000' };
    const { doc } = await organize({ files: [await source.save()], backgroundImage: null }, plan(initialPages(1), [1], { background }));
    const streams = contentStreams(doc, 0);
    expect(streams[0]).toMatch(/1 0 0 rg[\s\S]*re[\s\S]*\bf\b/);
    expect(streams.findIndex((stream) => stream.includes('Tj'))).toBeGreaterThan(0);
  });

  it('draws an image background, with its opacity, and can leave blank pages alone', async () => {
    const background = { ...DEFAULT_ORGANIZE_SETTINGS.background, kind: 'image' as const, opacity: 40, skipBlank: true };
    const pages: OrganizePage[] = [...initialPages(1), { id: 5, source: null, rotation: 0 }];
    const image = { type: 'image/png', name: 'paper.png', size: PNG.length };
    const { doc } = await organize({ files: [await pdf(1)], backgroundImage: PNG }, plan(pages, [1], { background }, image));
    expect(contentStreams(doc, 0)[0]).toMatch(/\/GS-?\d*\s+gs[\s\S]*\/Image-?\d*\s+Do/);
    expect(contentStreams(doc, 1).join('')).not.toContain(' Do');
  });

  it('explains a background image that isn’t really an image', async () => {
    const background = { ...DEFAULT_ORGANIZE_SETTINGS.background, kind: 'image' as const };
    const image = { type: 'image/png', name: 'x.png', size: 4 };
    const result = await organizePdf({ files: [await pdf(1)], backgroundImage: new Uint8Array([1, 2, 3, 4]) }, plan(initialPages(1), [1], { background }, image), codec);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/background image couldn’t be read/) });
  });
});

describe('organizePdf — compression and errors', () => {
  it('compresses the organized file when asked, reporting both sizes', async () => {
    const result = await organize({ files: [await pdf(3)], backgroundImage: null }, plan(initialPages(3), [3], { compression: 'balanced' }));
    expect(result.compression).not.toBeNull();
    expect(result.compression?.after).toBe(result.bytes.length);
    expect(result.compression?.after).toBeLessThanOrEqual(result.compression?.before ?? 0);
  });

  it('rejects a file that isn’t a PDF', async () => {
    const result = await organizePdf({ files: [new TextEncoder().encode('hello')], backgroundImage: null }, plan(initialPages(1), [1]), codec);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/isn’t a PDF/) });
  });

  it('rejects a page the file doesn’t have', async () => {
    const result = await organizePdf({ files: [await pdf(1)], backgroundImage: null }, plan(initialPages(3), [3]), codec);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/has 1 page, so page 2/) });
  });

  it('rejects a plan whose file is missing', async () => {
    const pages: OrganizePage[] = [{ id: 1, source: { file: 1, page: 0 }, rotation: 0 }];
    const result = await organizePdf({ files: [await pdf(1), null], backgroundImage: null }, plan(pages, [1, 1]), codec);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Inserted PDF 1 isn’t available/) });
  });

  it('handles a large document', async () => {
    const pages = initialPages(400).reverse();
    const numbers = { ...DEFAULT_ORGANIZE_SETTINGS.numbers, enabled: true };
    const { doc } = await organize({ files: [await pdf(400)], backgroundImage: null }, plan(pages, [400], { numbers }));
    expect(doc.getPageCount()).toBe(400);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(699);
  }, 30_000);
});
