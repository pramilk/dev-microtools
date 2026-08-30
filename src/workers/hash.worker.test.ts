import { describe, it, expect } from 'vitest';
import { handleHashRequest } from './hash.worker';

describe('handleHashRequest', () => {
  it('hashes text with every algorithm when not using HMAC', async () => {
    const digests = await handleHashRequest({ kind: 'text', input: 'abc', useHmac: false, hmacKey: '' });
    expect(digests.find((d) => d.algorithm === 'SHA-256')?.digest).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('computes an HMAC instead when useHmac is set', async () => {
    const plain = await handleHashRequest({ kind: 'text', input: 'abc', useHmac: false, hmacKey: '' });
    const hmac = await handleHashRequest({ kind: 'text', input: 'abc', useHmac: true, hmacKey: 'secret' });
    expect(hmac.find((d) => d.algorithm === 'SHA-256')?.digest).not.toBe(
      plain.find((d) => d.algorithm === 'SHA-256')?.digest
    );
  });

  it('hashes a whole file when kind is "file"', async () => {
    const file = new File(['abc'], 'sample.txt');
    const digests = await handleHashRequest({ kind: 'file', file });
    expect(digests.find((d) => d.algorithm === 'SHA-256')?.digest).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('rejects with the underlying tool error for empty text', async () => {
    await expect(handleHashRequest({ kind: 'text', input: '', useHmac: false, hmacKey: '' })).rejects.toThrow(
      /nothing to hash/i
    );
  });
});
