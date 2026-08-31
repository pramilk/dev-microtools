import { describe, it, expect } from 'vitest';
import { gzip, gunzip, supportsCompression } from './compression';

describe('compression', () => {
  it('reports support in this environment', () => {
    expect(supportsCompression()).toBe(true);
  });

  it('round-trips bytes through gzip/gunzip', async () => {
    const original = new TextEncoder().encode('hello, bundle size checker!'.repeat(50));
    const compressed = await gzip(original);
    const restored = await gunzip(compressed);
    // Compared as plain arrays rather than via toEqual on the Uint8Arrays directly —
    // jsdom's test environment can hand back a typed array from a different realm than
    // the one `toEqual` expects, which otherwise reports a false mismatch.
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('shrinks repetitive input', async () => {
    const original = new TextEncoder().encode('a'.repeat(10_000));
    const compressed = await gzip(original);
    expect(compressed.length).toBeLessThan(original.length);
  });

  it('handles empty input', async () => {
    const compressed = await gzip(new Uint8Array());
    const restored = await gunzip(compressed);
    expect(restored.length).toBe(0);
  });
});
