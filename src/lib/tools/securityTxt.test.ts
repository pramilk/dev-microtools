import { describe, expect, it, vi, afterEach } from 'vitest';
import { EMPTY_SECURITY_TXT, buildSecurityTxt, normalizeContactUri, type SecurityTxtFields } from './securityTxt';

const fields = (overrides: Partial<SecurityTxtFields> = {}): SecurityTxtFields => ({
  ...EMPTY_SECURITY_TXT,
  contacts: ['security@example.com'],
  expires: '2099-01-01',
  ...overrides,
});

describe('normalizeContactUri', () => {
  it('adds mailto: to a bare email', () => {
    expect(normalizeContactUri('security@example.com')).toEqual({ ok: true, value: 'mailto:security@example.com' });
  });

  it('adds tel: to a bare phone number', () => {
    expect(normalizeContactUri('+1 201-555-0123')).toEqual({ ok: true, value: 'tel:+12015550123' });
  });

  it('leaves an already-prefixed mailto: alone', () => {
    expect(normalizeContactUri('mailto:security@example.com')).toEqual({ ok: true, value: 'mailto:security@example.com' });
  });

  it('accepts a bare https URL', () => {
    expect(normalizeContactUri('https://example.com/report')).toEqual({ ok: true, value: 'https://example.com/report' });
  });

  it('rejects an empty entry', () => {
    expect(normalizeContactUri('  ').ok).toBe(false);
  });

  it('rejects unrecognizable text', () => {
    expect(normalizeContactUri('just some text').ok).toBe(false);
  });

  it('rejects a malformed https URL', () => {
    expect(normalizeContactUri('https://').ok).toBe(false);
  });
});

describe('buildSecurityTxt', () => {
  it('rejects when there are no contacts', () => {
    const result = buildSecurityTxt(fields({ contacts: ['', '  '] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Contact');
  });

  it('rejects when Expires is blank', () => {
    const result = buildSecurityTxt(fields({ expires: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Expires');
  });

  it('rejects an invalid Expires date', () => {
    const result = buildSecurityTxt(fields({ expires: 'not-a-date' }));
    expect(result.ok).toBe(false);
  });

  it('builds a minimal valid file with Contact and Expires', () => {
    const result = buildSecurityTxt(fields());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain('Contact: mailto:security@example.com');
    expect(result.value.content).toContain('Expires: 2099-01-01T00:00:00Z');
    expect(result.value.content.endsWith('\n')).toBe(true);
  });

  it('normalizes multiple contacts and preserves their order', () => {
    const result = buildSecurityTxt(fields({ contacts: ['security@example.com', 'https://example.com/report', '+1 201-555-0123'] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.content.split('\n');
    expect(lines[0]).toBe('Contact: mailto:security@example.com');
    expect(lines[1]).toBe('Contact: https://example.com/report');
    expect(lines[2]).toBe('Contact: tel:+12015550123');
  });

  it('propagates a normalization error from a malformed contact', () => {
    const result = buildSecurityTxt(fields({ contacts: ['not a contact at all'] }));
    expect(result.ok).toBe(false);
  });

  it('includes optional URL fields only when set, and validates them', () => {
    const withFields = buildSecurityTxt(
      fields({
        encryption: 'https://example.com/pgp-key.txt',
        acknowledgments: 'https://example.com/hall-of-fame',
        policy: 'https://example.com/security-policy',
        hiring: 'https://example.com/jobs/security',
        csaf: 'https://example.com/.well-known/csaf/provider-metadata.json',
      })
    );
    expect(withFields.ok).toBe(true);
    if (withFields.ok) {
      expect(withFields.value.content).toContain('Encryption: https://example.com/pgp-key.txt');
      expect(withFields.value.content).toContain('Acknowledgments: https://example.com/hall-of-fame');
      expect(withFields.value.content).toContain('Policy: https://example.com/security-policy');
      expect(withFields.value.content).toContain('Hiring: https://example.com/jobs/security');
      expect(withFields.value.content).toContain('CSAF: https://example.com/.well-known/csaf/provider-metadata.json');
    }

    const withoutFields = buildSecurityTxt(fields());
    expect(withoutFields.ok).toBe(true);
    if (withoutFields.ok) {
      expect(withoutFields.value.content).not.toContain('Encryption:');
      expect(withoutFields.value.content).not.toContain('Policy:');
    }
  });

  it('rejects a malformed optional URL field', () => {
    const result = buildSecurityTxt(fields({ policy: 'not-a-url' }));
    expect(result.ok).toBe(false);
  });

  it('emits one Canonical line per non-empty line of input', () => {
    const result = buildSecurityTxt(
      fields({ canonical: 'https://example.com/.well-known/security.txt\nhttps://example.com/security.txt' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain('Canonical: https://example.com/.well-known/security.txt');
    expect(result.value.content).toContain('Canonical: https://example.com/security.txt');
  });

  it('rejects a malformed canonical URL', () => {
    const result = buildSecurityTxt(fields({ canonical: 'not-a-url' }));
    expect(result.ok).toBe(false);
  });

  it('joins valid preferred languages with a comma', () => {
    const result = buildSecurityTxt(fields({ preferredLanguages: 'en, es , pt-BR' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toContain('Preferred-Languages: en, es, pt-BR');
  });

  it('rejects a malformed language tag', () => {
    const result = buildSecurityTxt(fields({ preferredLanguages: 'english' }));
    expect(result.ok).toBe(false);
  });

  it('warns when no canonical URL is given', () => {
    const result = buildSecurityTxt(fields());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.some((w) => w.includes('No Canonical URL'))).toBe(true);
  });

  it('does not warn about canonical once one is given', () => {
    const result = buildSecurityTxt(fields({ canonical: 'https://example.com/.well-known/security.txt' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.some((w) => w.includes('No Canonical URL'))).toBe(false);
  });

  describe('Expires warnings', () => {
    afterEach(() => vi.useRealTimers());

    it('warns when Expires is in the past', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2100-01-01T00:00:00Z'));
      const result = buildSecurityTxt(fields({ expires: '2099-01-01' }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.warnings.some((w) => w.includes('in the past'))).toBe(true);
    });

    it('warns when Expires is more than a year out', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const result = buildSecurityTxt(fields({ expires: '2028-01-01' }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.warnings.some((w) => w.includes('more than a year out'))).toBe(true);
    });

    it('does not warn for an Expires date within the next year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const result = buildSecurityTxt(fields({ expires: '2026-06-01', canonical: 'https://example.com/.well-known/security.txt' }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.warnings).toEqual([]);
    });
  });
});
