import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  generatePasswords,
  passwordEntropyBits,
  passwordStrength,
  DEFAULT_PASSWORD_OPTIONS,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_BATCH,
  type PasswordOptions,
} from './password';

const options = (overrides: Partial<PasswordOptions> = {}): PasswordOptions => ({
  ...DEFAULT_PASSWORD_OPTIONS,
  ...overrides,
});

describe('generatePassword', () => {
  it('produces a password of the requested length', () => {
    const result = generatePassword(options({ length: 32 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(32);
  });

  it('rejects a length below the minimum', () => {
    expect(generatePassword(options({ length: 3 })).ok).toBe(false);
  });

  it('rejects a length above the maximum', () => {
    expect(generatePassword(options({ length: MAX_PASSWORD_LENGTH + 1 })).ok).toBe(false);
  });

  it('rejects a fractional length', () => {
    expect(generatePassword(options({ length: 12.5 })).ok).toBe(false);
  });

  it('rejects when no character type is selected', () => {
    const result = generatePassword(
      options({ uppercase: false, lowercase: false, numbers: false, symbols: false })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one/i);
  });

  it('only uses lowercase letters when that is the only type selected', () => {
    const result = generatePassword(
      options({ length: 50, uppercase: false, lowercase: true, numbers: false, symbols: false })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[a-z]+$/);
  });

  it('only uses numbers when that is the only type selected', () => {
    const result = generatePassword(
      options({ length: 50, uppercase: false, lowercase: false, numbers: true, symbols: false })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[0-9]+$/);
  });

  it('only uses symbols when that is the only type selected', () => {
    const result = generatePassword(
      options({ length: 50, uppercase: false, lowercase: false, numbers: false, symbols: true })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[!@#$%^&*()\-_=+[\]{};:,.<>?/~]+$/);
  });

  it('excludes ambiguous characters when asked', () => {
    const result = generatePassword(options({ length: 100, excludeAmbiguous: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toMatch(/[0O1lI|]/);
  });

  it('does not repeat across many draws', () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => {
        const result = generatePassword(options({ length: 24 }));
        return result.ok ? result.value : '';
      })
    );
    expect(seen.size).toBe(200);
  });
});

describe('generatePasswords', () => {
  it('generates the requested count', () => {
    const result = generatePasswords(10, DEFAULT_PASSWORD_OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(10);
  });

  it('rejects zero or negative counts', () => {
    expect(generatePasswords(0, DEFAULT_PASSWORD_OPTIONS).ok).toBe(false);
    expect(generatePasswords(-1, DEFAULT_PASSWORD_OPTIONS).ok).toBe(false);
  });

  it('caps the batch size', () => {
    const result = generatePasswords(MAX_PASSWORD_BATCH + 1, DEFAULT_PASSWORD_OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(String(MAX_PASSWORD_BATCH));
  });

  it('propagates an invalid-options error rather than a partial batch', () => {
    const result = generatePasswords(5, options({ uppercase: false, lowercase: false, numbers: false, symbols: false }));
    expect(result.ok).toBe(false);
  });
});

describe('passwordEntropyBits', () => {
  it('increases with length', () => {
    expect(passwordEntropyBits(options({ length: 40 }))).toBeGreaterThan(
      passwordEntropyBits(options({ length: 10 }))
    );
  });

  it('increases with a larger charset', () => {
    const small = passwordEntropyBits(
      options({ length: 20, uppercase: false, lowercase: true, numbers: false, symbols: false })
    );
    const large = passwordEntropyBits(options({ length: 20 }));
    expect(large).toBeGreaterThan(small);
  });

  it('matches a hand-computed value for a known charset', () => {
    // Digits only, length 10: log2(10) * 10 ≈ 33.2 bits, floored.
    const bits = passwordEntropyBits(
      options({ length: 10, uppercase: false, lowercase: false, numbers: true, symbols: false })
    );
    expect(bits).toBe(Math.floor(10 * Math.log2(10)));
  });
});

describe('passwordStrength', () => {
  it('labels low entropy as Weak', () => {
    expect(passwordStrength(20).label).toBe('Weak');
  });

  it('labels mid-range entropy as Fair', () => {
    expect(passwordStrength(50).label).toBe('Fair');
  });

  it('labels high entropy as Strong', () => {
    expect(passwordStrength(70).label).toBe('Strong');
  });

  it('labels very high entropy as Very strong', () => {
    expect(passwordStrength(100).label).toBe('Very strong');
  });

  it('is consistent at the boundaries', () => {
    expect(passwordStrength(39).label).toBe('Weak');
    expect(passwordStrength(40).label).toBe('Fair');
    expect(passwordStrength(59).label).toBe('Fair');
    expect(passwordStrength(60).label).toBe('Strong');
    expect(passwordStrength(79).label).toBe('Strong');
    expect(passwordStrength(80).label).toBe('Very strong');
  });
});
