import { PDFDocument, PDFName, PDFNull, PDFNumber, type PDFObject, type PDFPage, rgb } from 'pdf-lib';
import { type ToolResult, ok, err, messageFrom } from './result';
import { removeUnreachableObjects } from './pdfObjectGraph';
import {
  FIT_VIEW,
  FormCollector,
  SourceEdits,
  appendSource,
  countItems,
  countTerminalFields,
  hasSignature,
  loadSource,
  readOutline,
  rootFields,
  writeOutline,
  UNREADABLE_MESSAGE,
  type OutlineNode,
} from './pdfPageAssembly';
import { sampleDoc, drawSamplePage } from './pdfSamplePages';
import type { MergeSourcePlan, PdfMergeOptions, PdfMergeReport, PdfSourceInfo } from './pdfMerge';

const name = (value: string): PDFName => PDFName.of(value);

/**
 * The Merge PDF pipeline. Imported only by `workers/pdfMerge.worker.ts`, so pdf-lib never
 * loads on the page itself. The page copying, bookmark remapping and form handling it relies
 * on live in `pdfPageAssembly.ts`, shared with Split PDF.
 */

// ------------------------------------------------------------------------ merge

export interface MergeSourceInput extends MergeSourcePlan {
  bytes: Uint8Array;
}

export interface PdfMergeOutput {
  bytes: Uint8Array;
  report: PdfMergeReport;
}

/**
 * Merges the given page selections, in order, into one PDF. Each source is parsed fresh
 * (the preparation step mutates it), so the same bytes can be merged again with a different
 * plan.
 */
export async function mergePdfs(sources: MergeSourceInput[], options: PdfMergeOptions): Promise<ToolResult<PdfMergeOutput>> {
  if (sources.length === 0) return err('Add at least one PDF to merge.');
  const out = await PDFDocument.create();
  const report: PdfMergeReport = {
    pageCount: 0,
    fileCount: sources.length,
    bookmarkCount: 0,
    formFieldCount: 0,
    renamedFields: 0,
    blankPagesAdded: 0,
    linksRemoved: 0,
    signedFiles: 0,
  };
  const form = new FormCollector(out);
  const outline: OutlineNode[] = [];

  for (const [position, source] of sources.entries()) {
    const loaded = await loadSource(source.bytes);
    if (!loaded.ok) return err(`“${source.name}”: ${loaded.error}`);
    const src = loaded.value;
    const pageCount = src.getPageCount();
    if (source.pages.length === 0) return err(`No pages are selected from “${source.name}”.`);
    const outOfRange = source.pages.find((page) => !Number.isInteger(page) || page < 0 || page >= pageCount);
    if (outOfRange !== undefined) {
      return err(`“${source.name}” has ${pageCount === 1 ? '1 page' : `${pageCount} pages`}, so page ${outOfRange + 1} can’t be included.`);
    }
    try {
      // A fresh parse per source, used once — its edits never need undoing.
      outline.push(...appendSource(out, src, source, options, form, report, position === sources.length - 1, new SourceEdits()));
    } catch (thrown: unknown) {
      return err(`“${source.name}” couldn’t be merged — part of it looks damaged (${messageFrom(thrown, 'unknown error')}). Try re-exporting it from the app that created it.`);
    }
  }

  form.write();
  if (outline.length > 0) writeOutline(out, outline);
  const title = options.title.trim();
  if (title) out.setTitle(title, { showInWindowTitleBar: true });

  removeUnreachableObjects(out.context);
  report.pageCount = out.getPageCount();
  report.bookmarkCount = countItems(outline);
  report.formFieldCount = form.terminalCount;
  report.renamedFields = form.renamed;

  try {
    const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    return ok({ bytes, report });
  } catch (thrown: unknown) {
    return err(`The merged PDF couldn’t be written (${messageFrom(thrown, 'unknown error')}). Try merging fewer files at once.`);
  }
}

