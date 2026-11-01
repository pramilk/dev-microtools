// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildSamplePdf, inspectProtectSource, protectPdf } from './pdfProtectEngine';
import { ALL_PERMITTED, DEFAULT_PROTECT_OPTIONS, type PdfPermissions, type PdfProtectOptions } from './pdfProtect';

/**
 * The cipher is checked two ways: `pdfCrypto.test.ts` re-derives keys with the spec's reader-side
 * algorithms, and these tests open the finished files with pdf.js — a separate implementation
 * of the security handler — so a misreading of the spec shared by writer and test can't hide.
 * (pypdf was also run against the same output by hand while building this.)
 */

const options = (patch: Partial<PdfProtectOptions> = {}): PdfProtectOptions => ({ ...DEFAULT_PROTECT_OPTIONS, userPassword: 'open-me', ownerPassword: 'owner-pw', ...patch });
const restrict = (patch: Partial<PdfPermissions>): PdfPermissions => ({ ...ALL_PERMITTED, ...patch });

async function protectOk(source: Uint8Array, patch: Partial<PdfProtectOptions> = {}) {
  const result = await protectPdf(source, options(patch));
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.value;
}

/** Opens with pdf.js; resolves to the text of every page, or the exception name on failure. */
async function readWithPdfjs(bytes: Uint8Array, password?: string): Promise<{ pages: string[]; title: string | undefined } | { failure: string }> {
  try {
    const doc = await getDocument({ data: new Uint8Array(bytes), password, verbosity: 0 }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    const info = (await doc.getMetadata()).info as { Title?: string };
    return { pages, title: info.Title };
  } catch (thrown: unknown) {
    return { failure: thrown instanceof Error ? thrown.name : String(thrown) };
  }
}

const sample = await buildSamplePdf();

describe.each(['aes256', 'aes128'] as const)('protectPdf (%s)', (encryption) => {
  it('produces a file pdf.js opens with the open password and rejects without it', async () => {
    const { bytes } = await protectOk(sample, { encryption });
    expect(await readWithPdfjs(bytes)).toEqual({ failure: 'PasswordException' });
    expect(await readWithPdfjs(bytes, 'wrong')).toEqual({ failure: 'PasswordException' });
    const opened = await readWithPdfjs(bytes, 'open-me');
    if ('failure' in opened) throw new Error(opened.failure);
    expect(opened.pages).toHaveLength(3);
    expect(opened.pages[1]).toContain('Salary bands');
    expect(opened.title).toBe('Quarterly report (sample)');
  });

  it('also opens with the permissions password', async () => {
    const { bytes } = await protectOk(sample, { encryption });
    expect(await readWithPdfjs(bytes, 'owner-pw')).toMatchObject({ pages: expect.any(Array) });
  });

  it('leaves no readable text, titles or metadata in the file', async () => {
    const { bytes } = await protectOk(sample, { encryption });
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).not.toContain('Quarterly report');
    expect(raw).not.toContain('DevMicroTools sample generator');
    expect(raw).toContain('/Encrypt');
    expect(raw).toContain(encryption === 'aes256' ? '/AESV3' : '/AESV2');
  });

  it('opens without a password when only restrictions are set', async () => {
    const { bytes, report } = await protectOk(sample, { encryption, userPassword: '', permissions: restrict({ copy: false }) });
    expect(report.openPassword).toBe(false);
    expect(await readWithPdfjs(bytes)).toMatchObject({ pages: expect.any(Array) });
  });

  it('works without a permissions password by generating one nobody knows', async () => {
    const { bytes, report } = await protectOk(sample, { encryption, ownerPassword: '', permissions: restrict({ edit: false }) });
    expect(report.generatedOwnerPassword).toBe(true);
    expect(await readWithPdfjs(bytes, 'open-me')).toMatchObject({ pages: expect.any(Array) });
    expect(await readWithPdfjs(bytes, '')).toEqual({ failure: 'PasswordException' });
  });

  it('writes the chosen permissions into /P', async () => {
    const { bytes } = await protectOk(sample, { encryption, permissions: restrict({ copy: false, print: 'low' }) });
    const raw = new TextDecoder('latin1').decode(bytes);
    // 0xfffff7ec as a signed 32-bit integer.
    expect(raw).toMatch(/\/P -2068\b/);
  });

  it('reports what was applied', async () => {
    const { report } = await protectOk(sample, { encryption, permissions: restrict({ print: 'none', edit: false }) });
    expect(report).toMatchObject({
      pageCount: 3,
      originalBytes: sample.length,
      encryption,
      openPassword: true,
      generatedOwnerPassword: false,
      restrictions: ['Printing', 'Editing content'],
      signed: false,
    });
    expect(report.outputBytes).toBeGreaterThan(0);
  });

  it('handles Unicode passwords', async () => {
    // AES-128 is limited to Latin-1, so use a password both can store.
    const password = encryption === 'aes256' ? 'pässwörd-✓-日本語' : 'pässwörd-é';
    const { bytes } = await protectOk(sample, { encryption, userPassword: password, ownerPassword: 'x'.repeat(5) });
    expect(await readWithPdfjs(bytes, password)).toMatchObject({ pages: expect.any(Array) });
    expect(await readWithPdfjs(bytes, 'passwort')).toEqual({ failure: 'PasswordException' });
  });

  it('handles a long password at the limit', async () => {
    const password = 'p'.repeat(encryption === 'aes256' ? 127 : 32);
    const { bytes } = await protectOk(sample, { encryption, userPassword: password });
    expect(await readWithPdfjs(bytes, password)).toMatchObject({ pages: expect.any(Array) });
  });

  it('keeps metadata, outlines and form fields readable once opened', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Form with ünïcode');
    doc.setAuthor('Ada');
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField('full-name');
    field.setText('Grace Hopper');
    field.addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
    const { bytes } = await protectOk(await doc.save(), { encryption });
    const opened = await readWithPdfjs(bytes, 'open-me');
    if ('failure' in opened) throw new Error(opened.failure);
    expect(opened.title).toBe('Form with ünïcode');
    const reopened = await getDocument({ data: new Uint8Array(bytes), password: 'open-me', verbosity: 0 }).promise;
    const fields = await (await reopened.getPage(1)).getAnnotations();
    expect(fields.map((annotation) => annotation.fieldValue)).toContain('Grace Hopper');
  });

  it('encrypts a file with many pages', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 200; i += 1) doc.addPage([200, 200]).drawText(`page ${i + 1}`);
    const { bytes, report } = await protectOk(await doc.save(), { encryption });
    expect(report.pageCount).toBe(200);
    const opened = await readWithPdfjs(bytes, 'open-me');
    if ('failure' in opened) throw new Error(opened.failure);
    expect(opened.pages).toHaveLength(200);
    expect(opened.pages[199]).toContain('page 200');
  }, 30_000);

  it('encrypts a source that uses object streams (a file saved by a modern PDF app)', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Packed');
    doc.addPage().drawText('inside an object stream');
    const packed = await doc.save({ useObjectStreams: true });
    expect(new TextDecoder('latin1').decode(packed)).toContain('/ObjStm');
    const { bytes } = await protectOk(packed, { encryption });
    const opened = await readWithPdfjs(bytes, 'open-me');
    if ('failure' in opened) throw new Error(opened.failure);
    expect(opened.title).toBe('Packed');
    expect(opened.pages[0]).toContain('inside an object stream');
  });
});

