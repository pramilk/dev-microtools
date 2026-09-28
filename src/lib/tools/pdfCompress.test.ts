import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRESET,
  MAX_PDF_FILE_SIZE,
  PDF_PRESETS,
  PDF_PRESET_IDS,
  looksLikePdf,
  maxImagePixels,
  plural,
  presetMatching,
  usesJpegQuality,
  validatePdfFile,
} from './pdfCompress';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('validatePdfFile', () => {
  it('accepts a PDF by MIME type', () => {
    expect(validatePdfFile({ name: 'report.pdf', type: 'application/pdf', size: 1000 }).ok).toBe(true);
  });

  it('accepts an untyped or octet-stream file with a .pdf extension (some drag sources omit the type)', () => {
    expect(validatePdfFile({ name: 'scan.PDF', type: '', size: 10 }).ok).toBe(true);
    expect(validatePdfFile({ name: 'scan.pdf', type: 'application/octet-stream', size: 10 }).ok).toBe(true);
  });

  it('rejects other file types with a message naming the file and its type', () => {
    const result = validatePdfFile({ name: 'photo.jpg', type: 'image/jpeg', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/photo\.jpg.*image\/jpeg/);
    expect(validatePdfFile({ name: 'notes', type: '', size: 10 }).ok).toBe(false);
  });

  it('rejects empty and oversized files', () => {
    const empty = validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 0 });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/empty/);
    const huge = validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_PDF_FILE_SIZE + 1 });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.error).toMatch(/too large/);
  });

  it('handles Unicode file names in messages', () => {
    const result = validatePdfFile({ name: 'résumé 📄.docx', type: 'application/msword', size: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('résumé 📄.docx');
  });
});

describe('looksLikePdf', () => {
  it('finds the %PDF- signature at the start or after leading junk', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\n'))).toBe(true);
    expect(looksLikePdf(bytes('﻿garbage%PDF-1.4'))).toBe(true);
  });

  it('rejects empty, short, and non-PDF input, and a signature beyond the first 1 KB', () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
    expect(looksLikePdf(bytes('%PDF'))).toBe(false);
    expect(looksLikePdf(bytes('<html>'))).toBe(false);
    expect(looksLikePdf(bytes(`${'x'.repeat(2000)}%PDF-1.7`))).toBe(false);
  });
});

describe('maxImagePixels', () => {
  it('converts a DPI cap to pixels against the largest page side', () => {
    // US Letter's long side is 792pt = 11in.
    expect(maxImagePixels(150, 792)).toBe(1650);
    expect(maxImagePixels(300, 842)).toBe(3508); // A4
  });

  it('returns null when no cap is set', () => {
    expect(maxImagePixels(null, 792)).toBeNull();
    expect(maxImagePixels(0, 792)).toBeNull();
  });

  it('falls back to an 11-inch page when page size is unknown, and never goes below 16px', () => {
    expect(maxImagePixels(100, 0)).toBe(1100);
    expect(maxImagePixels(1, 10)).toBe(16);
  });
});

describe('presets', () => {
  it('recognises each preset from its own options and the default is Balanced', () => {
    for (const id of PDF_PRESET_IDS) expect(presetMatching(PDF_PRESETS[id].options)).toBe(id);
    expect(DEFAULT_PRESET).toBe('balanced');
  });

  it('reports Custom (null) once any option diverges', () => {
    expect(presetMatching({ ...PDF_PRESETS.balanced.options, quality: 0.71 })).toBeNull();
    expect(presetMatching({ ...PDF_PRESETS.strong.options, grayscale: true })).toBeNull();
  });

  it('orders presets from gentlest to strongest', () => {
    const [light, balanced, strong] = PDF_PRESET_IDS.map((id) => PDF_PRESETS[id].options);
    expect(light.quality).toBeGreaterThan(balanced.quality);
    expect(balanced.quality).toBeGreaterThan(strong.quality);
    expect(light.maxDpi ?? Infinity).toBeGreaterThan(balanced.maxDpi ?? Infinity);
    expect(balanced.maxDpi ?? Infinity).toBeGreaterThan(strong.maxDpi ?? Infinity);
  });
});

describe('usesJpegQuality / plural', () => {
  it('shows the quality slider only when some image can be JPEG', () => {
    expect(usesJpegQuality({ imageFormat: 'jpeg' })).toBe(true);
    expect(usesJpegQuality({ imageFormat: 'match' })).toBe(true);
    expect(usesJpegQuality({ imageFormat: 'lossless' })).toBe(false);
  });

  it('pluralises', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(0, 'page')).toBe('0 pages');
    expect(plural(2, 'duplicate')).toBe('2 duplicates');
  });
});
