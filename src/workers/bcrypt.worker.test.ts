import { describe, it, expect } from 'vitest';
import { handleBcryptRequest } from './bcrypt.worker';

describe('handleBcryptRequest', () => {
  it('hashes a password', async () => {
    const result = await handleBcryptRequest({ kind: 'hash', password: 'hunter2', rounds: 4 });
    expect(result).toEqual({ kind: 'hash', value: expect.stringMatching(/^\$2[aby]\$/) });
  });

  it('verifies a matching password against a hash it produced', async () => {
    const hashed = await handleBcryptRequest({ kind: 'hash', password: 'hunter2', rounds: 4 });
    if (hashed.kind !== 'hash') throw new Error('expected a hash result');
    const verified = await handleBcryptRequest({ kind: 'verify', password: 'hunter2', hash: hashed.value });
    expect(verified).toEqual({ kind: 'verify', value: true });
  });

  it('rejects with the underlying tool error for a rounds value above the cap', async () => {
    await expect(handleBcryptRequest({ kind: 'hash', password: 'x', rounds: 20 })).rejects.toThrow(/rounds must be/i);
  });
});
