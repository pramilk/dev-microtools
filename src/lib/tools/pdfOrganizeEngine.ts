import {
  PDFArray,
  PDFContentStream,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  StandardFonts,
  clip,
  concatTransformationMatrix,
  degrees,
  drawObject,
  endPath,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setGraphicsState,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import { type ToolResult, ok, err, messageFrom } from './result';
import { removeUnreachableObjects } from './pdfObjectGraph';
import { FIT_VIEW, FormCollector, SourceEdits, appendSource, countItems, hasSignature, loadSource, writeOutline, type OutlineNode } from './pdfPageAssembly';
import { compressPdf, type RasterCodec } from './pdfCompressEngine';
import { PDF_PRESETS } from './pdfCompress';
import { drawSamplePage, sampleDoc } from './pdfSamplePages';
import type { PdfMergeReport } from './pdfMerge';
import {
  displaySize,
  displayToUserMatrix,
  fitImage,
  pageNumberLabels,
  stampOrigin,
  toUserSpace,
  watermarkLayout,
  type BackgroundPlan,
  type OrganizePlan,
  type OrganizeReport,
  type StampPosition,
  type WatermarkPlan,
} from './pdfOrganize';

/**
 * The Organize PDF pipeline. Imported only by `workers/pdfOrganize.worker.ts`, so pdf-lib
 * never loads on the page itself.
 *
 * Each source file's pages are copied with the same page-assembly engine as Merge and Split
 * PDF — once per file, all of that file's pages together, repeats allowed — so links between
 * kept pages of a file still work, bookmarks follow their pages, and form fields stay
 * fillable. The copied pages are then put in the requested order (moving a page in the page
 * tree keeps every reference to it), rotations and blank pages are applied, then the stamps,
 * and compression, when chosen, runs last on the finished file with the PDF Compressor's own
 * engine.
 */

const name = (value: string): PDFName => PDFName.of(value);

const STAMP_INK = rgb(0.25, 0.27, 0.3);

export interface OrganizeOutput extends OrganizeReport {
  bytes: Uint8Array;
}

/** Input to `organizePdf`: the bytes of every file the plan's pages refer to, by file index
 *  (null for a file no page uses any more), and the background image, if the plan has one. */
export interface OrganizeInput {
  files: (Uint8Array | null)[];
  backgroundImage: Uint8Array | null;
}

const normalizeAngle = (angle: number): number => (((Math.round(angle / 90) * 90) % 360) + 360) % 360;

const shownRotation = (page: PDFPage): number => normalizeAngle(page.getRotation().angle);

/**
 * Gives a page its own `/Contents` array before anything is drawn on it. A page used twice
 * (Duplicate) is a separate page object, but both copies can point at one shared contents
 * array — and pdf-lib appends new drawing to that array in place, so without this a page
 * number drawn on one copy would show on both.
 */
function ownContents(page: PDFPage): void {
  const { node, doc } = page;
  const contents = node.get(name('Contents'));
  const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (resolved instanceof PDFArray) node.set(name('Contents'), doc.context.obj(resolved.asArray()));
  else if (resolved instanceof PDFStream && contents instanceof PDFRef) node.set(name('Contents'), doc.context.obj([contents]));
}

/**
 * Draws `operators` *underneath* everything already on the page, by putting their content
 * stream first. (pdf-lib only ever draws on top.) The page's existing content is wrapped in
 * q/Q by pdf-lib's normalisation, and these operators save and restore their own state, so
 * neither can affect the other.
 */
function drawUnderneath(page: PDFPage, operators: PDFOperator[]): void {
  const { node, doc } = page;
  ownContents(page);
  node.normalize();
  const ref = doc.context.register(PDFContentStream.of(doc.context.obj({}), [pushGraphicsState(), ...operators, popGraphicsState()]));
  const contents = node.Contents();
  if (contents instanceof PDFArray) contents.insert(0, ref);
  else node.set(name('Contents'), doc.context.obj([ref]));
}

function drawBackground(page: PDFPage, plan: BackgroundPlan, image: PDFImage | null): void {
  const box = page.getCropBox();
  if (plan.kind === 'color') {
    drawUnderneath(page, [setFillingRgbColor(...plan.color), rectangle(box.x, box.y, box.width, box.height), fill()]);
    return;
  }
  if (!image) return;
  const rotation = shownRotation(page);
  const shown = displaySize(box, rotation);
  const area = fitImage(plan.fit, shown, { width: image.width, height: image.height });
  const operators: PDFOperator[] = [];
  if (plan.opacity < 1) {
    const state = page.doc.context.obj({ Type: 'ExtGState', ca: plan.opacity, CA: plan.opacity });
    operators.push(setGraphicsState(page.node.newExtGState('GS', state)));
  }
  const imageName = page.node.newXObject('Image', image.ref);
  // Work on the page as the reader sees it, so the image is upright on a rotated page, and
  // clip to it, so "cover" doesn't spill outside the page.
  operators.push(
    concatTransformationMatrix(...displayToUserMatrix(box, rotation)),
    rectangle(0, 0, shown.width, shown.height),
    clip(),
    endPath(),
    concatTransformationMatrix(area.width, 0, 0, area.height, area.x, area.y),
    drawObject(imageName)
  );
  drawUnderneath(page, operators);
}

function drawWatermark(page: PDFPage, font: PDFFont, plan: WatermarkPlan): void {
  const box = page.getCropBox();
  const rotation = shownRotation(page);
  const layout = watermarkLayout(plan, displaySize(box, rotation), font.widthOfTextAtSize(plan.text, 1));
  const at = toUserSpace(box, rotation, layout.dx, layout.dy, layout.angle);
  page.drawText(plan.text, { x: at.x, y: at.y, size: layout.size, font, color: rgb(...plan.color), opacity: plan.opacity, rotate: degrees(at.angle) });
}

/** One line of text at an edge of the page as displayed — a page number or the header/footer. */
function drawEdgeText(page: PDFPage, font: PDFFont, text: string, position: StampPosition, size: number): void {
  const box = page.getCropBox();
  const rotation = shownRotation(page);
  const { dx, dy } = stampOrigin(position, displaySize(box, rotation), font.widthOfTextAtSize(text, size), size);
  const at = toUserSpace(box, rotation, dx, dy);
  page.drawText(text, { x: at.x, y: at.y, size, font, color: STAMP_INK, rotate: degrees(at.angle) });
}

/** Document-info text, or `undefined` when it's missing or malformed. */
function infoText(read: () => string | undefined): string | undefined {
  try {
    return read()?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const emptyReport = (fileCount: number): PdfMergeReport => ({
  pageCount: 0,
  fileCount,
  bookmarkCount: 0,
  formFieldCount: 0,
  renamedFields: 0,
  blankPagesAdded: 0,
  linksRemoved: 0,
  signedFiles: 0,
});

/** Writes the organized PDF. `codec` is only used when compression is on. */
export async function organizePdf(input: OrganizeInput, plan: OrganizePlan, codec: RasterCodec): Promise<ToolResult<OrganizeOutput>> {
  const placed = plan.pages.flatMap((page, position) => (page.source ? [{ ...page.source, position }] : []));
  if (placed.length === 0) return err('There are no pages to write — keep at least one page from a PDF.');
  // Files in the order their first page appears, so their bookmarks come out in reading order.
  const fileOrder = [...new Set(placed.map((page) => page.file))];

  const out = await PDFDocument.create();
  const report = emptyReport(fileOrder.length);
  const form = new FormCollector(out);
  const outline: OutlineNode[] = [];
  let signed = false;
  let title: string | undefined;
  let author: string | undefined;
  /** Output pages in the order they were copied (grouped by file), with where each belongs. */
  const copied: { page: PDFPage; position: number }[] = [];

  for (const file of fileOrder) {
    const label = file === 0 ? 'The PDF' : `Inserted PDF ${file}`;
    const bytes = input.files[file];
    if (!bytes) return err(`${label} isn’t available any more — add it again.`);
    const loaded = await loadSource(bytes);
    if (!loaded.ok) return err(file === 0 ? loaded.error : `${label}: ${loaded.error}`);
    const src = loaded.value;
    const pageCount = src.getPageCount();
    const mine = placed.filter((page) => page.file === file);
    const outOfRange = mine.find((page) => !Number.isInteger(page.page) || page.page < 0 || page.page >= pageCount);
    if (outOfRange) return err(`${label} has ${pageCount === 1 ? '1 page' : `${pageCount} pages`}, so page ${outOfRange.page + 1} can’t be included.`);
    try {
      if (hasSignature(src)) signed = true;
      if (file === 0) {
        title = infoText(() => src.getTitle());
        author = infoText(() => src.getAuthor());
      }
      const before = out.getPageCount();
      const assembly = { fileBookmarks: false, keepBookmarks: plan.keepBookmarks, blankPageAfterOdd: false, title: '' };
      // A fresh parse per file, used once — its edits never need undoing.
      outline.push(...appendSource(out, src, { name: label, pages: mine.map((page) => page.page), rotation: 0 }, assembly, form, report, true, new SourceEdits()));
      const pages = out.getPages();
      mine.forEach((page, index) => copied.push({ page: pages[before + index] as PDFPage, position: page.position }));
    } catch (thrown: unknown) {
      return err(`${label} couldn’t be organized — part of it looks damaged (${messageFrom(thrown, 'unknown error')}). Try re-exporting it from the app that created it.`);
    }
  }

  let numberedPages = 0;
  try {
    // Put the copied pages in the requested order. Moving a page in the page tree keeps its
    // object, so bookmarks, links and form widgets pointing at it are unaffected.
    const ordered = [...copied].sort((a, b) => a.position - b.position);
    if (ordered.some((entry, index) => entry !== copied[index])) {
      for (let index = out.getPageCount() - 1; index >= 0; index--) out.removePage(index);
      ordered.forEach((entry, index) => out.insertPage(index, entry.page));
    }
    // Each page's own rotation, then the blank pages slotted in, each the size of the page
    // before it as shown (or, at the very start, the page after it).
    let sourceIndex = 0;
    for (const entry of plan.pages) {
      if (!entry.source) continue;
      const page = ordered[sourceIndex++]?.page;
      if (page && entry.rotation !== 0) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + entry.rotation)));
    }
    for (const [index, entry] of plan.pages.entries()) {
      if (entry.source) continue;
      const neighbour = out.getPage(index > 0 ? index - 1 : 0);
      const shown = displaySize(neighbour.getCropBox(), shownRotation(neighbour));
      const blank = out.insertPage(index, [shown.width, shown.height]);
      if (entry.rotation !== 0) blank.setRotation(degrees(entry.rotation));
    }

    const { background, watermark, headerFooter, pageNumbers } = plan;
    const isBlank = plan.pages.map((page) => page.source === null);
    const pages = out.getPages();
    if (background) {
      let image: PDFImage | null = null;
      if (background.kind === 'image') {
        if (!input.backgroundImage) return err('The background image isn’t available any more — choose it again.');
        try {
          image = background.format === 'png' ? await out.embedPng(input.backgroundImage) : await out.embedJpg(input.backgroundImage);
        } catch {
          return err('The background image couldn’t be read — it may be damaged, or not really a JPG or PNG. Try re-saving it.');
        }
      }
      pages.forEach((page, index) => {
        if (!(background.skipBlank && isBlank[index])) drawBackground(page, background, image);
      });
    }
    if (watermark || headerFooter || pageNumbers) {
      const font = await out.embedFont(StandardFonts.Helvetica);
      const labels = pageNumbers ? pageNumberLabels(pageNumbers, isBlank) : [];
      for (const [index, page] of pages.entries()) {
        const label = labels[index] ?? null;
        const header = headerFooter && !(headerFooter.skipBlank && isBlank[index]) ? headerFooter : null;
        if (!watermark && !header && label === null) continue;
        ownContents(page);
        if (watermark) drawWatermark(page, font, watermark);
        if (header) drawEdgeText(page, font, header.text, header.position, header.size);
        if (pageNumbers && label !== null) {
          drawEdgeText(page, font, label, pageNumbers.position, pageNumbers.size);
          numberedPages += 1;
        }
      }
    }
  } catch (thrown: unknown) {
    return err(`This PDF couldn’t be organized — part of it looks damaged (${messageFrom(thrown, 'unknown error')}). Try re-exporting it from the app that created it.`);
  }

  form.write();
  if (outline.length > 0) writeOutline(out, outline);
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  removeUnreachableObjects(out.context);

  let written: Uint8Array;
  try {
    written = await out.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  } catch (thrown: unknown) {
    return err(`The organized PDF couldn’t be saved (${messageFrom(thrown, 'unknown error')}). Try again with fewer pages.`);
  }

  const result: OrganizeOutput = {
    bytes: written,
    pageCount: out.getPageCount(),
    fileCount: fileOrder.length,
    bookmarkCount: countItems(outline),
    formFieldCount: form.terminalCount,
    linksRemoved: report.linksRemoved,
    renamedFields: form.renamed,
    numberedPages,
    compression: null,
    signed,
  };
  if (!plan.compression) return ok(result);

  const compressed = await compressPdf(written, PDF_PRESETS[plan.compression].options, codec);
  if (!compressed.ok) return err(`The pages were organized, but compressing them failed: ${compressed.error} Turn compression off to download the organized file.`);
  return ok({
    ...result,
    bytes: compressed.value.bytes,
    compression: { before: written.length, after: compressed.value.bytes.length, keptOriginal: compressed.value.report.keptOriginal },
  });
}

