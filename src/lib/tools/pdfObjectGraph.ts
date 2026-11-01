import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFContext, type PDFObject } from 'pdf-lib';

/** Object-graph housekeeping shared by the pdf-lib engines (worker-only, like them). */

/**
 * Deletes every object no longer reachable from the trailer — in PDF Compressor, superseded
 * versions left behind by incremental saves, detached XMP/thumbnail streams, merged
 * duplicates and replaced image streams; in Merge PDF, anything a page dragged along that
 * the merged document no longer points at. A valid PDF reaches everything it renders
 * from `/Root` (or `/Info`), so this can never drop visible content.
 */
export function removeUnreachableObjects(context: PDFContext): number {
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const entry of [Root, Info, Encrypt]) if (entry) stack.push(entry);

  while (stack.length > 0) {
    const object = stack.pop();
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) {
      stack.push(...object.values());
    } else if (object instanceof PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref);
      removed += 1;
    }
  }
  return removed;
}
