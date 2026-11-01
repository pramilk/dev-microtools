// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildSamplePdf, inspectUnlockSource, unlockPdf } from './pdfUnlockEngine';
import { buildSamplePdf as buildPlainSamplePdf, protectPdf } from './pdfProtectEngine';
import { ALL_PERMITTED, DEFAULT_PROTECT_OPTIONS } from './pdfProtect';
import { DEFAULT_UNLOCK_OPTIONS, type PdfUnlockOptions } from './pdfUnlock';
import { FIXTURE_NAMES, FIXTURE_OWNER_PASSWORD, FIXTURE_USER_PASSWORD, fixture, type FixtureName } from './pdfUnlockFixtures';

/**
 * Unlock PDF is checked against files written by pikepdf/qpdf (see `pdfUnlockFixtures.ts`) —
 * every revision from RC4 40-bit to AES-256, with and without object streams — and its output
 * is read by pdf.js with no password, so neither side of the check is this project's own code.
 */

const unlockOptions = (patch: Partial<PdfUnlockOptions> = {}): PdfUnlockOptions => ({ ...DEFAULT_UNLOCK_OPTIONS, ...patch });

async function unlockOk(bytes: Uint8Array, patch: Partial<PdfUnlockOptions> = {}) {
  const result = await unlockPdf(bytes, unlockOptions(patch));
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.value;
}

/** Text of every page and the document title, read with pdf.js and NO password. */
async function readUnprotected(bytes: Uint8Array): Promise<{ pages: string[]; title: string | undefined; author: string | undefined }> {
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  const info = (await doc.getMetadata()).info as { Title?: string; Author?: string };
  return { pages, title: info.Title, author: info.Author };
}

const CIPHER_OF: Record<string, string> = {
  'rc4-40': 'RC4 40-bit',
  'rc4-128': 'RC4 128-bit',
  'aes-128': 'AES-128',
  'aes-128-objstm': 'AES-128',
  'aes-256': 'AES-256',
  'aes-256-objstm': 'AES-256',
  'aes-256-r5': 'AES-256',
  'aes-256-r5-objstm': 'AES-256',
  'aes-256-restricted-only-objstm': 'AES-256',
};

const WITH_USER_PASSWORD = FIXTURE_NAMES.filter((name) => name !== 'aes-256-restricted-only-objstm');

