import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFNumber, PDFPageLeaf, PDFRef, PDFStream, rgb, type PDFObject, type PDFPage } from 'pdf-lib';
import { type ToolResult, ok, err, messageFrom } from './result';
import { removeUnreachableObjects } from './pdfObjectGraph';
import {
  DestinationResolver,
  FIT_VIEW,
  FormCollector,
  SourceEdits,
  UNREADABLE_MESSAGE,
  appendSource,
  countItems,
  countTerminalFields,
  hasSignature,
  loadSource,
  readOutline,
  rootFields,
  writeOutline,
  type OutlineNode,
  type SourceOutlineItem,
} from './pdfPageAssembly';
import { drawSamplePage, sampleDoc } from './pdfSamplePages';
import type { PdfMergeReport } from './pdfMerge';
import {
  MAX_BOOKMARK_LEVEL,
  MAX_SPLIT_PARTS,
  nameRangeParts,
  type PdfSplitOptions,
  type PdfSplitSourceInfo,
  type SplitBookmark,
  type SplitPartReport,
  type SplitPlan,
} from './pdfSplit';

/**
 * The Split PDF pipeline. Imported only by `workers/pdfSplit.worker.ts`, so pdf-lib never
 * loads on the page itself.
 *
 * Each part is written with the same page-assembly engine as Merge PDF (one source, a subset
 * of its pages), so links between pages of the same part keep working, bookmarks pointing
 * into the part come along, and form fields stay fillable. The source is parsed once: the
 * edits the engine makes to prepare it are journaled and reverted after every part, so a
 * 500-page file split page by page costs one parse, not 500.
 *
 * Split by file size can only find its cut points by measuring pages, so it plans its parts
 * here (with `pdfSplit.ts`'s naming helpers) rather than in the island.
 */

const name = (value: string): PDFName => PDFName.of(value);

export interface SplitPartOutput extends SplitPartReport {
  name: string;
  /** 0-based source pages in this part, in order. */
  pages: number[];
  bytes: Uint8Array;
}

export interface PdfSplitOutput {
  parts: SplitPartOutput[];
  /** The source was digitally signed; no part can carry the signature. */
  signed: boolean;
}

type WrittenPart = Omit<SplitPartOutput, 'name' | 'overLimit'>;

/** Document-info text, or `undefined` when it's missing or malformed — a part is still worth
 *  writing without its source's title. */
