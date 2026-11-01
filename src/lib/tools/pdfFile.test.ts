import { describe, it, expect } from 'vitest';
import { MAX_PDF_FILE_SIZE, looksLikePdf, validatePdfFile } from './pdfFile';

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
