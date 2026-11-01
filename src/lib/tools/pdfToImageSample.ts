import { rgb } from 'pdf-lib';
import { drawSamplePage, sampleDoc } from './pdfSamplePages';
import { SAMPLE_FILE_NAME, SAMPLE_PAGE_COUNT } from './pdfToImage';

/**
 * The PDF behind PDF to Image's "Load example": four A4 pages in the shared sample style, each
 * with a coloured block so JPEG and PNG output are easy to tell apart at a glance. The island
 * imports this lazily (it pulls in pdf-lib), only when "Load example" is pressed.
 */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const { doc, fonts } = await sampleDoc('Product brief (sample)');
  const accents: [number, number, number][] = [
    [0.04, 0.43, 0.5],
    [0.36, 0.25, 0.75],
    [0.76, 0.33, 0.1],
    [0.15, 0.5, 0.25],
  ];
  const topics = ['Overview', 'Audience', 'Roadmap', 'Next steps'];
  for (let i = 0; i < SAMPLE_PAGE_COUNT; i++) {
    const accent = accents[i] as [number, number, number];
    const page = doc.addPage([595, 842]);
    drawSamplePage(page, fonts, accent, {
      kicker: SAMPLE_FILE_NAME,
      title: `${i + 1}. ${topics[i]}`,
      lines: ['Each page of this PDF becomes its own picture.', 'Pick JPEG or PNG, a resolution, and which pages.'],
      footer: `${SAMPLE_FILE_NAME} · page ${i + 1} of ${SAMPLE_PAGE_COUNT}`,
    });
    page.drawRectangle({ x: 48, y: 300, width: 499, height: 200, color: rgb(...accent), opacity: 0.18 });
    page.drawCircle({ x: 297, y: 400, size: 70, color: rgb(...accent) });
  }
  return doc.save();
}