function infoText(read: () => string | undefined): string | undefined {
  try {
    return read()?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const emptyReport = (): PdfMergeReport => ({
  pageCount: 0,
  fileCount: 1,
  bookmarkCount: 0,
  formFieldCount: 0,
  renamedFields: 0,
  blankPagesAdded: 0,
  linksRemoved: 0,
  signedFiles: 0,
});

/** Writes one part from the shared parse, undoing the preparation edits afterwards so the
 *  next part starts from the untouched source. */
class PartWriter {
  private readonly title: string | undefined;
  private readonly author: string | undefined;

  constructor(
    private readonly src: PDFDocument,
    private readonly options: PdfSplitOptions
  ) {
    this.title = infoText(() => src.getTitle());
    this.author = infoText(() => src.getAuthor());
  }

  async write(pages: number[], label: string): Promise<ToolResult<WrittenPart>> {
    const out = await PDFDocument.create();
    const report = emptyReport();
    const form = new FormCollector(out);
    const edits = new SourceEdits();
    const assembly = { fileBookmarks: false, keepBookmarks: this.options.keepBookmarks, blankPageAfterOdd: false, title: '' };
    let outline: OutlineNode[];
    try {
      outline = appendSource(out, this.src, { name: label, pages, rotation: 0 }, assembly, form, report, true, edits);
    } catch (thrown: unknown) {
      return err(`${label} couldn’t be written — part of this PDF looks damaged (${messageFrom(thrown, 'unknown error')}). Try re-exporting it from the app that created it.`);
    } finally {
      edits.revert();
    }

    form.write();
    if (outline.length > 0) writeOutline(out, outline);
    if (this.title) out.setTitle(this.title);
    if (this.author) out.setAuthor(this.author);
    removeUnreachableObjects(out.context);
    try {
      const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      return ok({
        pages,
        bytes,
        pageCount: out.getPageCount(),
        bookmarkCount: countItems(outline),
        formFieldCount: form.terminalCount,
        linksRemoved: report.linksRemoved,
      });
    } catch (thrown: unknown) {
      return err(`${label} couldn’t be saved (${messageFrom(thrown, 'unknown error')}). Try splitting into fewer, smaller parts.`);
    }
  }
}

// ------------------------------------------------------------------- by file size

/** Fixed cost of any PDF — header, catalog, page tree, info, xref — beyond its pages' objects. */
const DOCUMENT_OVERHEAD_BYTES = 2048;
/** Per indirect object: its `n 0 obj … endobj` wrapper and xref entry. */
const OBJECT_OVERHEAD_BYTES = 24;
/** Pack parts to this share of the limit, so the usual estimate error doesn't force a rewrite. */
const PACKING_MARGIN = 0.95;

/**
 * For each page, the indirect objects copying it pulls in — its content streams, images,
 * fonts, annotations — keyed by reference, with each object's serialized size. A part's size
 * is then roughly the size of the union of its pages' objects, so a font shared by every page
 * counts once per part, not once per page.
 *
 * The walk mirrors what the copier follows: it never climbs `/Parent` (the page tree) and
 * stops at any other page (a link's target), since the assembly engine cuts both.
 */
function pageFootprints(src: PDFDocument): Map<string, number>[] {
  const { context } = src;
  const parent = name('Parent');
  return src.getPages().map((page) => {
    const sizes = new Map<string, number>();
    const stack: PDFObject[] = [page.ref];
    // Resources inherited from the page tree live behind the /Parent the walk won't follow.
    const inherited = page.node.Resources();
    if (inherited) stack.push(inherited);
    while (stack.length > 0) {
      const value = stack.pop();
      if (value instanceof PDFRef) {
        const key = value.toString();
        if (sizes.has(key)) continue;
        const target = context.lookup(value);
        if (target === undefined || (target instanceof PDFPageLeaf && target !== page.node)) continue;
        sizes.set(key, target.sizeInBytes() + OBJECT_OVERHEAD_BYTES);
        stack.push(target);
      } else if (value instanceof PDFDict) {
        for (const [key, entry] of value.entries()) if (key !== parent) stack.push(entry);
      } else if (value instanceof PDFArray) {
        stack.push(...value.asArray());
      } else if (value instanceof PDFStream) {
        stack.push(value.dict);
      }
    }
    return sizes;
  });
}

/** How many of `pages`, from position `start`, fit under `budget` by the footprint estimate —
 *  always at least one, since a page too big on its own still has to go somewhere. */
function pagesThatFit(footprints: Map<string, number>[], pages: number[], start: number, budget: number): number {
  const union = new Set<string>();
  let size = DOCUMENT_OVERHEAD_BYTES;
  let count = 0;
  for (let index = start; index < pages.length; index++) {
    let added = 0;
    const footprint = footprints[pages[index] ?? -1] ?? new Map<string, number>();
    for (const [key, bytes] of footprint) if (!union.has(key)) added += bytes;
    if (count > 0 && size + added > budget) break;
    for (const key of footprint.keys()) union.add(key);
    size += added;
    count += 1;
  }
  return count;
}

/**
 * Splits `pages` (in order) into consecutive runs, each written under `maxBytes` where possible: pack
 * by the footprint estimate, write, and if the real file still came out too big, cut the run
 * down in proportion and write again. The estimate is usually close (images and fonts, which
 * dominate, are copied byte for byte), so most parts are written once.
 */
async function splitBySize(writer: PartWriter, footprints: Map<string, number>[], pages: number[], maxBytes: number, base: string): Promise<ToolResult<SplitPartOutput[]>> {
  const written: WrittenPart[] = [];
  for (let start = 0; start < pages.length; ) {
    let count = pagesThatFit(footprints, pages, start, maxBytes * PACKING_MARGIN);
    const label = `The part starting at page ${(pages[start] ?? 0) + 1}`;
    let result = await writer.write(pages.slice(start, start + count), label);
    while (result.ok && result.value.bytes.length > maxBytes && count > 1) {
      count = Math.max(1, Math.min(count - 1, Math.floor((count * maxBytes * PACKING_MARGIN) / result.value.bytes.length)));
      result = await writer.write(pages.slice(start, start + count), label);
    }
    if (!result.ok) return result;
    written.push(result.value);
    if (written.length > MAX_SPLIT_PARTS) {
      return err(`That limit would make more than ${MAX_SPLIT_PARTS.toLocaleString('en-US')} files — choose a bigger size.`);
    }
    start += count;
  }
  const names = nameRangeParts(base, written.map((part) => part.pages));
  return ok(written.map((part, index) => ({ ...part, overLimit: part.bytes.length > maxBytes, name: names[index]?.name ?? `part-${index + 1}.pdf` })));
}

// -------------------------------------------------------------------------- split

/** Writes every part from one parse of `bytes`. */
export async function splitPdf(bytes: Uint8Array, plan: SplitPlan, options: PdfSplitOptions): Promise<ToolResult<PdfSplitOutput>> {
  const pageLists = plan.kind === 'parts' ? plan.parts.map((part) => part.pages) : [plan.pages];
  if (pageLists.length === 0) return err('There’s nothing to split into — add at least one page range.');
  const loaded = await loadSource(bytes);
  if (!loaded.ok) return loaded;
  const src = loaded.value;
  const pageCount = src.getPageCount();
  for (const [index, pages] of pageLists.entries()) {
    if (pages.length === 0) return err(plan.kind === 'parts' ? `Part ${index + 1} has no pages.` : 'There are no pages to split — tick at least one page to keep.');
    const outOfRange = pages.find((page) => !Number.isInteger(page) || page < 0 || page >= pageCount);
    if (outOfRange !== undefined) return err(`This PDF has ${pageCount === 1 ? '1 page' : `${pageCount} pages`}, so page ${outOfRange + 1} can’t be included.`);
  }
  const writer = new PartWriter(src, options);
  let signed: boolean;
  try {
    signed = hasSignature(src);
  } catch {
    return err(UNREADABLE_MESSAGE);
  }

  if (plan.kind === 'size') {
    let footprints: Map<string, number>[];
    try {
      footprints = pageFootprints(src);
    } catch (thrown: unknown) {
      return err(`This PDF’s pages couldn’t be measured — part of it looks damaged (${messageFrom(thrown, 'unknown error')}). Try re-exporting it from the app that created it.`);
    }
    const parts = await splitBySize(writer, footprints, plan.pages, plan.maxBytes, plan.base);
    return parts.ok ? ok({ parts: parts.value, signed }) : parts;
  }

  const outputs: SplitPartOutput[] = [];
  for (const [index, part] of plan.parts.entries()) {
    const result = await writer.write(part.pages, `Part ${index + 1}`);
    if (!result.ok) return result;
    outputs.push({ ...result.value, overLimit: false, name: part.name });
  }
  return ok({ parts: outputs, signed });
}

/** The first page an outline item leads to: its own target, or (for a heading with no target
 *  of its own) its first child's. */
function firstPageOf(item: SourceOutlineItem): number | null {
  if (item.target) return item.target.pageIndex;
  for (const child of item.children) {
    const page = firstPageOf(child);
    if (page !== null) return page;
  }
  return null;
}

/** What the tool shows about a PDF as soon as it's chosen, including the bookmarks it could
 *  be split at. */
export async function inspectSplitSource(bytes: Uint8Array): Promise<ToolResult<PdfSplitSourceInfo>> {
  const loaded = await loadSource(bytes);
  if (!loaded.ok) return loaded;
  const doc = loaded.value;
  try {
    const outline = readOutline(doc, new DestinationResolver(doc));
    const bookmarks: SplitBookmark[] = [];
    const walk = (items: SourceOutlineItem[], level: number) => {
      for (const item of items) {
        const pageIndex = firstPageOf(item);
        if (pageIndex !== null) bookmarks.push({ title: item.title, pageIndex, level });
        if (level < MAX_BOOKMARK_LEVEL) walk(item.children, level + 1);
      }
    };
    walk(outline, 1);
    return ok({
      pageCount: doc.getPageCount(),
      bookmarks,
      bookmarkCount: countItems(outline),
      formFieldCount: countTerminalFields(doc.context, rootFields(doc)),
      signed: hasSignature(doc),
    });
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
}

// ---------------------------------------------------------------------- sample

/**
 * The file "Load example" opens: a six-page handbook with a contents page linking to each
 * chapter, nested bookmarks, a "continued" link inside chapter 1 and a fillable field on the
 * last page — enough to show what each part keeps (links within it, its own bookmarks, the
 * field) and what it can't (links into another part).
 */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const { doc, fonts } = await sampleDoc('Employee handbook (sample)');
  const accent: [number, number, number] = [0.04, 0.43, 0.5];
  const chapters = [
    { title: '1. Working here', sections: ['1.1 Hours', '1.2 Remote work'] },
    { title: '2. Benefits', sections: ['2.1 Leave', '2.2 Health cover'] },
    { title: '3. Sign-off', sections: ['3.1 Acknowledgement'] },
  ];
  const total = 6;
  const footer = (page: number) => `employee-handbook.pdf · page ${page} of ${total}`;

  const contents = doc.addPage([595, 842]);
  drawSamplePage(contents, fonts, accent, {
    kicker: 'employee-handbook.pdf',
    title: 'Contents',
    lines: ['1. Working here ........................ page 2', '2. Benefits .............................. page 4', '3. Sign-off ............................... page 6'],
    footer: footer(1),
  });

  const sectionPages: PDFPage[] = [];
  let pageNumber = 2;
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      const page = doc.addPage([595, 842]);
      drawSamplePage(page, fonts, accent, {
        kicker: chapter.title,
        title: section,
        lines: [`Part of chapter “${chapter.title}”.`, 'Each part you split out keeps the bookmarks that point into it.'],
        footer: footer(pageNumber),
      });
      sectionPages.push(page);
      pageNumber += 1;
    }
  }
  const [hours, remote, leave, health, acknowledgement] = sectionPages as [PDFPage, PDFPage, PDFPage, PDFPage, PDFPage];
  const { context } = doc;
  const link = (rect: number[], target: PDFPage) =>
    context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: [target.ref, 'Fit'] }));

  // drawSamplePage puts body line i at y = height - 140 - i * 20.
  contents.node.set(name('Annots'), context.obj([hours, leave, acknowledgement].map((target, i) => link([44, 842 - 144 - i * 20, 400, 842 - 126 - i * 20], target))));
  hours.drawText('Continued on the next page »', { x: 48, y: 650, size: 12, font: fonts.bold, color: rgb(...accent) });
  hours.node.set(name('Annots'), context.obj([link([44, 644, 230, 666], remote)]));

  acknowledgement.drawText('Employee name (a fillable form field):', { x: 48, y: 670, size: 12, font: fonts.regular, color: rgb(0.2, 0.23, 0.28) });
  doc.getForm().createTextField('employee-name').addToPage(acknowledgement, { x: 48, y: 636, width: 280, height: 24 });

  const bookmark = (title: string, page: PDFPage, view: PDFObject[] = FIT_VIEW, children: OutlineNode[] = []): OutlineNode => ({
    title,
    dest: context.obj([page.ref, ...view]),
    open: true,
    children,
  });
  writeOutline(doc, [
    bookmark('Contents', contents),
    bookmark('1. Working here', hours, FIT_VIEW, [bookmark('1.1 Hours', hours), bookmark('1.2 Remote work', remote, [name('XYZ'), PDFNull, PDFNumber.of(700), PDFNull])]),
    bookmark('2. Benefits', leave, FIT_VIEW, [bookmark('2.1 Leave', leave), bookmark('2.2 Health cover', health)]),
    bookmark('3. Sign-off', acknowledgement, FIT_VIEW, [bookmark('3.1 Acknowledgement', acknowledgement)]),
  ]);
  return doc.save();
}
