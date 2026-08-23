import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, MIN_BCRYPT_ROUNDS, MAX_BCRYPT_ROUNDS } from './bcrypt';

// bcrypt salts are random per call, so there is no fixed input -> output vector to assert
// against. Tests instead check structural properties and round-trip behaviour.

describe('hashPassword', () => {
  it('produces a hash with the standard bcrypt version prefix and length', async () => {
    const result = await hashPassword('correct horse battery staple', 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('$2')).toBe(true);
      expect(result.value).toHaveLength(60);
    }
  });

  it('produces a different hash each time, from a fresh random salt', async () => {
    const a = await hashPassword('same password', 4);
    const b = await hashPassword('same password', 4);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value);
  });

  it('both differently-salted hashes still verify correctly', async () => {
    const a = await hashPassword('same password', 4);
    const b = await hashPassword('same password', 4);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await verifyPassword('same password', a.value)).toEqual({ ok: true, value: true });
    expect(await verifyPassword('same password', b.value)).toEqual({ ok: true, value: true });
  });

  it('hashes and verifies an empty password', async () => {
    const result = await hashPassword('', 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(60);
    expect(await verifyPassword('', result.value)).toEqual({ ok: true, value: true });
  });

  it('round-trips a Unicode password', async () => {
    const password = 'пароль-🔒-密码';
    const result = await hashPassword(password, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await verifyPassword(password, result.value)).toEqual({ ok: true, value: true });
  });

  it('rejects rounds below the minimum', async () => {
    const result = await hashPassword('secret', MIN_BCRYPT_ROUNDS - 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least/i);
  });

  it('rejects rounds above the maximum', async () => {
    const result = await hashPassword('secret', MAX_BCRYPT_ROUNDS + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/14 or lower/i);
  });

  it('rejects a non-integer round count', async () => {
    const result = await hashPassword('secret', 10.5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/whole number/i);
  });

  it('accepts the minimum boundary round count', async () => {
    const result = await hashPassword('secret', MIN_BCRYPT_ROUNDS);
    expect(result.ok).toBe(true);
  });

  it('accepts the maximum boundary round count', async () => {
    const result = await hashPassword('secret', MAX_BCRYPT_ROUNDS);
    expect(result.ok).toBe(true);
  }, 15000);
});

describe('verifyPassword', () => {
  it('reports ok(true) for the correct password', async () => {
    const hashed = await hashPassword('correct password', 4);
    expect(hashed.ok).toBe(true);
    if (!hashed.ok) return;
    expect(await verifyPassword('correct password', hashed.value)).toEqual({ ok: true, value: true });
  });

  it('reports ok(false) — not an error — for an incorrect password', async () => {
    const hashed = await hashPassword('correct password', 4);
    expect(hashed.ok).toBe(true);
    if (!hashed.ok) return;
    const result = await verifyPassword('wrong password', hashed.value);
    expect(result).toEqual({ ok: true, value: false });
  });

  it('an empty password does not match a hash of a non-empty password', async () => {
    const hashed = await hashPassword('correct password', 4);
    expect(hashed.ok).toBe(true);
    if (!hashed.ok) return;
    const result = await verifyPassword('', hashed.value);
    expect(result).toEqual({ ok: true, value: false });
  });

  it('rejects an empty hash', async () => {
    const result = await verifyPassword('anything', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/enter a bcrypt hash/i);
  });

  it('rejects a malformed, non-bcrypt string with a clear error instead of crashing', async () => {
    const result = await verifyPassword('anything', 'not-a-hash');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't look like a bcrypt hash/i);
  });

  it('rejects a plain SHA-256 hex digest as not a bcrypt hash', async () => {
    const sha256Hex = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    const result = await verifyPassword('anything', sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't look like a bcrypt hash/i);
  });

  it('accepts the $2a$, $2b$ and $2y$ version prefixes', async () => {
    const hashed = await hashPassword('prefix test', 4);
    expect(hashed.ok).toBe(true);
    if (!hashed.ok) return;
    for (const prefix of ['$2a$', '$2b$', '$2y$']) {
      const swapped = prefix + hashed.value.slice(4);
      const result = await verifyPassword('anything', swapped);
      expect(result.ok).toBe(true);
    }
  });
});
