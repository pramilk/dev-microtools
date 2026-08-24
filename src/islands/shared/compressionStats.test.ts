import { describe, it, expect } from 'vitest';
import { compressionSavings, formatSavingsLabel } from './compressionStats';

describe('compressionSavings', () => {
  it('reports a shrink as "smaller"', () => {
    expect(compressionSavings(1000, 500)).toEqual({ savedBytes: 500, percent: 50, direction: 'smaller' });
  });

  it('reports a growth as "larger"', () => {
    expect(compressionSavings(1000, 1500)).toEqual({ savedBytes: -500, percent: 50, direction: 'larger' });
  });

  it('reports no change as "same"', () => {
    expect(compressionSavings(1000, 1000)).toEqual({ savedBytes: 0, percent: 0, direction: 'same' });
  });

  it('handles a zero-byte before value without dividing by zero', () => {
    expect(compressionSavings(0, 0)).toEqual({ savedBytes: 0, percent: 0, direction: 'same' });
  });

  it('rounds the percentage', () => {
    expect(compressionSavings(3, 2)).toEqual({ savedBytes: 1, percent: 33, direction: 'smaller' });
  });
});

describe('formatSavingsLabel', () => {
  it('formats a shrink', () => {
    expect(formatSavingsLabel({ savedBytes: 500, percent: 50, direction: 'smaller' })).toBe('(50% smaller)');
  });

  it('formats a growth', () => {
    expect(formatSavingsLabel({ savedBytes: -500, percent: 50, direction: 'larger' })).toBe('(50% larger)');
  });

  it('formats no change', () => {
    expect(formatSavingsLabel({ savedBytes: 0, percent: 0, direction: 'same' })).toBe('(no change)');
  });
});
