import { describe, it, expect } from 'vitest';
import { hashText, hashAll, digestsMatch, HASH_ALGORITHMS } from './hash';

describe('hashText', () => {
  // Published test vectors. If any of these change, the implementation is wrong.
  it('matches the known MD5 digest of "abc"', async () => {
    expect(await hashText('abc', 'MD5')).toEqual({
      ok: true,
      value: '900150983cd24fb0d6963f7d28e17f72',
    });
  });

  it('matches the known SHA-1 digest of "abc"', async () => {
    expect(await hashText('abc', 'SHA-1')).toEqual({
      ok: true,
      value: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    });
  });

  it('matches the known SHA-256 digest of "abc"', async () => {
    expect(await hashText('abc', 'SHA-256')).toEqual({
      ok: true,
      value: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  it('matches the known SHA-512 digest of "abc"', async () => {
    const result = await hashText('abc', 'SHA-512');
    expect(result).toEqual({
      ok: true,
      value:
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    });
  });

  it('hashes UTF-8 text by its bytes, not its code points', async () => {
    // "é" is 0xC3 0xA9 in UTF-8 but 0xE9 in latin1, and the two hash differently.
    // Verified against Node's crypto: md5(utf8) = 66ddcd97…, md5(latin1) = 34068776….
    // Asserting the UTF-8 value pins down that we encode before hashing.
    expect(await hashText('é', 'MD5')).toEqual({
      ok: true,
      value: '66ddcd97cfdeabb2f6fb8a999b4bc76f',
    });
  });

  it('rejects empty input rather than hashing the empty string silently', async () => {
    const result = await hashText('', 'SHA-256');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing to hash/i);
  });

  it('produces a digest of the right length for every algorithm', async () => {
    const lengths: Record<string, number> = {
      MD5: 32,
      'SHA-1': 40,
      'SHA-256': 64,
      'SHA-384': 96,
      'SHA-512': 128,
    };
    for (const algorithm of HASH_ALGORITHMS) {
      const result = await hashText('test', algorithm);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(lengths[algorithm]!);
    }
  });

  it('emits lowercase hex only', async () => {
    const result = await hashText('Hello, World!', 'SHA-256');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[0-9a-f]+$/);
  });
});

describe('hashAll', () => {
  it('returns one digest per supported algorithm', async () => {
    const result = await hashAll('abc');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(HASH_ALGORITHMS.length);
      expect(result.value.map((r) => r.algorithm)).toEqual([...HASH_ALGORITHMS]);
    }
  });

  it('rejects empty input', async () => {
    expect((await hashAll('')).ok).toBe(false);
  });
});

describe('digestsMatch', () => {
  it('compares case-insensitively and ignores surrounding whitespace', () => {
    expect(digestsMatch('ABC123', ' abc123 ')).toBe(true);
  });

  it('reports a mismatch', () => {
    expect(digestsMatch('abc', 'def')).toBe(false);
  });

  it('treats two empty strings as no match, not a trivial match', () => {
    expect(digestsMatch('', '')).toBe(false);
  });
});
