import { type ToolResult, ok, err } from './result';

/**
 * File-level checks shared by every PDF tool (PDF Compressor, Merge PDF) — deliberately free
 * of any pdf-lib import, since islands import this module on page load to vet a chosen file
 * before any bytes are handed to a worker.
 */

/** Everything happens in the tab's memory (the source, pdf-lib's parsed object graph and the
 *  rewritten output all at once), so this bounds peak memory rather than being arbitrary. */
export const MAX_PDF_FILE_SIZE = 150 * 1024 * 1024;

/** Every PDF begins with `%PDF-` — within the first 1 KB, since the spec tolerates leading
 *  junk (some generators prepend a BOM or a mail header). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

/**
 * Checks a chosen file before any bytes are read. Like the image tools, a file with no
 * declared `type` (some drag sources omit it) is judged by its extension instead of being
 * rejected outright — the `%PDF-` signature check in `looksLikePdf` is the real gate.
 */
export function validatePdfFile(file: { type: string; size: number; name: string }): ToolResult<true> {
  const isPdfType = file.type === 'application/pdf' || file.type === 'application/x-pdf';
  const hasPdfExtension = /\.pdf$/i.test(file.name);
  if (!isPdfType && !(file.type === '' && hasPdfExtension) && !(file.type === 'application/octet-stream' && hasPdfExtension)) {
    return err(`"${file.name}" isn't a PDF${file.type ? ` (it's ${file.type})` : ''} — choose a .pdf file instead.`);
  }
  if (file.size === 0) {
    return err(`"${file.name}" is empty (0 bytes) — the download or export that produced it probably failed.`);
  }
  if (file.size > MAX_PDF_FILE_SIZE) {
    return err(
      `That PDF is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB, limit ${MAX_PDF_FILE_SIZE / (1024 * 1024)} MB) — split it into smaller parts first.`
    );
  }
  return ok(true);
}
