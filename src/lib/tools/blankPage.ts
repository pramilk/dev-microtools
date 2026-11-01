/**
 * Blank-page detection by ink coverage — how much of a drawn page is dark enough to be
 * content. Pure, so it's unit-testable; the drawing itself happens in the island (pdf.js).
 */

/** A pixel this dark (0-255 luminance) or darker counts as ink. Scanned paper is usually
 *  220-250; text, even faint pencil, is well below 200. */
export const INK_LUMINANCE = 200;
/** A page with less than this share of ink pixels counts as blank — enough to ignore scanner
 *  dust and specks, not enough to hide a page number or a single line of text. */
export const BLANK_INK_RATIO = 0.0015;
/** The outer share of each side ignored when measuring, where scans pick up dark borders and
 *  punched-hole shadows. */
export const BLANK_EDGE_MARGIN = 0.05;

/** The share of pixels that are ink in an RGBA image, ignoring a margin around its edge. */
export function inkCoverage(data: ArrayLike<number>, width: number, height: number, margin = BLANK_EDGE_MARGIN): number {
  const left = Math.floor(width * margin);
  const top = Math.floor(height * margin);
  let ink = 0;
  let total = 0;
  for (let y = top; y < height - top; y++) {
    for (let x = left; x < width - left; x++) {
      const i = (y * width + x) * 4;
      const alpha = (data[i + 3] ?? 255) / 255;
      // Transparent pixels are paper: composite over white before judging.
      const luminance = 255 - alpha * (255 - (0.299 * (data[i] ?? 255) + 0.587 * (data[i + 1] ?? 255) + 0.114 * (data[i + 2] ?? 255)));
      if (luminance <= INK_LUMINANCE) ink += 1;
      total += 1;
    }
  }
  return total === 0 ? 0 : ink / total;
}

export const looksBlank = (coverage: number): boolean => coverage < BLANK_INK_RATIO;
