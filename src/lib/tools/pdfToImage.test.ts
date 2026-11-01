import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PDF_TO_IMAGE_SETTINGS,
  MAX_OUTPUT_PIXELS,
  MAX_OUTPUT_SIDE,
  describeSelection,
  formatPageList,
  pageImageName,
  pagesToConvert,
  planRender,
  validateSettings,
  zipNameFor,
} from './pdfToImage';
import { buildSamplePdf } from './pdfToImageSample';
import { PDFDocument } from 'pdf-lib';

const pages = (selection: 'all' | 'selected', text: string, count: number) => pagesToConvert({ selection, pages: text }, count);

describe('planRender', () => {
  it('maps 72 DPI to one pixel per point', () => {
    expect(planRender(595, 842, 72)).toEqual({ scale: 1, width: 595, height: 842, capped: false });
  });

  it('scales A4 to about 1240 × 1754 at 150 DPI and 2480 × 3508 at 300', () => {
    expect(planRender(595, 842, 150)).toMatchObject({ width: 1240, height: 1754, capped: false });
    expect(planRender(595, 842, 300)).toMatchObject({ width: 2479, height: 3508, capped: false });
  });

  it('caps a huge page so it fits the canvas limits, and says so', () => {
    const poster = planRender(3000, 4000, 300);
    expect(poster.capped).toBe(true);
    expect(poster.width * poster.height).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS * 1.001);
    expect(Math.max(poster.width, poster.height)).toBeLessThanOrEqual(MAX_OUTPUT_SIDE);
  });

  it('caps an extremely long page by its longest side', () => {
    const strip = planRender(100, 14000, 72);
    expect(strip.capped).toBe(true);
    expect(strip.height).toBeLessThanOrEqual(MAX_OUTPUT_SIDE);
  });

  it('never returns a zero-sized image', () => {
    expect(planRender(0.2, 0.2, 72)).toMatchObject({ width: 1, height: 1 });
  });
});

describe('pagesToConvert', () => {
  it('selects every page for "all"', () => {
    expect(pages('all', '', 3)).toEqual({ ok: true, value: [0, 1, 2] });
  });

  it('ignores the typed list when "all" is chosen', () => {
    expect(pages('all', '2', 3)).toEqual({ ok: true, value: [0, 1, 2] });
  });

  it('parses ranges, singles and open-ended ranges', () => {
    expect(pages('selected', '1-3, 5, 8-', 9)).toEqual({ ok: true, value: [0, 1, 2, 4, 7, 8] });
  });

  it('supports odd and even', () => {
    expect(pages('selected', 'odd', 5)).toEqual({ ok: true, value: [0, 2, 4] });
    expect(pages('selected', 'even', 5)).toEqual({ ok: true, value: [1, 3] });
  });

  it('puts pages in order and lists each once', () => {
    expect(pages('selected', '5, 1-2, 2, 5-4', 6)).toEqual({ ok: true, value: [0, 1, 3, 4] });
  });

  it('refuses an empty list rather than meaning "everything"', () => {
    const result = pages('selected', '  ', 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one page/i);
  });

  it('explains a page past the end of the document', () => {
    const result = pages('selected', '7', 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Page 7 doesn’t exist/);
  });

  it('explains page 0 and junk', () => {
    expect(pages('selected', '0', 3).ok).toBe(false);
    const junk = pages('selected', 'first', 3);
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.error).toMatch(/isn’t a page number/);
  });
});

describe('formatPageList', () => {
  it('writes runs as ranges', () => {
    expect(formatPageList([0, 1, 2, 4, 6, 7, 8])).toBe('1-3, 5, 7-9');
  });

  it('writes two neighbouring pages as a range', () => {
    expect(formatPageList([2, 3])).toBe('3-4');
  });

  it('sorts and de-duplicates', () => {
    expect(formatPageList([4, 0, 0, 1])).toBe('1-2, 5');
  });

  it('is empty for no pages, and round-trips through pagesToConvert', () => {
    expect(formatPageList([])).toBe('');
    const picked = [0, 1, 2, 5, 9, 10, 11, 12];
    expect(pages('selected', formatPageList(picked), 13)).toEqual({ ok: true, value: picked });
  });
});

describe('describeSelection', () => {
  it('reads naturally for one page and for several', () => {
    expect(describeSelection([2])).toBe('Page 3');
    expect(describeSelection([0, 1, 2, 4])).toBe('Pages 1–3, 5');
  });
});

describe('validateSettings', () => {
  it('accepts the defaults, which are JPEG', () => {
    expect(DEFAULT_PDF_TO_IMAGE_SETTINGS.format).toBe('jpeg');
    expect(validateSettings(DEFAULT_PDF_TO_IMAGE_SETTINGS).ok).toBe(true);
  });

  it('rejects an unlisted resolution and an out-of-range JPEG quality', () => {
    expect(validateSettings({ ...DEFAULT_PDF_TO_IMAGE_SETTINGS, dpi: 1234 }).ok).toBe(false);
    expect(validateSettings({ ...DEFAULT_PDF_TO_IMAGE_SETTINGS, quality: 5 }).ok).toBe(false);
    expect(validateSettings({ ...DEFAULT_PDF_TO_IMAGE_SETTINGS, quality: 101 }).ok).toBe(false);
    expect(validateSettings({ ...DEFAULT_PDF_TO_IMAGE_SETTINGS, quality: Number.NaN }).ok).toBe(false);
  });

  it('ignores quality for PNG', () => {
    expect(validateSettings({ ...DEFAULT_PDF_TO_IMAGE_SETTINGS, format: 'png', quality: 5 }).ok).toBe(true);
  });
});

describe('file names', () => {
  it('pads the page number to the document width so files sort in order', () => {
    expect(pageImageName('report.pdf', 6, 12, 'jpeg')).toBe('report-page-07.jpg');
    expect(pageImageName('report.pdf', 0, 9, 'png')).toBe('report-page-1.png');
    expect(pageImageName('report.pdf', 99, 100, 'png')).toBe('report-page-100.png');
  });

  it('makes names safe, keeps Unicode letters, and falls back for an empty base', () => {
    expect(pageImageName('Q3 report (final).PDF', 0, 1, 'jpeg')).toBe('Q3-report-final-page-1.jpg');
    expect(pageImageName('résumé.pdf', 0, 1, 'jpeg')).toBe('résumé-page-1.jpg');
    expect(pageImageName('???.pdf', 0, 1, 'jpeg')).toBe('document-page-1.jpg');
  });

  it('names the archive after the PDF', () => {
    expect(zipNameFor('Annual report.pdf')).toBe('Annual-report-images.zip');
  });
});

describe('buildSamplePdf', () => {
  it('makes a four-page A4 PDF', async () => {
    const doc = await PDFDocument.load(await buildSamplePdf());
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  });
});