// ---------------------------------------------------------------------- sample

/**
 * The file "Load example" opens: a six-page report that needs exactly the jobs this tool does —
 * sections 2 and 3 in the wrong order, a chart page scanned sideways, and a page of draft notes
 * that shouldn't be sent — with bookmarks, so it shows them following their pages.
 */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const { doc, fonts } = await sampleDoc('Quarterly report (sample)');
  const accent: [number, number, number] = [0.04, 0.43, 0.5];
  const footer = 'quarterly-report.pdf · sample — rearrange me';
  const page = (title: string, lines: string[], kicker = 'Quarterly report · Q3') => {
    const added = doc.addPage([595, 842]);
    drawSamplePage(added, fonts, accent, { kicker, title, lines, footer });
    return added;
  };

  const cover = page('Quarterly report — Q3', ['Prepared for the leadership team.', 'This sample is deliberately out of order.'], 'quarterly-report.pdf');
  const results = page('3. Results', ['Section 3 — it should come after section 2.', 'Drag it after the next page, or select it and press Move later.']);
  const summary = page('2. Summary', ['Section 2 — it should come before section 3.']);
  const chart = page('4. Revenue chart', ['This page was scanned sideways — rotate it to the left.']);
  [120, 180, 150, 240].forEach((height, i) => {
    chart.drawRectangle({ x: 90 + i * 110, y: 200, width: 70, height, color: rgb(...accent) });
    chart.drawText(`Q${i + 1}`, { x: 114 + i * 110, y: 180, size: 14, font: fonts.bold, color: rgb(0.2, 0.23, 0.28) });
  });
  chart.setRotation(degrees(90));
  const notes = page('Draft notes — do not send', ['Internal notes left in by mistake. Remove this page.'], 'Draft');
  const appendix = page('5. Appendix', ['Sources and definitions.']);

  const { context } = doc;
  const bookmark = (title: string, target: PDFPage): OutlineNode => ({ title, dest: context.obj([target.ref, ...FIT_VIEW]), open: true, children: [] });
  writeOutline(doc, [
    bookmark('Cover', cover),
    bookmark('2. Summary', summary),
    bookmark('3. Results', results),
    bookmark('4. Revenue chart', chart),
    bookmark('Draft notes', notes),
    bookmark('5. Appendix', appendix),
  ]);
  return doc.save();
}
