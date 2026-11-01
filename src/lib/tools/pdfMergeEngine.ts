import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObjectCopier,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  type PDFContext,
  type PDFFont,
  type PDFObject,
} from 'pdf-lib';
import { type ToolResult, ok, err, messageFrom } from './result';
import { looksLikePdf } from './pdfFile';
import { removeUnreachableObjects } from './pdfObjectGraph';
import { baseName, type MergeSourcePlan, type PdfMergeOptions, type PdfMergeReport, type PdfSourceInfo } from './pdfMerge';

/**
 * The Merge PDF pipeline. Imported only by `workers/pdfMerge.worker.ts`, so pdf-lib never
 * loads on the page itself.
 *
 * Why not just `PDFDocument.copyPages`? It copies each page by value, so a link on page 1
 * pointing at page 3 drags in a *second*, orphaned copy of page 3 — internal links silently
 * stop working, and the file grows by every page any link targets. This engine copies pages
 * through their references with one copier per source, so a link and the page tree end up
 * pointing at the same copied page. On top of that it carries across what a professional
 * merge is expected to keep: bookmarks (remapped to the merged pages), named destinations
 * (rewritten as explicit ones), and fillable form fields (with clashing names made unique).
 */

const NOT_PDF_MESSAGE = 'This file doesn’t start with a PDF header, so it isn’t a PDF — it may be a different file type renamed to .pdf.';
const UNREADABLE_MESSAGE = 'This file couldn’t be read as a PDF — it may be damaged or truncated. Try re-exporting it from the app that created it.';
const ENCRYPTED_MESSAGE =
  'This PDF is encrypted (it has a password or permission restrictions), and an encrypted PDF can’t be rewritten in the browser. Open it in a PDF viewer, “Print to PDF” to save an unprotected copy, and add that instead.';
const NO_PAGES_MESSAGE = 'This PDF has no pages, so there’s nothing to merge from it.';

/** Hard caps on walking structures a damaged or hostile file could make cyclic or enormous. */
const MAX_TREE_DEPTH = 32;
const MAX_OUTLINE_ITEMS = 20_000;

const name = (value: string): PDFName => PDFName.of(value);

/** Follows a reference. Unlike pdf-lib's `lookupMaybe`, never throws on an unexpected type —
 *  real-world PDFs put the wrong kind of object in optional keys often enough to matter. */
function resolve(context: PDFContext, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? context.lookup(value) : value;
}

function dictAt(context: PDFContext, dict: PDFDict, key: string): PDFDict | undefined {
  const value = resolve(context, dict.get(name(key)));
  return value instanceof PDFDict ? value : undefined;
}

function arrayAt(context: PDFContext, dict: PDFDict, key: string): PDFArray | undefined {
  const value = resolve(context, dict.get(name(key)));
  return value instanceof PDFArray ? value : undefined;
}

function textOf(value: PDFObject | undefined): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName) return value.decodeText();
  return null;
}

const normalizeAngle = (angle: number): number => (((Math.round(angle / 90) * 90) % 360) + 360) % 360;

async function loadSource(bytes: Uint8Array): Promise<ToolResult<PDFDocument>> {
  if (!looksLikePdf(bytes)) return err(NOT_PDF_MESSAGE);
  let doc: PDFDocument;
  try {
    // Encryption is checked via `isEncrypted` rather than by catching pdf-lib's
    // `EncryptedPDFError`, whose ES5 compilation breaks `instanceof` (see pdfCompressEngine).
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: true });
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
  if (doc.isEncrypted) return err(ENCRYPTED_MESSAGE);
  try {
    if (doc.getPageCount() === 0) return err(NO_PAGES_MESSAGE);
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
  return ok(doc);
}

// ------------------------------------------------------------------ destinations

/** A resolved link/bookmark target: which source page, and the view parameters after it
 *  (`/XYZ left top zoom`, `/Fit`, …). */
interface Target {
  pageIndex: number;
  view: PDFObject[];
}

const FIT_VIEW: PDFObject[] = [name('Fit')];