describe.each(WITH_USER_PASSWORD)('unlockPdf — pikepdf fixture %s', (fixtureName: FixtureName) => {
  const source = fixture(fixtureName);

  it('describes the encryption and asks for a password', async () => {
    const result = await inspectUnlockSource(source);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({ encrypted: true, cipher: CIPHER_OF[fixtureName], needsPassword: true, unsupported: null });
    // Printing is limited to low resolution (revision 2 has no such bit), copying and editing are off.
    const expected = ['Copying text and images', 'Editing content', ...(fixtureName === 'rc4-40' ? [] : ['High-quality printing'])];
    if (result.value.encrypted) expect(result.value.restrictions).toEqual(expect.arrayContaining(expected));
  });

  it('unlocks with the open password into a file pdf.js reads with no password', async () => {
    const { bytes, report } = await unlockOk(source, { password: FIXTURE_USER_PASSWORD, confirmRestrictionRemoval: true });
    const read = await readUnprotected(bytes);
    expect(read.pages).toHaveLength(3);
    expect(read.pages[1]).toContain('Fixture page 2 secret');
    expect(read.title).toBe('Fixture title');
    expect(read.author).toBe('Fixture author');
    expect(report).toMatchObject({ pageCount: 3, cipher: CIPHER_OF[fixtureName], openedWith: 'open-password', signed: false });
    expect(report.removedRestrictions).toContain('Copying text and images');
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('/Encrypt');
  });

  it('unlocks with the permissions password, with no confirmation needed', async () => {
    const { bytes, report } = await unlockOk(source, { password: FIXTURE_OWNER_PASSWORD });
    expect(report.openedWith).toBe('permissions-password');
    expect((await readUnprotected(bytes)).pages[0]).toContain('Fixture page 1 secret');
  });

  it('asks before removing restrictions when only the open password was given', async () => {
    const result = await unlockPdf(source, unlockOptions({ password: FIXTURE_USER_PASSWORD }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/Tick .I own this document/);
  });

  it('rejects a wrong password', async () => {
    const result = await unlockPdf(source, unlockOptions({ password: 'not-it', confirmRestrictionRemoval: true }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/doesn’t open this PDF/);
  });

  it('asks for a password when none is given', async () => {
    const result = await unlockPdf(source, unlockOptions());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/needs a password/);
  });

  it('does not accept a password that merely shares a prefix or case with the real one', async () => {
    for (const password of ['user-p', 'USER-PW', 'user-pw ', 'owner']) {
      expect(await unlockPdf(source, unlockOptions({ password, confirmRestrictionRemoval: true }))).toMatchObject({ ok: false });
    }
  });
});

describe('unlockPdf — a file that only restricts permissions', () => {
  const source = fixture('aes-256-restricted-only-objstm');

  it('is reported as opening without a password, with its restrictions listed', async () => {
    const result = await inspectUnlockSource(source);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({ encrypted: true, needsPassword: false });
    if (result.value.encrypted) expect(result.value.restrictions).toEqual(expect.arrayContaining(['Copying text and images', 'Editing content']));
  });

  it('refuses until the visitor confirms they may remove the restrictions', async () => {
    const refused = await unlockPdf(source, unlockOptions());
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.error).toMatch(/I own this document/);

    const { bytes, report } = await unlockOk(source, { confirmRestrictionRemoval: true });
    expect(report.openedWith).toBe('none');
    expect(report.removedRestrictions).toEqual(expect.arrayContaining(['Copying text and images', 'Editing content']));
    expect((await readUnprotected(bytes)).pages).toHaveLength(3);
  });

  it('needs no confirmation with the permissions password', async () => {
    const { report } = await unlockOk(source, { password: FIXTURE_OWNER_PASSWORD });
    expect(report.openedWith).toBe('permissions-password');
  });
});

describe('unlockPdf — round trip through Protect PDF', () => {
  it.each(['aes256', 'aes128'] as const)('restores a file protected with %s', async (encryption) => {
    const plain = await buildPlainSamplePdf();
    const protectedResult = await protectPdf(plain, { ...DEFAULT_PROTECT_OPTIONS, userPassword: 'round-trip', encryption });
    if (!protectedResult.ok) throw new Error(protectedResult.error);
    const { bytes, report } = await unlockOk(protectedResult.value.bytes, { password: 'round-trip' });
    expect(report).toMatchObject({ pageCount: 3, openedWith: 'open-password', removedRestrictions: [] });
    const before = await readUnprotected(plain);
    const after = await readUnprotected(bytes);
    expect(after).toEqual(before);
  });

  it('handles a Unicode password under AES-256', async () => {
    const password = 'pässwörd-✓-日本語';
    const locked = await protectPdf(await buildPlainSamplePdf(), { ...DEFAULT_PROTECT_OPTIONS, userPassword: password });
    if (!locked.ok) throw new Error(locked.error);
    expect((await unlockOk(locked.value.bytes, { password })).report.pageCount).toBe(3);
    expect(await unlockPdf(locked.value.bytes, unlockOptions({ password: 'passwort' }))).toMatchObject({ ok: false });
  });

  it('restores a restricted file when the permissions password is supplied', async () => {
    const locked = await protectPdf(await buildPlainSamplePdf(), {
      ...DEFAULT_PROTECT_OPTIONS,
      userPassword: 'open-me',
      ownerPassword: 'owner-pw',
      permissions: { ...ALL_PERMITTED, copy: false, print: 'none' },
    });
    if (!locked.ok) throw new Error(locked.error);
    const { report } = await unlockOk(locked.value.bytes, { password: 'owner-pw' });
    expect(report.removedRestrictions).toEqual(['Printing', 'Copying text and images']);
  });

  it('keeps form field values and bookmarks', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField('full-name');
    field.setText('Grace Hopper');
    field.addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
    const locked = await protectPdf(await doc.save(), { ...DEFAULT_PROTECT_OPTIONS, userPassword: 'form-pw' });
    if (!locked.ok) throw new Error(locked.error);
    const { bytes } = await unlockOk(locked.value.bytes, { password: 'form-pw' });
    const reopened = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const annotations = await (await reopened.getPage(1)).getAnnotations();
    expect(annotations.map((annotation) => annotation.fieldValue)).toContain('Grace Hopper');
  });

  it('unlocks a 200-page file', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 200; i += 1) doc.addPage([200, 200]).drawText(`page ${i + 1}`);
    const locked = await protectPdf(await doc.save(), { ...DEFAULT_PROTECT_OPTIONS, userPassword: 'big-pw' });
    if (!locked.ok) throw new Error(locked.error);
    const { report } = await unlockOk(locked.value.bytes, { password: 'big-pw' });
    expect(report.pageCount).toBe(200);
  }, 30_000);
});

