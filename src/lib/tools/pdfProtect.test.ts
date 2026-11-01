import { describe, it, expect } from 'vitest';
import {
  ALL_PERMITTED,
  DEFAULT_PROTECT_OPTIONS,
  passwordProblem,
  permissionFlags,
  permissionsFromFlags,
  protectedFileName,
  rateOpenPassword,
  restrictionsOf,
  validateProtectOptions,
  type PdfPermissions,
  type PdfProtectOptions,
} from './pdfProtect';

const withPermissions = (patch: Partial<PdfPermissions>): PdfPermissions => ({ ...ALL_PERMITTED, ...patch });
const options = (patch: Partial<PdfProtectOptions>): PdfProtectOptions => ({ ...DEFAULT_PROTECT_OPTIONS, userPassword: 'open-me-please', ...patch });

describe('permissionFlags', () => {
  it('permits everything with the spec’s all-allowed value', () => {
    expect(permissionFlags(ALL_PERMITTED) >>> 0).toBe(0xfffffffc);
  });

  it('clears exactly one bit per revoked permission', () => {
    const flags = (patch: Partial<PdfPermissions>) => permissionFlags(withPermissions(patch));
    const all = 0xfffffffc | 0;
    expect(flags({ copy: false })).toBe(all & ~(1 << 4));
    expect(flags({ edit: false })).toBe(all & ~(1 << 3));
    expect(flags({ annotate: false })).toBe(all & ~(1 << 5));
    expect(flags({ fillForms: false })).toBe(all & ~(1 << 8));
    expect(flags({ accessibility: false })).toBe(all & ~(1 << 9));
    expect(flags({ assemble: false })).toBe(all & ~(1 << 10));
    expect(flags({ print: 'low' })).toBe(all & ~(1 << 11));
    expect(flags({ print: 'none' })).toBe(all & ~(1 << 11) & ~(1 << 2));
  });

  it('always keeps the reserved bits set and returns a signed 32-bit integer', () => {
    const value = permissionFlags({ print: 'none', copy: false, edit: false, annotate: false, fillForms: false, assemble: false, accessibility: false });
    expect(((value >>> 0) & 0xfffff0c0) >>> 0).toBe(0xfffff0c0);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeLessThan(0);
    expect(value).toBeGreaterThanOrEqual(-(2 ** 31));
  });
});

describe('restrictionsOf', () => {
  it('is empty when nothing is restricted', () => {
    expect(restrictionsOf(ALL_PERMITTED)).toEqual([]);
  });

  it('names each restriction', () => {
    expect(restrictionsOf(withPermissions({ print: 'none', copy: false }))).toEqual(['Printing', 'Copying text and images']);
    expect(restrictionsOf(withPermissions({ print: 'low' }))).toEqual(['High-quality printing']);
    expect(restrictionsOf(withPermissions({ edit: false, annotate: false, fillForms: false, assemble: false, accessibility: false }))).toHaveLength(5);
  });
});

describe('passwordProblem', () => {
  it('accepts ordinary and empty passwords for both encryptions', () => {
    expect(passwordProblem('hunter2', 'aes256', 'open password')).toBeNull();
    expect(passwordProblem('hunter2', 'aes128', 'open password')).toBeNull();
    expect(passwordProblem('', 'aes128', 'open password')).toBeNull();
  });

  it('accepts Unicode under AES-256 but rejects what AES-128 cannot store', () => {
    expect(passwordProblem('pässwörd✓😀', 'aes256', 'open password')).toBeNull();
    expect(passwordProblem('pässwörd', 'aes128', 'open password')).toBeNull();
    expect(passwordProblem('pass✓', 'aes128', 'open password')).toMatch(/Latin-1/);
    expect(passwordProblem('😀', 'aes128', 'open password')).toMatch(/Latin-1/);
  });

  it('rejects over-long passwords', () => {
    expect(passwordProblem('a'.repeat(33), 'aes128', 'open password')).toMatch(/32 characters/);
    expect(passwordProblem('a'.repeat(32), 'aes128', 'open password')).toBeNull();
    expect(passwordProblem('a'.repeat(128), 'aes256', 'permissions password')).toMatch(/permissions password.*127/);
    expect(passwordProblem('a'.repeat(127), 'aes256', 'open password')).toBeNull();
    // Counted in bytes, not characters.
    expect(passwordProblem('é'.repeat(64), 'aes256', 'open password')).toMatch(/127/);
  });
});

