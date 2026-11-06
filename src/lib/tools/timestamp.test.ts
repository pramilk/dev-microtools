import { describe, it, expect } from 'vitest';
import {
  fromEpoch,
  fromDateString,
  guessUnit,
  describeRelative,
  nowBreakdown,
  formatInTimeZone,
  COMMON_TIME_ZONES,
} from './timestamp';

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

describe('formatInTimeZone', () => {
  it('formats a known instant in UTC', () => {
    const result = formatInTimeZone(new Date('2024-01-01T00:00:00Z'), 'UTC');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('2024');
      expect(result.value).toContain('January');
    }
  });

  it('produces a different wall-clock reading for a genuinely different zone', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    const utc = formatInTimeZone(date, 'UTC');
    const tokyo = formatInTimeZone(date, 'Asia/Tokyo');
    expect(utc.ok).toBe(true);
    expect(tokyo.ok).toBe(true);
    if (utc.ok && tokyo.ok) expect(utc.value).not.toBe(tokyo.value);
  });

  it('rejects a time zone name the platform does not recognise', () => {
    const result = formatInTimeZone(new Date(), 'Not/AZone');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a recognised/i);
  });
});

describe('COMMON_TIME_ZONES', () => {
  it('lists only zone names the platform actually recognises', () => {
    for (const { zone } of COMMON_TIME_ZONES) {
      expect(formatInTimeZone(new Date(), zone).ok).toBe(true);
    }
  });

  it('has no duplicate zones', () => {
    const zones = COMMON_TIME_ZONES.map((z) => z.zone);
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('non-Unix epochs', () => {
  const NOW_FIXED = new Date('2026-01-01T00:00:00Z');
  const iso = (input: string, unit: Parameters<typeof fromEpoch>[1]) => {
    const result = fromEpoch(input, unit, NOW_FIXED);
    return result.ok ? result.value.iso : result.error;
  };

  it('reads each format to the same instant (published epoch anchors)', () => {
    expect(iso('116444736000000000', 'filetime')).toBe('1970-01-01T00:00:00.000Z');
    expect(iso('621355968000000000', 'dotnet-ticks')).toBe('1970-01-01T00:00:00.000Z');
    expect(iso('11644473600000000', 'webkit')).toBe('1970-01-01T00:00:00.000Z');
    expect(iso('2082844800', 'hfs-plus')).toBe('1970-01-01T00:00:00.000Z');
    expect(iso('25569', 'excel')).toBe('1970-01-01T00:00:00.000Z');
    expect(iso('0', 'mac-absolute')).toBe('2001-01-01T00:00:00.000Z');
    expect(iso('0', 'dotnet-ticks')).toBe('0001-01-01T00:00:00.000Z');
    expect(iso('0', 'filetime')).toBe('1601-01-01T00:00:00.000Z');
  });

  it('reads one known moment from every format', () => {
    const expected = '2023-11-14T22:13:20.000Z';
    expect(iso('1700000000', 'seconds')).toBe(expected);
    expect(iso('1700000000000', 'milliseconds')).toBe(expected);
    expect(iso('1700000000000000', 'microseconds')).toBe(expected);
    expect(iso('1700000000000000000', 'nanoseconds')).toBe(expected);
    expect(iso('133444736000000000', 'filetime')).toBe(expected);
    expect(iso('638355968000000000', 'dotnet-ticks')).toBe(expected);
    expect(iso('13344473600000000', 'webkit')).toBe(expected);
    expect(iso('721692800', 'mac-absolute')).toBe(expected);
    expect(iso('3782844800', 'hfs-plus')).toBe(expected);
  });

  it('keeps full precision for values beyond 2^53', () => {
    // 133444736000000001 is one 100 ns tick past a whole second; a double would round it away
    // but the millisecond result must still be exact.
    const result = fromEpoch('133444736001230000', 'filetime', NOW_FIXED);
    expect(result.ok && result.value.iso).toBe('2023-11-14T22:13:20.123Z');
  });

  it('reads Excel serials with a fractional day', () => {
    expect(iso('45244.5', 'excel')).toBe('2023-11-14T12:00:00.000Z');
    expect(iso('45244.925926', 'excel')).toMatch(/^2023-11-14T22:13:2\d/);
    expect(iso('-1', 'excel')).toBe('1899-12-29T00:00:00.000Z');
  });

  it('auto-detects microseconds and nanoseconds by digit count', () => {
    expect(guessUnit(1_700_000_000_000_000)).toBe('microseconds');
    expect(guessUnit(1_700_000_000_000_000_000n)).toBe('nanoseconds');
    expect(iso('1700000000000000', 'auto')).toBe('2023-11-14T22:13:20.000Z');
    expect(iso('1700000000000000000', 'auto')).toBe('2023-11-14T22:13:20.000Z');
    expect(iso('-1700000000000000', 'auto')).toBe('1916-02-18T01:46:40.000Z');
  });

  it('never auto-detects the platform epochs', () => {
    // 133444736000000000 has 18 digits; auto reads it as Unix microseconds/nanoseconds, not FILETIME.
    expect(guessUnit(133_444_736_000_000_000n)).not.toBe('seconds');
    expect(iso('133444736000000000', 'auto')).not.toBe('2023-11-14T22:13:20.000Z');
  });

  it('rejects decimals everywhere except Excel, and bad Excel input', () => {
    expect(fromEpoch('1.5', 'filetime', NOW_FIXED).ok).toBe(false);
    expect(fromEpoch('4524x', 'excel', NOW_FIXED).ok).toBe(false);
    expect(fromEpoch('1e5', 'excel', NOW_FIXED).ok).toBe(false);
    const huge = fromEpoch('999999999999999', 'excel', NOW_FIXED);
    expect(!huge.ok && huge.error).toMatch(/outside the range/i);
  });

  it('rejects values past 64 bits and seconds outside the Date range', () => {
    const tooBig = fromEpoch('18446744073709551616', 'filetime', NOW_FIXED);
    expect(!tooBig.ok && tooBig.error).toMatch(/too large/i);
    // Large, but still a valid 64-bit tick count: far-future dates are fine for 100 ns units.
    expect(fromEpoch('9223372036854775807', 'dotnet-ticks', NOW_FIXED).ok).toBe(true);
    const outOfRange = fromEpoch('18446744073709551615', 'seconds', NOW_FIXED);
    expect(!outOfRange.ok && outOfRange.error).toMatch(/outside the range/i);
  });

  it('returns negative Unix values correctly in the finer units', () => {
    expect(iso('-1', 'milliseconds')).toBe('1969-12-31T23:59:59.999Z');
    expect(iso('-1', 'microseconds')).toBe('1969-12-31T23:59:59.999Z');
    expect(iso('-1000000001', 'nanoseconds')).toBe('1969-12-31T23:59:58.999Z');
  });
});

describe('epoch readings for a moment', () => {
  it('lists the same instant in every format', () => {
    const result = fromEpoch('1700000000', 'seconds', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byUnit = Object.fromEntries(result.value.epochs.map((reading) => [reading.unit, reading.value]));
    expect(byUnit).toMatchObject({
      seconds: '1700000000',
      milliseconds: '1700000000000',
      microseconds: '1700000000000000',
      nanoseconds: '1700000000000000000',
      filetime: '133444736000000000',
      'dotnet-ticks': '638355968000000000',
      webkit: '13344473600000000',
      'mac-absolute': '721692800',
      'hfs-plus': '3782844800',
    });
    expect(Number(byUnit.excel)).toBeCloseTo(45244.925926, 5);
  });

  it('marks formats that cannot represent a moment before their epoch', () => {
    const result = fromDateString('1500-06-15T00:00:00Z', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filetime = result.value.epochs.find((reading) => reading.unit === 'filetime')!;
    expect(filetime.value).toBeNull();
    expect(filetime.note).toMatch(/1601-01-01/);
    // Unix and .NET can still represent it.
    expect(result.value.epochs.find((reading) => reading.unit === 'seconds')!.value).toMatch(/^-/);
    expect(result.value.epochs.find((reading) => reading.unit === 'dotnet-ticks')!.value).not.toBeNull();
  });

  it('warns about the 1900 leap-year quirk for early Excel serials', () => {
    const result = fromDateString('1900-01-15T00:00:00Z', NOW);
    expect(result.ok && result.value.epochs.find((reading) => reading.unit === 'excel')!.note).toMatch(/leap-year/);
  });

  it('floors, not truncates, pre-1970 values in whole seconds', () => {
    const result = fromDateString('1969-12-31T23:59:59.500Z', NOW);
    expect(result.ok && result.value.epochs.find((reading) => reading.unit === 'seconds')!.value).toBe('-1');
  });
});