describe('unlockPdf — input handling', () => {
  it('rejects bytes that are not a PDF', async () => {
    const result = await unlockPdf(new TextEncoder().encode('hello, not a pdf'), unlockOptions());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/PDF header/);
  });

  it('rejects an empty file', async () => {
    expect(await unlockPdf(new Uint8Array(0), unlockOptions())).toMatchObject({ ok: false });
  });

  it('rejects a damaged PDF with a helpful message', async () => {
    const result = await unlockPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Broken'), unlockOptions());
    expect(result).toMatchObject({ ok: false });
  });

  it('says so when the PDF is not protected', async () => {
    const plain = await buildPlainSamplePdf();
    expect(await inspectUnlockSource(plain)).toEqual({ ok: true, value: { encrypted: false } });
    const result = await unlockPdf(plain, unlockOptions());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/isn’t password-protected/);
  });

  it('reports a file protected by a certificate rather than a password as unsupported', async () => {
    const locked = await protectPdf(await buildPlainSamplePdf(), { ...DEFAULT_PROTECT_OPTIONS, userPassword: 'x-pw' });
    if (!locked.ok) throw new Error(locked.error);
    // Swap the handler name in place: same length, so every offset in the file stays valid.
    const tampered = new TextEncoder().encode(new TextDecoder('latin1').decode(locked.value.bytes).replace('/Filter /Standard', '/Filter /Adobe.PPK'.padEnd(18, ' ')));
    const info = await inspectUnlockSource(tampered);
    if (!info.ok) throw new Error(info.error);
    expect(info.value).toMatchObject({ encrypted: true, unsupported: expect.stringMatching(/certificate/) });
    expect(await unlockPdf(tampered, unlockOptions({ password: 'x-pw' }))).toMatchObject({ ok: false });
  });

  it('does not modify the input bytes', async () => {
    const source = fixture('aes-256-objstm');
    const copy = source.slice();
    await unlockOk(source, { password: FIXTURE_OWNER_PASSWORD });
    expect([...source]).toEqual([...copy]);
  });

  it('leaves pdf-lib’s parser intact for later loads', async () => {
    await unlockOk(fixture('aes-128-objstm'), { password: FIXTURE_OWNER_PASSWORD });
    const doc = await PDFDocument.create();
    doc.setTitle('Packed');
    doc.addPage().drawText('still works');
    const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: true }));
    expect(reloaded.getTitle()).toBe('Packed');
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('copes with an inspect and an unlock running at the same time', async () => {
    const source = fixture('aes-128-objstm');
    const [inspected, unlocked, again] = await Promise.all([
      inspectUnlockSource(source),
      unlockPdf(source, unlockOptions({ password: FIXTURE_OWNER_PASSWORD })),
      inspectUnlockSource(fixture('rc4-40')),
    ]);
    expect(inspected).toMatchObject({ ok: true });
    expect(unlocked).toMatchObject({ ok: true });
    expect(again).toMatchObject({ ok: true });
  });
});

describe('buildSamplePdf', () => {
  it('builds a protected three-page PDF that opens with Sample-Pass-42', async () => {
    const sample = await buildSamplePdf();
    const info = await inspectUnlockSource(sample);
    expect(info).toMatchObject({ ok: true, value: { encrypted: true, cipher: 'AES-256', needsPassword: true } });
    const { bytes } = await unlockOk(sample, { password: 'Sample-Pass-42' });
    expect((await readUnprotected(bytes)).pages).toHaveLength(3);
  });
});
