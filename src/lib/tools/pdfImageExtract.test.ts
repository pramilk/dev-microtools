import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MIN_SIDE,
  IMAGE_FORMAT_INFO,
  baseNameOf,
  formatPages,
  imageFileName,
  isTinyImage,
  plural,
  validatePdfFile,
  zipFileName,
} from './pdfImageExtract';

describe('isTinyImage', () => {
  it('flags an image under the minimum on either side', () => {
    expect(isTinyImage({ width: 4, height: 400 })).toBe(true);
    expect(isTinyImage({ width: 400, height: DEFAULT_MIN_SIDE - 1 })).toBe(true);
    expect(isTinyImage({ width: DEFAULT_MIN_SIDE, height: DEFAULT_MIN_SIDE })).toBe(false);
  });

  it('honours a custom threshold, and 0 hides nothing', () => {
    expect(isTinyImage({ width: 100, height: 100 }, 200)).toBe(true);
    expect(isTinyImage({ width: 1, height: 1 }, 0)).toBe(false);
  });
});

describe('baseNameOf', () => {
  it('drops the .pdf extension case-insensitively', () => {
    expect(baseNameOf('Annual Report.PDF')).toBe('Annual Report');
    expect(baseNameOf('archive.tar.pdf')).toBe('archive.tar');
  });

  it('replaces characters that are illegal in file names and keeps Unicode', () => {
    expect(baseNameOf('Q3: results/final?.pdf')).toBe('Q3- results-final-');
    expect(baseNameOf('Résumé — 日本語.pdf')).toBe('Résumé — 日本語');
  });

  it('falls back to "document" for an empty name', () => {
    expect(baseNameOf('.pdf')).toBe('document');
    expect(baseNameOf('')).toBe('document');
  });
});

describe('imageFileName / zipFileName', () => {
  it('names files by first page and zero-padded number, with the right extension', () => {
    expect(imageFileName('report.pdf', { number: 3, pages: [5, 9], format: 'jpeg' }, 12)).toBe('report-p5-img03.jpg');
    expect(imageFileName('report.pdf', { number: 7, pages: [1], format: 'png' }, 1500)).toBe('report-p1-img0007.png');
    expect(imageFileName('scan.pdf', { number: 1, pages: [2], format: 'jp2' }, 1)).toBe('scan-p2-img01.jp2');
  });

  it('names the zip after the PDF', () => {
    expect(zipFileName('My Deck.pdf')).toBe('My Deck-images.zip');
  });

  it('has a MIME type and extension for every format', () => {
    for (const info of Object.values(IMAGE_FORMAT_INFO)) {
      expect(info.mime).toMatch(/^image\//);
      expect(info.extension).toMatch(/^[a-z0-9]+$/);
    }
    expect(IMAGE_FORMAT_INFO.jp2.previewable).toBe(false);
  });
});

describe('formatPages', () => {
  it('formats one page, a pair, and collapses longer runs', () => {
    expect(formatPages([3])).toBe('p. 3');
    expect(formatPages([1, 2])).toBe('pp. 1, 2');
    expect(formatPages([1, 2, 3, 4, 7, 9, 10])).toBe('pp. 1–4, 7, 9, 10');
  });

  it('handles empty input and very long runs compactly', () => {
    expect(formatPages([])).toBe('');
    expect(formatPages(Array.from({ length: 5000 }, (_, i) => i + 1))).toBe('pp. 1–5000');
  });
});

describe('plural', () => {
  it('pluralises and groups thousands', () => {
    expect(plural(1, 'image')).toBe('1 image');
    expect(plural(0, 'image')).toBe('0 images');
    expect(plural(1200, 'page')).toBe('1,200 pages');
  });
});

describe('validatePdfFile (re-exported)', () => {
  it('accepts a PDF and rejects other types and empty files', () => {
    expect(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 10 }).ok).toBe(true);
    expect(validatePdfFile({ name: 'a.png', type: 'image/png', size: 10 }).ok).toBe(false);
    expect(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 0 }).ok).toBe(false);
  });
});