/** Resolves explicit destinations, named destinations (legacy `/Dests` dictionary and the
 *  `/Names` tree) and GoTo actions to a page index within one source document. */
class DestinationResolver {
  private named: Map<string, PDFObject> | null = null;
  private readonly pageIndexByRef: Map<string, number>;

  constructor(private readonly doc: PDFDocument) {
    this.pageIndexByRef = new Map(doc.getPages().map((page, index) => [page.ref.toString(), index]));
  }

  pageIndexOf(ref: PDFRef): number | undefined {
    return this.pageIndexByRef.get(ref.toString());
  }

  /** A `/Dest` value: an explicit array, a name or string to look up, or a dict with `/D`. */
  resolve(value: PDFObject | undefined, depth = 0): Target | null {
    if (depth > 4) return null;
    const { context } = this.doc;
    const resolved = resolve(context, value);
    if (resolved instanceof PDFArray) return this.explicit(resolved);
    if (resolved instanceof PDFDict) return this.resolve(resolved.get(name('D')), depth + 1);
    const key = textOf(resolved);
    if (key === null) return null;
    return this.resolve(this.namedDestinations().get(key), depth + 1);
  }

  /** A link or bookmark's target, from either its `/Dest` or a GoTo `/A` action. Returns
   *  `undefined` when it has no internal target at all (e.g. a web link). */
  targetOf(dict: PDFDict): Target | null | undefined {
    const dest = dict.get(name('Dest'));
    if (dest !== undefined) return this.resolve(dest);
    const action = dictAt(this.doc.context, dict, 'A');
    if (action && action.get(name('S')) === name('GoTo')) return this.resolve(action.get(name('D')));
    return undefined;
  }

  private explicit(array: PDFArray): Target | null {
    const { context } = this.doc;
    const first = array.get(0);
    let pageIndex: number | undefined;
    if (first instanceof PDFRef) pageIndex = this.pageIndexOf(first);
    else if (first instanceof PDFNumber) {
      // Strictly a remote-document form, but some generators use a page number locally.
      const number = first.asNumber();
      if (Number.isInteger(number) && number >= 0 && number < this.pageIndexByRef.size) pageIndex = number;
    }
    if (pageIndex === undefined) return null;
    const view = array
      .asArray()
      .slice(1)
      .map((entry) => resolve(context, entry));
    const valid = view.length > 0 && view.every((entry) => entry instanceof PDFName || entry instanceof PDFNumber || entry === PDFNull);
    return { pageIndex, view: valid ? (view as PDFObject[]) : FIT_VIEW };
  }

  private namedDestinations(): Map<string, PDFObject> {
    if (this.named) return this.named;
    const map = new Map<string, PDFObject>();
    const { context, catalog } = this.doc;
    const legacy = dictAt(context, catalog, 'Dests');
    if (legacy) for (const [key, value] of legacy.entries()) map.set(key.decodeText(), value);
    const names = dictAt(context, catalog, 'Names');
    const tree = names && dictAt(context, names, 'Dests');
    if (tree) walkNameTree(context, tree, map, new Set(), 0);
    this.named = map;
    return map;
  }
}

