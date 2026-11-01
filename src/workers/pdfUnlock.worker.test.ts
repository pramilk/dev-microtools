import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { handlePdfUnlockRequest } from './pdfUnlock.worker';
import { fixture, FIXTURE_OWNER_PASSWORD } from '../lib/tools/pdfUnlockFixtures';

describe('handlePdfUnlockRequest', () => {
  it('inspects an encrypted PDF', async () => {
    const result = await handlePdfUnlockRequest({ kind: 'inspect', bytes: fixture('aes-256') });
    expect(result).toMatchObject({ kind: 'inspect', ok: true, info: { encrypted: true, cipher: 'AES-256', needsPassword: true } });
  });

  it('inspects an unprotected PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const result = await handlePdfUnlockRequest({ kind: 'inspect', bytes: await doc.save() });
    expect(result).toEqual({ kind: 'inspect', ok: true, info: { encrypted: false } });
  });

  it('unlocks a PDF', async () => {
    const result = await handlePdfUnlockRequest({
      kind: 'unlock',
      bytes: fixture('aes-128-objstm'),
      options: { password: FIXTURE_OWNER_PASSWORD, confirmRestrictionRemoval: false },
    });
    if (result.kind !== 'unlock' || !result.ok) throw new Error('expected a successful unlock');
    expect(result.output.report).toMatchObject({ pageCount: 3, openedWith: 'permissions-password' });
    expect((await PDFDocument.load(result.output.bytes)).getPageCount()).toBe(3);
  });

  it('turns tool errors into { ok: false } results rather than throwing', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    const options = { password: '', confirmRestrictionRemoval: false };
    expect(await handlePdfUnlockRequest({ kind: 'inspect', bytes })).toMatchObject({ kind: 'inspect', ok: false });
    expect(await handlePdfUnlockRequest({ kind: 'unlock', bytes, options })).toMatchObject({ kind: 'unlock', ok: false });
    expect(await handlePdfUnlockRequest({ kind: 'unlock', bytes: fixture('rc4-128'), options: { ...options, password: 'wrong' } })).toMatchObject({ kind: 'unlock', ok: false });
  });

  it('builds the example file', async () => {
    const result = await handlePdfUnlockRequest({ kind: 'sample' });
    if (result.kind !== 'sample') throw new Error('expected a sample');
    expect(new TextDecoder('latin1').decode(result.bytes)).toContain('/Encrypt');
  });
});
