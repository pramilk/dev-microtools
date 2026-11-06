import { describe, it, expect } from 'vitest';
import {
  parseIsoDate,
  formatIsoDate,
  toDayNumber,
  fromDayNumber,
  dayOfWeek,
  dayOfYear,
  isoWeek,
  isLeapYear,
  daysInMonth,
  describeDate,
  addMonths,
  addDays,
  addToDate,
  addBusinessDays,
  dateDifference,
  describeBreakdown,
  todayLocal,
  type CalendarDate,
} from './dateMath';

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });
const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('parseIsoDate / formatIsoDate', () => {
  it('parses and round-trips a valid date', () => {
    expect(unwrap(parseIsoDate('2026-03-14'))).toEqual(d(2026, 3, 14));
    expect(formatIsoDate(d(2026, 3, 4))).toBe('2026-03-04');
    expect(formatIsoDate(d(50, 1, 2))).toBe('0050-01-02');
  });

  it('tolerates surrounding whitespace', () => {
    expect(unwrap(parseIsoDate('  2026-03-14 '))).toEqual(d(2026, 3, 14));
  });

  it('rejects empty, malformed and impossible dates with a message', () => {
    for (const bad of ['', '   ', 'abc', '2026/03/14', '14-03-2026', '2026-3-4', '2026-13-01', '2026-02-30', '2026-04-31', '0000-01-01']) {
      const result = parseIsoDate(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(8);
    }
  });

  it('knows leap years, including the century rules', () => {
    expect(parseIsoDate('2024-02-29').ok).toBe(true);
    expect(parseIsoDate('2023-02-29').ok).toBe(false);
    expect(parseIsoDate('1900-02-29').ok).toBe(false);
    expect(parseIsoDate('2000-02-29').ok).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });
});

describe('day numbers', () => {
  it('anchors on the Unix epoch', () => {
    expect(toDayNumber(d(1970, 1, 1))).toBe(0);
    expect(toDayNumber(d(1970, 1, 2))).toBe(1);
    expect(toDayNumber(d(1969, 12, 31))).toBe(-1);
  });

  it('round-trips, including years below 100 which Date.UTC mangles', () => {
    for (const date of [d(50, 6, 15), d(1, 1, 1), d(9999, 12, 31), d(2024, 2, 29), d(1900, 3, 1)]) {
      expect(fromDayNumber(toDayNumber(date))).toEqual(date);
    }
  });
});

describe('weekday, day of year and ISO week', () => {
  it('finds the weekday', () => {
    expect(dayOfWeek(d(1970, 1, 1))).toBe(4); // Thursday
    expect(dayOfWeek(d(2000, 1, 1))).toBe(6); // Saturday
    expect(dayOfWeek(d(2026, 3, 14))).toBe(6);
    expect(dayOfWeek(d(1969, 12, 31))).toBe(3); // Wednesday, before the epoch
  });

  it('counts the day of the year', () => {
    expect(dayOfYear(d(2026, 1, 1))).toBe(1);
    expect(dayOfYear(d(2026, 3, 14))).toBe(73);
    expect(dayOfYear(d(2024, 12, 31))).toBe(366);
    expect(dayOfYear(d(2026, 12, 31))).toBe(365);
  });

  it('computes ISO week numbers across year boundaries', () => {
    expect(isoWeek(d(2026, 1, 1))).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(d(2021, 1, 3))).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(d(2024, 12, 30))).toEqual({ year: 2025, week: 1 });
    expect(isoWeek(d(2026, 12, 31))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(d(2026, 3, 14))).toEqual({ year: 2026, week: 11 });
  });

  it('summarises a date', () => {
    expect(describeDate(d(2024, 2, 10))).toEqual({
      weekday: 'Saturday',
      dayOfYear: 41,
      isoWeek: { year: 2024, week: 6 },
      quarter: 1,
      isLeapYear: true,
      daysInMonth: 29,
      daysLeftInYear: 325,
    });
    expect(describeDate(d(2026, 10, 1)).quarter).toBe(4);
  });

  it('knows month lengths', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('addMonths / addDays', () => {
  it('clamps the day to the end of a shorter month', () => {
    expect(unwrap(addMonths(d(2026, 1, 31), 1))).toEqual(d(2026, 2, 28));
    expect(unwrap(addMonths(d(2024, 1, 31), 1))).toEqual(d(2024, 2, 29));
    expect(unwrap(addMonths(d(2026, 3, 31), -1))).toEqual(d(2026, 2, 28));
  });

  it('rolls across years in both directions', () => {
    expect(unwrap(addMonths(d(2026, 11, 15), 3))).toEqual(d(2027, 2, 15));
    expect(unwrap(addMonths(d(2026, 1, 15), -1))).toEqual(d(2025, 12, 15));
    expect(unwrap(addMonths(d(2026, 1, 15), -25))).toEqual(d(2023, 12, 15));
  });

  it('adds days across month and leap-day boundaries', () => {
    expect(unwrap(addDays(d(2026, 2, 28), 1))).toEqual(d(2026, 3, 1));
    expect(unwrap(addDays(d(2024, 2, 28), 1))).toEqual(d(2024, 2, 29));
    expect(unwrap(addDays(d(2026, 1, 1), -1))).toEqual(d(2025, 12, 31));
    expect(unwrap(addDays(d(2026, 1, 1), 365))).toEqual(d(2027, 1, 1));
  });

  it('refuses to leave the supported year range', () => {
    expect(addDays(d(9999, 12, 31), 1).ok).toBe(false);
    expect(addDays(d(1, 1, 1), -1).ok).toBe(false);
    expect(addMonths(d(9999, 12, 1), 1).ok).toBe(false);
  });
});

describe('addToDate', () => {
  const zero = { years: 0, months: 0, weeks: 0, days: 0 };

  it('adds a mixed duration, months first', () => {
    expect(unwrap(addToDate(d(2026, 1, 31), { ...zero, months: 1, days: 1 }))).toEqual(d(2026, 3, 1));
    expect(unwrap(addToDate(d(2026, 3, 14), { years: 1, months: 2, weeks: 1, days: 3 }))).toEqual(d(2027, 5, 24));
  });

  it('subtracts', () => {
    expect(unwrap(addToDate(d(2024, 2, 29), { ...zero, years: 1 }, -1))).toEqual(d(2023, 2, 28));
    expect(unwrap(addToDate(d(2026, 3, 14), { ...zero, weeks: 2 }, -1))).toEqual(d(2026, 2, 28));
  });

  it('is a no-op for an all-zero duration', () => {
    expect(unwrap(addToDate(d(2026, 3, 14), zero))).toEqual(d(2026, 3, 14));
  });

  it('rejects negative, fractional and absurd amounts, naming the field', () => {
    for (const bad of [{ ...zero, days: -1 }, { ...zero, days: 1.5 }, { ...zero, days: Number.NaN }, { ...zero, years: 5_000_000 }]) {
      const result = addToDate(d(2026, 3, 14), bad);
      expect(result.ok).toBe(false);
    }
    const named = addToDate(d(2026, 3, 14), { ...zero, weeks: -2 });
    expect(!named.ok && named.error).toMatch(/weeks/);
  });

  it('errors instead of wrapping past year 9999', () => {
    expect(addToDate(d(9999, 6, 1), { ...zero, years: 1 }).ok).toBe(false);
  });
});

describe('addBusinessDays', () => {
  it('skips weekends going forward and backward', () => {
    expect(unwrap(addBusinessDays(d(2026, 3, 6), 1))).toEqual(d(2026, 3, 9)); // Fri -> Mon
    expect(unwrap(addBusinessDays(d(2026, 3, 6), 5))).toEqual(d(2026, 3, 13));
    expect(unwrap(addBusinessDays(d(2026, 3, 9), -1))).toEqual(d(2026, 3, 6)); // Mon -> Fri
  });

  it('leaves the date alone for zero, and starts from the next weekday from a weekend', () => {
    expect(unwrap(addBusinessDays(d(2026, 3, 7), 0))).toEqual(d(2026, 3, 7));
    expect(unwrap(addBusinessDays(d(2026, 3, 7), 1))).toEqual(d(2026, 3, 9)); // Sat -> Mon
  });

  it('handles a large count', () => {
    // 100,000 weekdays is exactly 20,000 weeks.
    expect(unwrap(addBusinessDays(d(2026, 3, 9), 100_000))).toEqual(fromDayNumber(toDayNumber(d(2026, 3, 9)) + 140_000));
  });

  it('rejects fractional and absurd counts', () => {
    expect(addBusinessDays(d(2026, 3, 9), 1.5).ok).toBe(false);
    expect(addBusinessDays(d(2026, 3, 9), 5_000_000).ok).toBe(false);
  });
});

describe('dateDifference', () => {
  it('breaks a span into years, months and days', () => {
    const diff = dateDifference(d(2000, 1, 15), d(2026, 3, 14));
    expect(diff).toMatchObject({ direction: 'forward', years: 26, months: 1, days: 27, totalMonths: 313 });
    expect(diff.totalDays).toBe(toDayNumber(d(2026, 3, 14)) - toDayNumber(d(2000, 1, 15)));
  });

  it('is symmetric apart from direction', () => {
    const forward = dateDifference(d(2000, 1, 15), d(2026, 3, 14));
    const backward = dateDifference(d(2026, 3, 14), d(2000, 1, 15));
    expect(backward.direction).toBe('backward');
    expect({ ...backward, direction: 'forward' }).toEqual(forward);
  });

  it('handles the same date', () => {
    expect(dateDifference(d(2026, 3, 14), d(2026, 3, 14))).toMatchObject({
      direction: 'same',
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      businessDays: 0,
    });
  });

  it('does not overshoot when the start day does not exist in the intermediate month', () => {
    const diff = dateDifference(d(2026, 1, 31), d(2026, 3, 1));
    expect(diff).toMatchObject({ years: 0, months: 1, days: 1, totalDays: 29 });
  });

  it('measures exactly one year across a leap day', () => {
    expect(dateDifference(d(2024, 2, 29), d(2025, 2, 28))).toMatchObject({ years: 0, months: 11, days: 30 });
    expect(dateDifference(d(2024, 3, 1), d(2025, 3, 1))).toMatchObject({ years: 1, months: 0, days: 0, totalDays: 365 });
  });

  it('splits total days into weeks and a remainder', () => {
    expect(dateDifference(d(2026, 3, 1), d(2026, 3, 11))).toMatchObject({ totalDays: 10, weeks: 1, remainderDays: 3 });
  });

  it('counts business days, excluding the end date by default', () => {
    expect(dateDifference(d(2026, 3, 2), d(2026, 3, 6))).toMatchObject({ totalDays: 4, businessDays: 4, weekendDays: 0 });
    expect(dateDifference(d(2026, 3, 6), d(2026, 3, 9))).toMatchObject({ totalDays: 3, businessDays: 1, weekendDays: 2 });
    expect(dateDifference(d(2026, 1, 1), d(2027, 1, 1)).businessDays).toBe(261);
  });

  it('counts both ends when asked', () => {
    expect(dateDifference(d(2026, 3, 2), d(2026, 3, 6), { includeEndDate: true })).toMatchObject({
      totalDays: 5,
      businessDays: 5,
      weekendDays: 0,
    });
    expect(dateDifference(d(2026, 3, 14), d(2026, 3, 14), { includeEndDate: true })).toMatchObject({
      totalDays: 1,
      businessDays: 0,
      weekendDays: 1,
    });
  });

  it('copes with the full supported span', () => {
    const diff = dateDifference(d(1, 1, 1), d(9999, 12, 31));
    expect(diff.years).toBe(9998);
    expect(diff.totalDays).toBe(3_652_058);
  });
});

describe('describeBreakdown', () => {
  it('pluralises and drops zero parts', () => {
    expect(describeBreakdown({ years: 1, months: 2, days: 3 })).toBe('1 year, 2 months, 3 days');
    expect(describeBreakdown({ years: 0, months: 1, days: 0 })).toBe('1 month');
    expect(describeBreakdown({ years: 0, months: 0, days: 0 })).toBe('0 days');
  });
});

describe('todayLocal', () => {
  it('reads the local calendar date', () => {
    expect(todayLocal(new Date(2026, 2, 14, 23, 59))).toEqual(d(2026, 3, 14));
  });
});
