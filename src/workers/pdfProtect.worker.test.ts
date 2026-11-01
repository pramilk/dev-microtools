import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfProtectRequest } from './pdfProtect.worker';
import { ALL_PERMITTED, DEFAULT_PROTECT_OPTIONS } from '../lib/tools/pdfProtect';

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  return doc.save();
}

const options = { ...DEFAULT_PROTECT_OPTIONS, userPassword: 'open-me', permissions: ALL_PERMITTED };

describe('handlePdfProtectRequest', () => {
  it('inspects a PDF', async () => {
    const result = await handlePdfProtectRequest({ kind: 'inspect', bytes: await onePagePdf() });
    expect(result).toEqual({ kind: 'inspect', ok: true, info: { pageCount: 1, signed: false } });
  });

  it('protects a PDF', async () => {
    const result = await handlePdfProtectRequest({ kind: 'protect', bytes: await onePagePdf(), options });
    if (result.kind !== 'protect' || !result.ok) throw new Error('expected a successful protect');
    expect(result.output.report).toMatchObject({ pageCount: 1, encryption: 'aes256', openPassword: true });
    expect(new TextDecoder('latin1').decode(result.output.bytes)).toContain('/Encrypt');
  });

  it('turns tool errors into { ok: false } results rather than throwing', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    expect(await handlePdfProtectRequest({ kind: 'inspect', bytes })).toMatchObject({ kind: 'inspect', ok: false });
    expect(await handlePdfProtectRequest({ kind: 'protect', bytes, options })).toMatchObject({ kind: 'protect', ok: false });
    expect(await handlePdfProtectRequest({ kind: 'protect', bytes: await onePagePdf(), options: { ...options, userPassword: '' } })).toMatchObject({ kind: 'protect', ok: false });
  });

  it('builds the example file', async () => {
    const result = await handlePdfProtectRequest({ kind: 'sample' });
    if (result.kind !== 'sample') throw new Error('expected a sample');
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3);
  });
});
