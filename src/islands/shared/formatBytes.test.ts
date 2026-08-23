import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('shows small counts in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches to KB at 1024 bytes', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('switches to MB and GB at the right thresholds', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('uses one decimal place once the value reaches double digits', () => {
    expect(formatBytes(12 * 1024)).toBe('12.0 KB');
  });

  it('never exceeds GB, for a value larger than that', () => {
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.00 GB');
  });
});