describe('protectPdf — input handling', () => {
  it('rejects bytes that are not a PDF', async () => {
    const result = await protectPdf(new TextEncoder().encode('hello, not a pdf'), options());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/PDF header/);
  });

  it('rejects an empty file', async () => {
    expect(await protectPdf(new Uint8Array(0), options())).toMatchObject({ ok: false });
  });

  it('rejects a damaged PDF with a helpful message', async () => {
    const result = await protectPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Broken'), options());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/damaged|couldn’t|unexpected/i);
  });

  it('rejects a PDF with no pages', async () => {
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    const result = await protectPdf(empty, options());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/no pages/);
  });

  it('refuses a PDF that is already protected, pointing at what to do', async () => {
    const { bytes } = await protectOk(sample);
    const result = await protectPdf(bytes, options());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/already password-protected/);
    expect(await inspectProtectSource(bytes)).toMatchObject({ ok: false });
  });

  it('rejects options that protect nothing, before reading the file', async () => {
    const result = await protectPdf(new Uint8Array(0), options({ userPassword: '' }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/open password/);
  });

  it('flags a digitally signed source', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const sig = doc.context.register(doc.context.obj({ FT: 'Sig', T: PDFString.of('Signature1'), V: doc.context.obj({ Type: 'Sig' }) }));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [sig], SigFlags: 3 }));
    const signed = await doc.save();
    expect(await inspectProtectSource(signed)).toEqual({ ok: true, value: { pageCount: 1, signed: true } });
    const { report } = await protectOk(signed);
    expect(report.signed).toBe(true);
  });

  it('does not modify the input bytes', async () => {
    const copy = sample.slice();
    await protectOk(sample);
    expect([...sample]).toEqual([...copy]);
  });

  it('creates a trailer /ID when the source has none (AES-128 mixes it into the key)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('no id');
    const plain = await doc.save();
    expect(new TextDecoder('latin1').decode(plain)).not.toContain('/ID');
    const { bytes } = await protectOk(plain, { encryption: 'aes128' });
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/ID');
    expect(await readWithPdfjs(bytes, 'open-me')).toMatchObject({ pages: expect.any(Array) });
  });

  it('never encrypts the /Encrypt dictionary’s own strings', async () => {
    const { bytes } = await protectOk(sample);
    const reloaded = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const encrypt = reloaded.context.lookup(reloaded.context.trailerInfo.Encrypt, PDFDict);
    expect(encrypt.get(PDFName.of('Filter'))).toBe(PDFName.of('Standard'));
    expect(encrypt.lookup(PDFName.of('U'))).toBeDefined();
  });
});

describe('inspectProtectSource', () => {
  it('reports the page count of a plain PDF', async () => {
    expect(await inspectProtectSource(sample)).toEqual({ ok: true, value: { pageCount: 3, signed: false } });
  });

  it('rejects a non-PDF', async () => {
    expect(await inspectProtectSource(new TextEncoder().encode('plain text'))).toMatchObject({ ok: false });
  });
});

describe('buildSamplePdf', () => {
  it('builds a readable three-page PDF', async () => {
    const opened = await readWithPdfjs(sample);
    if ('failure' in opened) throw new Error(opened.failure);
    expect(opened.pages).toHaveLength(3);
  });
});
