import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * The page style every PDF tool's "Load example" uses — a coloured header band with a kicker
 * and title, a few lines of body text and a footer — so the generated samples look like one
 * family. Imported only from workers, alongside the engines that build the samples.
 */

export interface SamplePageText {
  kicker: string;
  title: string;
  lines: string[];
  footer: string;
}

export function drawSamplePage(page: PDFPage, fonts: { bold: PDFFont; regular: PDFFont }, accent: [number, number, number], text: SamplePageText): void {
  const { width, height } = page.getSize();
  const color = rgb(...accent);
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color });
  page.drawText(text.kicker.toUpperCase(), { x: 48, y: height - 44, size: 11, font: fonts.bold, color: rgb(1, 1, 1) });
  page.drawText(text.title, { x: 48, y: height - 76, size: 22, font: fonts.bold, color: rgb(1, 1, 1) });
  text.lines.forEach((line, i) => page.drawText(line, { x: 48, y: height - 140 - i * 20, size: 12, font: fonts.regular, color: rgb(0.2, 0.23, 0.28) }));
  page.drawText(text.footer, { x: 48, y: 36, size: 9, font: fonts.regular, color: rgb(0.45, 0.48, 0.53) });
}

export async function sampleDoc(title: string): Promise<{ doc: PDFDocument; fonts: { bold: PDFFont; regular: PDFFont } }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('DevMicroTools sample generator');
  return { doc, fonts: { bold: await doc.embedFont(StandardFonts.HelveticaBold), regular: await doc.embedFont(StandardFonts.Helvetica) } };
}
