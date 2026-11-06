import { describe, it, expect } from 'vitest';
import {
  isValidTimeZone,
  wallTimeAt,
  offsetMinutesAt,
  instantForWallTime,
  formatOffset,
  parseLocalDateTime,
  formatLocalDateTime,
  allTimeZones,
  zoneAbbreviation,
} from './timeZone';

const utc = (iso: string) => Date.parse(iso);

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('offsetMinutesAt', () => {
  it('follows daylight saving time', () => {
    expect(offsetMinutesAt(utc('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutesAt(utc('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('handles half-hour and quarter-hour zones', () => {
    expect(offsetMinutesAt(utc('2026-01-15T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutesAt(utc('2026-01-15T12:00:00Z'), 'Asia/Kathmandu')).toBe(345);
  });

  it('is zero for UTC and ignores milliseconds', () => {
    expect(offsetMinutesAt(utc('2026-01-15T12:00:00.999Z'), 'UTC')).toBe(0);
  });
});

describe('wallTimeAt', () => {
  it('reads the wall clock in another zone, across a date boundary', () => {
    expect(wallTimeAt(utc('2026-03-14T23:30:00Z'), 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 8,
      minute: 30,
      second: 0,
    });
  });

  it('reports midnight as hour 0, not 24', () => {
    expect(wallTimeAt(utc('2026-03-14T00:00:00Z'), 'UTC').hour).toBe(0);
  });
});

describe('instantForWallTime', () => {
  const wall = (year: number, month: number, day: number, hour: number, minute = 0) => ({
    year,
    month,
    day,
    hour,
    minute,
    second: 0,
  });

  it('resolves an ordinary wall time', () => {
    expect(instantForWallTime(wall(2026, 1, 15, 9), 'America/New_York')).toBe(utc('2026-01-15T14:00:00Z'));
  });

  it('returns null for a time skipped by spring-forward', () => {
    expect(instantForWallTime(wall(2026, 3, 8, 2, 30), 'America/New_York')).toBeNull();
  });

  it('picks the earlier instant when fall-back repeats a time', () => {
    // 01:30 occurs twice on 2026-11-01 in New York; the first is still EDT (UTC-4).
    expect(instantForWallTime(wall(2026, 11, 1, 1, 30), 'America/New_York')).toBe(utc('2026-11-01T05:30:00Z'));
  });

  it('round-trips with wallTimeAt', () => {
    const instant = utc('2026-09-30T18:45:10Z');
    for (const zone of ['Europe/London', 'Asia/Kolkata', 'Australia/Sydney', 'America/Sao_Paulo']) {
      expect(instantForWallTime(wallTimeAt(instant, zone), zone)).toBe(instant);
    }
  });
});

describe('formatOffset', () => {
  it('formats whole, fractional and zero offsets', () => {
    expect(formatOffset(0)).toBe('UTC');
    expect(formatOffset(-480)).toBe('UTC-8');
    expect(formatOffset(330)).toBe('UTC+5:30');
    expect(formatOffset(345)).toBe('UTC+5:45');
  });
});

describe('zoneAbbreviation', () => {
  it('returns a non-empty short name', () => {
    expect(zoneAbbreviation(utc('2026-01-15T12:00:00Z'), 'America/New_York')).toMatch(/E[SD]T|GMT/);
  });
});

describe('parseLocalDateTime / formatLocalDateTime', () => {
  it('parses datetime-local values with and without seconds', () => {
    const parsed = parseLocalDateTime('2026-03-14T09:30');
    expect(parsed.ok && parsed.value).toEqual({ year: 2026, month: 3, day: 14, hour: 9, minute: 30, second: 0 });
    const withSeconds = parseLocalDateTime('2026-03-14 09:30:45');
    expect(withSeconds.ok && withSeconds.value.second).toBe(45);
  });

  it('rejects empty, malformed and impossible dates with a message', () => {
    for (const bad of ['', 'tomorrow', '2026-13-01T00:00', '2026-02-30T10:00', '2026-03-14T25:00']) {
      const result = parseLocalDateTime(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(10);
    }
  });

  it('formats back to the input format', () => {
    expect(formatLocalDateTime({ year: 2026, month: 3, day: 4, hour: 5, minute: 6, second: 7 })).toBe(
      '2026-03-04T05:06'
    );
  });
});

describe('allTimeZones', () => {
  it('always includes UTC and never returns an empty list', () => {
    const zones = allTimeZones(['UTC', 'Asia/Tokyo']);
    expect(zones).toContain('UTC');
    expect(zones.length).toBeGreaterThan(1);
  });
});
