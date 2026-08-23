import { describe, it, expect } from 'vitest';
import {
  hashText,
  hashAll,
  hashFile,
  hmacText,
  hmacAll,
  digestsMatch,
  HASH_ALGORITHMS,
  MAX_HASHABLE_FILE_BYTES,
} from './hash';

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

describe('hashFile', () => {
  it('matches the known text digests for a plain-text file', async () => {
    const file = new File(['abc'], 'test.txt');
    const result = await hashFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byAlgorithm = Object.fromEntries(result.value.map((r) => [r.algorithm, r.digest]));
      expect(byAlgorithm['MD5']).toBe('900150983cd24fb0d6963f7d28e17f72');
      expect(byAlgorithm['SHA-256']).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      );
    }
  });

  it('hashes arbitrary binary bytes correctly, including bytes above 0x7f', async () => {
    // Bytes with the high bit set are exactly what blueimp-md5's UTF-8 re-encoding
    // would corrupt — this is why file hashing goes through spark-md5 instead.
    const bytes = new Uint8Array([0xff, 0x00, 0x80, 0x7f]);
    const file = new File([bytes], 'binary.bin');
    const result = await hashFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byAlgorithm = Object.fromEntries(result.value.map((r) => [r.algorithm, r.digest]));
      expect(byAlgorithm['MD5']).toBe('db88b5a58c9d4382af9f1c88ccd129bf');
      expect(byAlgorithm['SHA-256']).toBe(
        '050bda099af4c2a02b924a4439835d7a6cf66294499f1057a9dc9163ab92bd42'
      );
    }
  });

  it('rejects an empty file', async () => {
    const result = await hashFile(new File([], 'empty.txt'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it('rejects a file over the size limit', async () => {
    const file = new File([new Uint8Array(1)], 'huge.bin');
    Object.defineProperty(file, 'size', { value: MAX_HASHABLE_FILE_BYTES + 1 });
    const result = await hashFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });
});

describe('hmacText', () => {
  it('produces a different digest than the unkeyed hash', async () => {
    const plain = await hashText('message', 'SHA-256');
    const keyed = await hmacText('message', 'secret', 'SHA-256');
    expect(plain.ok).toBe(true);
    expect(keyed.ok).toBe(true);
    if (plain.ok && keyed.ok) expect(keyed.value).not.toBe(plain.value);
  });

  it('changes the digest when the key changes but the message does not', async () => {
    const a = await hmacText('message', 'key-one', 'SHA-256');
    const b = await hmacText('message', 'key-two', 'SHA-256');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value);
  });

  it('is deterministic for the same message and key', async () => {
    const a = await hmacText('message', 'secret', 'SHA-256');
    const b = await hmacText('message', 'secret', 'SHA-256');
    expect(a).toEqual(b);
  });

  it('supports HMAC-MD5', async () => {
    const result = await hmacText('message', 'secret', 'MD5');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects an empty message', async () => {
    const result = await hmacText('', 'secret', 'SHA-256');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing to hash/i);
  });

  it('rejects an empty key', async () => {
    const result = await hmacText('message', '', 'SHA-256');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/secret key/i);
  });
});

describe('hmacAll', () => {
  it('returns one HMAC per supported algorithm', async () => {
    const result = await hmacAll('message', 'secret');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(HASH_ALGORITHMS.length);
      expect(result.value.map((r) => r.algorithm)).toEqual([...HASH_ALGORITHMS]);
    }
  });

  it('rejects an empty key', async () => {
    expect((await hmacAll('message', '')).ok).toBe(false);
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