function walkNameTree(context: PDFContext, node: PDFDict, into: Map<string, PDFObject>, seen: Set<PDFDict>, depth: number): void {
  if (depth > MAX_TREE_DEPTH || seen.has(node)) return;
  seen.add(node);
  const names = arrayAt(context, node, 'Names');
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const key = textOf(resolve(context, names.get(i)));
      if (key !== null && !into.has(key)) into.set(key, names.get(i + 1));
    }
  }
  const kids = arrayAt(context, node, 'Kids');
  if (kids) {
    for (const kid of kids.asArray()) {
      const child = resolve(context, kid);
      if (child instanceof PDFDict) walkNameTree(context, child, into, seen, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------- outline

interface SourceOutlineItem {
  title: string;
  target: Target | null;
  open: boolean;
  children: SourceOutlineItem[];
}

/** An outline item ready to write into the merged document. */
interface OutlineNode {
  title: string;
  dest: PDFArray;
  open: boolean;
  children: OutlineNode[];
}

function readOutline(doc: PDFDocument, resolver: DestinationResolver | null): SourceOutlineItem[] {
  const { context, catalog } = doc;
  const root = dictAt(context, catalog, 'Outlines');
  if (!root) return [];
  const seen = new Set<PDFDict>();
  let budget = MAX_OUTLINE_ITEMS;

  const readSiblings = (first: PDFDict | undefined, depth: number): SourceOutlineItem[] => {
    const items: SourceOutlineItem[] = [];
    let node = first;
    while (node && budget > 0 && !seen.has(node)) {
      seen.add(node);
      budget -= 1;
      const count = resolve(context, node.get(name('Count')));
      items.push({
        title: textOf(resolve(context, node.get(name('Title'))))?.trim() || 'Untitled',
        target: resolver?.targetOf(node) ?? null,
        open: count instanceof PDFNumber && count.asNumber() > 0,
        children: depth < MAX_TREE_DEPTH ? readSiblings(dictAt(context, node, 'First'), depth + 1) : [],
      });
      node = dictAt(context, node, 'Next');
    }
    return items;
  };
  return readSiblings(dictAt(context, root, 'First'), 0);
}

const countItems = (items: { children: unknown[] }[]): number =>
  items.reduce((sum, item) => sum + 1 + countItems(item.children as { children: unknown[] }[]), 0);

/** How many descendants show when this item is expanded — the magnitude of its `/Count`. */
const visibleWhenOpen = (node: OutlineNode): number => node.children.reduce((sum, child) => sum + 1 + (child.open ? visibleWhenOpen(child) : 0), 0);

function writeOutline(doc: PDFDocument, roots: OutlineNode[]): void {
  const { context } = doc;
  const rootRef = context.nextRef();

  const writeLevel = (nodes: OutlineNode[], parentRef: PDFRef): { first: PDFRef; last: PDFRef } => {
    const refs = nodes.map(() => context.nextRef());
    nodes.forEach((node, i) => {
      const dict = context.obj({ Title: PDFHexString.fromText(node.title), Parent: parentRef, Dest: node.dest });
      if (i > 0) dict.set(name('Prev'), refs[i - 1] as PDFRef);
      if (i < nodes.length - 1) dict.set(name('Next'), refs[i + 1] as PDFRef);
      if (node.children.length > 0) {
        const { first, last } = writeLevel(node.children, refs[i] as PDFRef);
        const count = visibleWhenOpen(node);
        dict.set(name('First'), first);
        dict.set(name('Last'), last);
        dict.set(name('Count'), PDFNumber.of(node.open ? count : -count));
      }
      context.assign(refs[i] as PDFRef, dict);
    });
    return { first: refs[0] as PDFRef, last: refs[refs.length - 1] as PDFRef };
  };

  const { first, last } = writeLevel(roots, rootRef);
  const total = roots.reduce((sum, node) => sum + 1 + (node.open ? visibleWhenOpen(node) : 0), 0);
  context.assign(rootRef, context.obj({ Type: 'Outlines', First: first, Last: last, Count: total }));
  doc.catalog.set(name('Outlines'), rootRef);
  // Opens the bookmarks panel on load, so the per-file bookmarks are actually discovered.
  doc.catalog.set(name('PageMode'), name('UseOutlines'));
}

// ------------------------------------------------------------------------ forms

/** Visits every field dictionary under `entries`, telling the visitor whether it's terminal
 *  (has no named child fields — its kids, if any, are just widgets). */
function walkFields(context: PDFContext, entries: PDFObject[], visit: (field: PDFDict, terminal: boolean) => void): void {
  const seen = new Set<PDFDict>();
  const walk = (entry: PDFObject, depth: number) => {
    const field = resolve(context, entry);
    if (!(field instanceof PDFDict) || seen.has(field) || depth > MAX_TREE_DEPTH) return;
    seen.add(field);
    const kids = arrayAt(context, field, 'Kids')?.asArray() ?? [];
    const childFields = kids.filter((kid) => {
      const child = resolve(context, kid);
      return child instanceof PDFDict && child.get(name('T')) !== undefined;
    });
    visit(field, childFields.length === 0);
    for (const kid of childFields) walk(kid, depth + 1);
  };
  for (const entry of entries) walk(entry, 0);
}

function rootFields(doc: PDFDocument): PDFObject[] {
  const acroForm = dictAt(doc.context, doc.catalog, 'AcroForm');
  return (acroForm && arrayAt(doc.context, acroForm, 'Fields')?.asArray()) ?? [];
}

function countTerminalFields(context: PDFContext, entries: PDFObject[]): number {
  let count = 0;
  walkFields(context, entries, (_field, terminal) => {
    if (terminal) count += 1;
  });
  return count;
}

function hasSignature(doc: PDFDocument): boolean {
  let signed = false;
  walkFields(doc.context, rootFields(doc), (field) => {
    if (field.get(name('FT')) === name('Sig') && field.get(name('V')) !== undefined) signed = true;
  });
  return signed;
}

/** True if any widget in this field's subtree sits on one of the merged pages. */
function fieldTouches(context: PDFContext, entry: PDFObject, widgets: Set<string>, depth = 0): boolean {
  if (entry instanceof PDFRef && widgets.has(entry.toString())) return true;
  if (depth > MAX_TREE_DEPTH) return false;
  const field = resolve(context, entry);
  if (!(field instanceof PDFDict)) return false;
  return (arrayAt(context, field, 'Kids')?.asArray() ?? []).some((kid) => fieldTouches(context, kid, widgets, depth + 1));
}

/** Accumulates the merged document's `/AcroForm` across sources. */
class FormCollector {
  readonly fields: PDFRef[] = [];
  private readonly usedNames = new Set<string>();
  private fonts: PDFDict | null = null;
  private defaultAppearance: PDFObject | null = null;
  private needAppearances = false;
  terminalCount = 0;
  renamed = 0;

  constructor(private readonly out: PDFDocument) {}

  collect(src: PDFDocument, copier: PDFObjectCopier, widgetsOnMergedPages: Set<string>): void {
    const { context } = src;
    const acroForm = dictAt(context, src.catalog, 'AcroForm');
    if (!acroForm) return;
    const included: PDFRef[] = [];
    for (const entry of arrayAt(context, acroForm, 'Fields')?.asArray() ?? []) {
      if (!(entry instanceof PDFRef) || !fieldTouches(context, entry, widgetsOnMergedPages)) continue;
      const copiedRef = copier.copy(entry);
      const field = this.out.context.lookup(copiedRef);
      if (!(field instanceof PDFDict)) continue;
      this.makeNameUnique(field);
      included.push(copiedRef);
    }
    if (included.length === 0) return;
    this.fields.push(...included);
    this.terminalCount += countTerminalFields(this.out.context, included);

    const resources = dictAt(context, acroForm, 'DR');
    const sourceFonts = resources && dictAt(context, resources, 'Font');
    if (sourceFonts) {
      this.fonts ??= this.out.context.obj({});
      for (const [key, value] of sourceFonts.entries()) {
        if (!this.fonts.has(key)) this.fonts.set(key, copier.copy(value));
      }
    }
    const appearance = resolve(context, acroForm.get(name('DA')));
    if (!this.defaultAppearance && (appearance instanceof PDFString || appearance instanceof PDFHexString)) {
      this.defaultAppearance = copier.copy(appearance);
    }
    if (resolve(context, acroForm.get(name('NeedAppearances'))) === PDFBool.True) this.needAppearances = true;
  }

  /** Two files with a field called "name" would otherwise become one shared field — typing
   *  in either fills both — because PDF identifies fields by fully-qualified name. */
  private makeNameUnique(field: PDFDict): void {
    const original = textOf(field.get(name('T')));
    if (original === null) return;
    let candidate = original;
    for (let suffix = 2; this.usedNames.has(candidate); suffix++) candidate = `${original}_${suffix}`;
    if (candidate !== original) {
      field.set(name('T'), PDFHexString.fromText(candidate));
      this.renamed += 1;
    }
    this.usedNames.add(candidate);
  }

  write(): void {
    if (this.fields.length === 0) return;
    const { context } = this.out;
    const acroForm = context.obj({ Fields: context.obj(this.fields) });
    if (this.fonts) acroForm.set(name('DR'), context.obj({ Font: this.fonts }));
    if (this.defaultAppearance) acroForm.set(name('DA'), this.defaultAppearance);
    if (this.needAppearances) acroForm.set(name('NeedAppearances'), PDFBool.True);
    this.out.catalog.set(name('AcroForm'), context.register(acroForm));
  }
}

// ------------------------------------------------------------------------ merge

export interface MergeSourceInput extends MergeSourcePlan {
  bytes: Uint8Array;
}

export interface PdfMergeOutput {
  bytes: Uint8Array;
  report: PdfMergeReport;
}

/**
 * Prepares a source for copying: rewrites every internal link on a merged page as an
 * explicit destination (so the copier maps it onto the merged page), removes links whose
 * target page isn't being merged, and cuts the references that would otherwise make the
 * copier drag left-out pages along. Returns the widget annotations on merged pages, which
 * decide which form fields come across. Mutates `src`, which is a throwaway parse.
 */
function prepareSource(src: PDFDocument, resolver: DestinationResolver, selected: Set<number>, report: PdfMergeReport): Set<string> {
  const { context } = src;
  const widgets = new Set<string>();
  src.getPages().forEach((page, index) => {
    const annots = arrayAt(context, page.node, 'Annots');
    if (!selected.has(index)) {
      // A form field's widget on a left-out page is still reachable through the field's
      // /Kids; without its /P back-reference (or a button action targeting some page) the
      // copier can't follow it to a whole page that isn't being merged.
      for (const entry of annots?.asArray() ?? []) {
        const annot = resolve(context, entry);
        if (!(annot instanceof PDFDict)) continue;
        annot.delete(name('P'));
        if (resolver.targetOf(annot) !== undefined) {
          annot.delete(name('Dest'));
          annot.delete(name('A'));
        }
      }
      return;
    }
    // Article-thread beads point at other pages' beads, and so at those pages.
    page.node.delete(name('B'));
    if (!annots) return;

    const kept: PDFObject[] = [];
    for (const entry of annots.asArray()) {
      const annot = resolve(context, entry);
      if (!(annot instanceof PDFDict)) continue;
      const target = resolver.targetOf(annot);
      if (target !== undefined) {
        const action = dictAt(context, annot, 'A');
        if (target && selected.has(target.pageIndex)) {
          annot.set(name('Dest'), context.obj([src.getPage(target.pageIndex).ref, ...target.view]));
          if (action) annot.delete(name('A'));
        } else if (annot.get(name('Subtype')) === name('Link')) {
          report.linksRemoved += 1;
          continue;
        } else {
          annot.delete(name('Dest'));
          if (action) annot.delete(name('A'));
        }
      }
      if (entry instanceof PDFRef && annot.get(name('Subtype')) === name('Widget')) widgets.add(entry.toString());
      kept.push(entry);
    }
    page.node.set(name('Annots'), context.obj(kept));
  });
  return widgets;
}

/** A page listed twice gets its own page object, but its annotations need their own copies
 *  too — one annotation can't belong to two pages. Form widgets stay shared (a field's widget
 *  list can't grow here), and popups are left with the page they were made for. */
function detachAnnotations(context: PDFContext, leaf: PDFPageLeaf, ref: PDFRef): void {
  const annots = arrayAt(context, leaf, 'Annots');
  if (!annots) return;
  const fresh: PDFObject[] = [];
  for (const entry of annots.asArray()) {
    const annot = resolve(context, entry);
    if (!(annot instanceof PDFDict)) continue;
    const subtype = annot.get(name('Subtype'));
    if (subtype === name('Popup')) continue;
    if (subtype === name('Widget')) {
      fresh.push(entry);
      continue;
    }
    const clone = annot.clone(context);
    clone.set(name('P'), ref);
    clone.delete(name('Popup'));
    fresh.push(context.register(clone));
  }
  leaf.set(name('Annots'), context.obj(fresh));
}

function appendSource(
  out: PDFDocument,
  src: PDFDocument,
  plan: MergeSourcePlan,
  options: PdfMergeOptions,
  form: FormCollector,
  report: PdfMergeReport,
  isLast: boolean
): OutlineNode[] {
  const srcPages = src.getPages();
  const resolver = new DestinationResolver(src);
  const selected = new Set(plan.pages);
  const widgets = prepareSource(src, resolver, selected, report);
  if (hasSignature(src)) report.signedFiles += 1;

  const copier = PDFObjectCopier.for(src.context, out.context);
  const firstCopy = new Map<number, PDFRef>();
  const added: PDFPage[] = [];
  for (const index of plan.pages) {
    const srcPage = srcPages[index] as PDFPage;
    let ref = firstCopy.get(index);
    let leaf: PDFObject | undefined;
    if (ref === undefined) {
      // Through the reference, so a link already copied to this page and the page tree
      // agree on one copied object.
      ref = copier.copy(srcPage.ref);
      firstCopy.set(index, ref);
      leaf = out.context.lookup(ref);
    } else {
      leaf = copier.copy(srcPage.node);
      ref = out.context.register(leaf);
      if (leaf instanceof PDFPageLeaf) detachAnnotations(out.context, leaf, ref);
    }
    if (!(leaf instanceof PDFPageLeaf)) throw new Error(`page ${index + 1} isn’t a valid page object`);
    const page = PDFPage.of(leaf, ref, out);
    out.addPage(page);
    if (plan.rotation !== 0) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + plan.rotation)));
    added.push(page);
  }

  form.collect(src, copier, widgets);

  const last = added[added.length - 1];
  if (options.blankPageAfterOdd && !isLast && last && added.length % 2 === 1) {
    const { width, height } = last.getSize();
    out.addPage(normalizeAngle(last.getRotation().angle) % 180 === 90 ? [height, width] : [width, height]);
    report.blankPagesAdded += 1;
  }

  const toNode = (item: SourceOutlineItem): OutlineNode | null => {
    const children = item.children.map(toNode).filter((child): child is OutlineNode => child !== null);
    const pageRef = item.target ? firstCopy.get(item.target.pageIndex) : undefined;
    const dest = pageRef && item.target ? out.context.obj([pageRef, ...item.target.view]) : children[0]?.dest;
    return dest ? { title: item.title, dest, open: item.open, children } : null;
  };
  const kept = options.keepBookmarks ? readOutline(src, resolver).map(toNode).filter((node): node is OutlineNode => node !== null) : [];
  const first = added[0];
  if (options.fileBookmarks && first) {
    return [{ title: baseName(plan.name), dest: out.context.obj([first.ref, 'Fit']), open: true, children: kept }];
  }
  return kept;
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
      outline.push(...appendSource(out, src, source, options, form, report, position === sources.length - 1));
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

interface SamplePageText {
  kicker: string;
  title: string;
  lines: string[];
  footer: string;
}

function drawSamplePage(page: PDFPage, fonts: { bold: PDFFont; regular: PDFFont }, accent: [number, number, number], text: SamplePageText): void {
  const { width, height } = page.getSize();
  const color = rgb(...accent);
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color });
  page.drawText(text.kicker.toUpperCase(), { x: 48, y: height - 44, size: 11, font: fonts.bold, color: rgb(1, 1, 1) });
  page.drawText(text.title, { x: 48, y: height - 76, size: 22, font: fonts.bold, color: rgb(1, 1, 1) });
  text.lines.forEach((line, i) => page.drawText(line, { x: 48, y: height - 140 - i * 20, size: 12, font: fonts.regular, color: rgb(0.2, 0.23, 0.28) }));
  page.drawText(text.footer, { x: 48, y: 36, size: 9, font: fonts.regular, color: rgb(0.45, 0.48, 0.53) });
}

async function sampleDoc(title: string): Promise<{ doc: PDFDocument; fonts: { bold: PDFFont; regular: PDFFont } }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('DevMicroTools sample generator');
  return { doc, fonts: { bold: await doc.embedFont(StandardFonts.HelveticaBold), regular: await doc.embedFont(StandardFonts.Helvetica) } };
}

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