describe('validateProtectOptions', () => {
  it('accepts an open password alone', () => {
    expect(validateProtectOptions(options({}))).toMatchObject({ ok: true });
  });

  it('accepts restrictions alone, with no open password', () => {
    expect(validateProtectOptions(options({ userPassword: '', permissions: withPermissions({ copy: false }) }))).toMatchObject({ ok: true });
  });

  it('rejects options that would protect nothing', () => {
    const result = validateProtectOptions(options({ userPassword: '' }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/open password.*restrict/);
  });

  it('rejects a permissions password equal to the open password when permissions are restricted', () => {
    const result = validateProtectOptions(options({ ownerPassword: 'open-me-please', permissions: withPermissions({ edit: false }) }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/must differ/);
  });

  it('allows equal passwords when nothing is restricted', () => {
    expect(validateProtectOptions(options({ ownerPassword: 'open-me-please' }))).toMatchObject({ ok: true });
  });

  it('reports a password problem for the offending field', () => {
    const result = validateProtectOptions(options({ encryption: 'aes128', ownerPassword: 'owner✓' }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/permissions password/);
  });
});

describe('rateOpenPassword', () => {
  it('returns null for an empty password', () => {
    expect(rateOpenPassword('')).toBeNull();
  });

  it('rates by length first, then variety', () => {
    expect(rateOpenPassword('abc123')?.label).toBe('Weak');
    expect(rateOpenPassword('Abcdef1!')?.label).toBe('Fair');
    expect(rateOpenPassword('abcdefghij')?.label).toBe('Fair');
    expect(rateOpenPassword('Abcdefgh1!xy')?.label).toBe('Strong');
    expect(rateOpenPassword('correct horse battery')?.label).toBe('Strong');
  });

  it('counts a non-BMP character once', () => {
    expect(rateOpenPassword('😀'.repeat(8))?.label).toBe('Weak');
  });
});

describe('protectedFileName', () => {
  it('replaces the .pdf extension', () => {
    expect(protectedFileName('report.pdf')).toBe('report-protected.pdf');
    expect(protectedFileName('Report.PDF')).toBe('Report-protected.pdf');
  });

  it('handles a missing extension and an empty name', () => {
    expect(protectedFileName('report')).toBe('report-protected.pdf');
    expect(protectedFileName('.pdf')).toBe('document-protected.pdf');
  });
});

describe('permissionsFromFlags', () => {
  it('inverts permissionFlags for every combination', () => {
    const prints = ['full', 'low', 'none'] as const;
    for (const print of prints) {
      for (let mask = 0; mask < 32; mask += 1) {
        const permissions: PdfPermissions = {
          print,
          copy: (mask & 1) !== 0,
          edit: (mask & 2) !== 0,
          annotate: (mask & 4) !== 0,
          fillForms: (mask & 8) !== 0,
          assemble: (mask & 16) !== 0,
          accessibility: mask % 3 === 0,
        };
        expect(permissionsFromFlags(permissionFlags(permissions), 3)).toEqual(permissions);
      }
    }
  });

  it('reads revision 2 files, which only define print, modify, copy and annotate', () => {
    // Bit 3 only (print): everything else off in the file, but R2 never restricted the rest.
    expect(permissionsFromFlags(0xfffff0c0 | 4, 2)).toEqual({
      print: 'full',
      edit: false,
      copy: false,
      annotate: false,
      fillForms: true,
      accessibility: true,
      assemble: true,
    });
  });

  it('treats print-without-the-high-quality-bit as low resolution from revision 3', () => {
    expect(permissionsFromFlags(0xfffff0c0 | 4, 3).print).toBe('low');
    expect(permissionsFromFlags(0xfffff0c0 | 4 | 2048, 3).print).toBe('full');
    expect(permissionsFromFlags(0xfffff0c0, 6).print).toBe('none');
  });

  it('accepts the unsigned 32-bit spelling some writers use', () => {
    expect(permissionsFromFlags(0xfffffffc, 3)).toEqual(ALL_PERMITTED);
  });
});