/** What the file list shows about a PDF as soon as it's added. */
export async function inspectPdf(bytes: Uint8Array): Promise<ToolResult<PdfSourceInfo>> {
  const loaded = await loadSource(bytes);
  if (!loaded.ok) return loaded;
  const doc = loaded.value;
  try {
    return ok({
      pageCount: doc.getPageCount(),
      bookmarkCount: countItems(readOutline(doc, null)),
      formFieldCount: countTerminalFields(doc.context, rootFields(doc)),
      signed: hasSignature(doc),
    });
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
}


// ---------------------------------------------------------------------- samples


/**
 * The three files "Load example" adds: a one-page cover letter; a three-page report with its
 * own bookmarks and an internal link that uses a named destination; and a two-page appendix
 * with a fillable field and a landscape page. Together they show off everything the merge
 * preserves.
 */
export async function buildSamplePdfs(): Promise<{ name: string; bytes: Uint8Array }[]> {
  const letter = await sampleDoc('Cover letter (sample)');
  drawSamplePage(letter.doc.addPage([612, 792]), letter.fonts, [0.04, 0.43, 0.5], {
    kicker: 'cover-letter.pdf',
    title: 'Cover letter',
    lines: ['Please find the quarterly report and its appendix attached.', 'This is file 1 of 3 in the Merge PDF example.'],
    footer: 'cover-letter.pdf · page 1 of 1',
  });

  const report = await sampleDoc('Quarterly report (sample)');
  const sections = ['Summary', 'Findings', 'Next steps'];
  const reportPages = sections.map((section, i) => {
    const page = report.doc.addPage([595, 842]);
    drawSamplePage(page, report.fonts, [0.27, 0.3, 0.7], {
      kicker: 'quarterly-report.pdf',
      title: `${i + 1}. ${section}`,
      lines: [`Section ${i + 1} of the sample report.`, 'This file has its own bookmarks, which the merge keeps.'],
      footer: `quarterly-report.pdf · page ${i + 1} of 3`,
    });
    return page;
  });
  const { context } = report.doc;
  const [summary, findings, nextSteps] = reportPages as [PDFPage, PDFPage, PDFPage];
  summary.drawText('Jump to “Next steps” »', { x: 48, y: 650, size: 12, font: report.fonts.bold, color: rgb(0.27, 0.3, 0.7) });
  report.doc.catalog.set(name('Dests'), context.obj({ 'next-steps': [nextSteps.ref, 'Fit'] }));
  summary.node.set(
    name('Annots'),
    context.obj([context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [44, 644, 200, 666], Border: [0, 0, 0], Dest: name('next-steps') }))])
  );
  const bookmark = (title: string, page: PDFPage, view: PDFObject[] = FIT_VIEW): OutlineNode => ({ title, dest: context.obj([page.ref, ...view]), open: true, children: [] });
  writeOutline(report.doc, [
    bookmark('1. Summary', summary),
    { ...bookmark('2. Findings', findings), children: [bookmark('2.1 Revenue', findings, [name('XYZ'), PDFNull, PDFNumber.of(700), PDFNull])] },
    bookmark('3. Next steps', nextSteps),
  ]);

  const appendix = await sampleDoc('Appendix (sample)');
  const formPage = appendix.doc.addPage([595, 842]);
  drawSamplePage(formPage, appendix.fonts, [0.62, 0.38, 0.05], {
    kicker: 'appendix.pdf',
    title: 'Appendix A — Sign-off',
    lines: ['Reviewer name (a fillable form field — still fillable after merging):'],
    footer: 'appendix.pdf · page 1 of 2',
  });
  const reviewer = appendix.doc.getForm().createTextField('reviewer');
  reviewer.addToPage(formPage, { x: 48, y: 650, width: 280, height: 24 });
  drawSamplePage(appendix.doc.addPage([842, 595]), appendix.fonts, [0.62, 0.38, 0.05], {
    kicker: 'appendix.pdf',
    title: 'Appendix B — Landscape table',
    lines: ['A landscape page: merged files keep each page’s own size and orientation.'],
    footer: 'appendix.pdf · page 2 of 2',
  });

  return [
    { name: 'cover-letter.pdf', bytes: await letter.doc.save() },
    { name: 'quarterly-report.pdf', bytes: await report.doc.save() },
    { name: 'appendix.pdf', bytes: await appendix.doc.save() },
  ];
}
