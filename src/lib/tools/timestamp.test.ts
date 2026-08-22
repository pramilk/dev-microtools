import { describe, it, expect } from 'vitest';
import { fromEpoch, fromDateString, guessUnit, describeRelative, nowBreakdown } from './timestamp';

// A fixed reference point so relative-time assertions are deterministic.
const NOW = new Date('2026-08-22T12:00:00.000Z');

describe('guessUnit', () => {
  it('treats 10-digit values as seconds', () => {
    expect(guessUnit(1_700_000_000)).toBe('seconds');
  });

  it('treats 13-digit values as milliseconds', () => {
    expect(guessUnit(1_700_000_000_000)).toBe('milliseconds');
  });

  it('handles negative (pre-1970) values by magnitude', () => {
    expect(guessUnit(-1_000_000)).toBe('seconds');
  });
});

describe('fromEpoch', () => {
  it('converts a second-precision timestamp', () => {
    const result = fromEpoch('1700000000', 'seconds', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.iso).toBe('2023-11-14T22:13:20.000Z');
      expect(result.value.seconds).toBe(1_700_000_000);
      expect(result.value.milliseconds).toBe(1_700_000_000_000);
    }
  });

  it('converts a millisecond-precision timestamp', () => {
    const result = fromEpoch('1700000000123', 'milliseconds', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.iso).toBe('2023-11-14T22:13:20.123Z');
  });

  it('auto-detects the unit', () => {
    const asSeconds = fromEpoch('1700000000', 'auto', NOW);
    const asMillis = fromEpoch('1700000000000', 'auto', NOW);
    expect(asSeconds.ok && asMillis.ok).toBe(true);
    if (asSeconds.ok && asMillis.ok) expect(asSeconds.value.iso).toBe(asMillis.value.iso);
  });

  it('handles the Unix epoch itself', () => {
    const result = fromEpoch('0', 'seconds', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.iso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('handles pre-epoch negative timestamps', () => {
    const result = fromEpoch('-86400', 'seconds', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.iso).toBe('1969-12-31T00:00:00.000Z');
  });

  it('rejects non-numeric input', () => {
    const result = fromEpoch('not a number', 'auto', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/whole number/i);
  });

  it('rejects decimals, which are not valid epoch values', () => {
    expect(fromEpoch('1700000000.5', 'auto', NOW).ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(fromEpoch('  ', 'auto', NOW).ok).toBe(false);
  });

  it('rejects values beyond the safe integer range', () => {
    const result = fromEpoch('99999999999999999999', 'auto', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('rejects a value outside the representable Date range', () => {
    // Beyond ±8.64e15 ms, Date becomes Invalid Date.
    expect(fromEpoch('9000000000000000', 'milliseconds', NOW).ok).toBe(false);
  });
});

describe('fromDateString', () => {
  it('parses an ISO 8601 string', () => {
    const result = fromDateString('2026-03-14T09:26:53Z', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.seconds).toBe(Math.floor(Date.UTC(2026, 2, 14, 9, 26, 53) / 1000));
  });

  it('rejects unparseable text with an actionable message', () => {
    const result = fromDateString('sometime next tuesday', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ISO 8601/);
  });

  it('rejects empty input', () => {
    expect(fromDateString('', NOW).ok).toBe(false);
  });
});

describe('describeRelative', () => {
  it('describes a moment in the past', () => {
    expect(describeRelative(new Date('2026-08-19T12:00:00Z'), NOW)).toBe('3 days ago');
  });

  it('describes a moment in the future', () => {
    expect(describeRelative(new Date('2026-08-24T12:00:00Z'), NOW)).toBe('in 2 days');
  });

  it('describes the present', () => {
    expect(describeRelative(NOW, NOW)).toBe('just now');
  });

  it('scales up to hours and years', () => {
    expect(describeRelative(new Date('2026-08-22T09:00:00Z'), NOW)).toBe('3 hours ago');
    expect(describeRelative(new Date('2023-08-22T12:00:00Z'), NOW)).toMatch(/years ago/);
  });
});

describe('nowBreakdown', () => {
  it('reports the supplied moment as "just now"', () => {
    expect(nowBreakdown(NOW).relative).toBe('just now');
  });

  it('includes a resolved IANA time zone', () => {
    expect(nowBreakdown(NOW).timeZone.length).toBeGreaterThan(0);
  });
});
