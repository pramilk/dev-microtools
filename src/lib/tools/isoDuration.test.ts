import { describe, it, expect } from 'vitest';
import {
  parseIsoDuration,
  formatIsoDuration,
  describeDuration,
  durationTotals,
  applyDuration,
  secondsToDuration,
  durationFromFields,
  type IsoDuration,
} from './isoDuration';

const zero: IsoDuration = { negative: false, years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
const parse = (input: string) => {
  const result = parseIsoDuration(input);
  if (!result.ok) throw new Error(`${input}: ${result.error}`);
  return result.value;
};

describe('parseIsoDuration — valid input', () => {
  it('parses every unit', () => {
    expect(parse('P3Y6M4DT12H30M5S').duration).toEqual({
      ...zero,
      years: 3,
      months: 6,
      days: 4,
      hours: 12,
      minutes: 30,
      seconds: 5,
    });
  });

  it('tells months from minutes by position', () => {
    expect(parse('P1M').duration).toMatchObject({ months: 1, minutes: 0 });
    expect(parse('PT1M').duration).toMatchObject({ months: 0, minutes: 1 });
    expect(parse('P1MT1M').duration).toMatchObject({ months: 1, minutes: 1 });
  });

  it('parses weeks, time-only and date-only forms', () => {
    expect(parse('P2W').duration.weeks).toBe(2);
    expect(parse('PT36H').duration.hours).toBe(36);
    expect(parse('P10D').duration.days).toBe(10);
    expect(parse('PT0S').duration.seconds).toBe(0);
  });

  it('accepts a decimal fraction on the last unit, with a dot or a comma', () => {
    expect(parse('PT0.5S').duration.seconds).toBe(0.5);
    expect(parse('PT1,5H').duration.hours).toBe(1.5);
    expect(parse('P1DT0.25H').duration).toMatchObject({ days: 1, hours: 0.25 });
  });

  it('accepts signs and lower case, and ignores surrounding whitespace', () => {
    expect(parse('-P1D').duration).toMatchObject({ negative: true, days: 1 });
    expect(parse('+P1D').duration.negative).toBe(false);
    expect(parse('  pt1h30m ').duration).toMatchObject({ hours: 1, minutes: 30 });
  });

  it('handles very large values without losing the digits', () => {
    expect(parse('P999999999D').duration.days).toBe(999_999_999);
  });
});

describe('parseIsoDuration — warnings', () => {
  it('warns about weeks mixed with other units, but accepts them', () => {
    const parsed = parse('P1W2D');
    expect(parsed.duration).toMatchObject({ weeks: 1, days: 2 });
    expect(parsed.warnings.join(' ')).toMatch(/weeks/i);
  });

  it('warns about an all-zero duration', () => {
    expect(parse('P0D').warnings.join(' ')).toMatch(/empty/i);
  });

  it('has no warnings for ordinary input', () => {
    expect(parse('PT1H30M').warnings).toEqual([]);
  });
});

describe('parseIsoDuration — malformed input', () => {
  const cases: [input: string, message: RegExp][] = [
    ['', /enter an iso 8601 duration/i],
    ['   ', /enter an iso 8601 duration/i],
    ['1D', /starts with "P"/],
    ['3 days', /starts with "P"/],
    ['P', /at least one unit/i],
    ['PT', /at least one time unit/i],
    ['P1DT', /at least one time unit/i],
    ['P1H', /could not read/i], // H before T
    ['PT1D', /could not read/i], // D after T
    ['P1D1Y', /could not read/i], // wrong order
    ['PTH', /could not read/i],
    ['P1.5DT2H', /smallest unit/i],
    ['PT1.5H30M', /smallest unit/i],
    ['P-1D', /could not read/i],
    ['P1Y2', /could not read/i],
    ['P1D P2D', /could not read/i],
    ['P1e3D', /could not read/i],
  ];
  it.each(cases)('rejects %j with a helpful message', (input, message) => {
    const result = parseIsoDuration(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it('rejects a number too large to represent', () => {
    const result = parseIsoDuration(`P${'9'.repeat(400)}D`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('rejects non-ASCII digits and look-alike letters', () => {
    expect(parseIsoDuration('P١D').ok).toBe(false);
    expect(parseIsoDuration('Р1D').ok).toBe(false); // Cyrillic Р
  });
});

describe('formatIsoDuration', () => {
  it('writes canonical text and drops zero units', () => {
    expect(formatIsoDuration({ ...zero, years: 3, months: 6, days: 4, hours: 12, minutes: 30, seconds: 5 })).toBe(
      'P3Y6M4DT12H30M5S'
    );
    expect(formatIsoDuration({ ...zero, hours: 36 })).toBe('PT36H');
    expect(formatIsoDuration({ ...zero, days: 1 })).toBe('P1D');
  });

  it('writes PT0S for an empty duration', () => {
    expect(formatIsoDuration(zero)).toBe('PT0S');
    expect(formatIsoDuration({ ...zero, negative: true })).toBe('PT0S');
  });

  it('keeps the sign and fractions', () => {
    expect(formatIsoDuration({ ...zero, negative: true, days: 2 })).toBe('-P2D');
    expect(formatIsoDuration({ ...zero, seconds: 0.5 })).toBe('PT0.5S');
  });

  it('does not leak floating-point tails', () => {
    expect(formatIsoDuration({ ...zero, seconds: 0.1 + 0.2 })).toBe('PT0.3S');
  });

  it('round-trips with the parser', () => {
    for (const text of ['P3Y6M4DT12H30M5S', 'PT36H', 'P2W', 'PT0.5S', '-P1DT1H']) {
      expect(formatIsoDuration(parse(text).duration)).toBe(text);
    }
  });
});

describe('describeDuration', () => {
  it('lists the units in words, singular and plural', () => {
    expect(describeDuration(parse('P3Y6M4DT12H30M5S').duration)).toBe(
      '3 years, 6 months, 4 days, 12 hours, 30 minutes, 5 seconds'
    );
    expect(describeDuration(parse('P1YT1H').duration)).toBe('1 year, 1 hour');
  });

  it('handles fractions, negatives and zero', () => {
    expect(describeDuration(parse('PT1.5H').duration)).toBe('1.5 hours');
    expect(describeDuration(parse('-P2D').duration)).toBe('Minus 2 days');
    expect(describeDuration(zero)).toBe('0 seconds');
  });
});

describe('durationTotals', () => {
  it('is exact when only weeks and smaller units are used', () => {
    expect(durationTotals(parse('PT1H30M').duration)).toEqual({ seconds: 5400, approximate: false });
    expect(durationTotals(parse('P1W').duration)).toEqual({ seconds: 604_800, approximate: false });
    expect(durationTotals(parse('-PT1M').duration)).toEqual({ seconds: -60, approximate: false });
  });

  it('flags years and months as approximate', () => {
    const totals = durationTotals(parse('P1Y').duration);
    expect(totals.approximate).toBe(true);
    expect(totals.seconds).toBeCloseTo(31_556_952, 0);
    expect(durationTotals(parse('P1M').duration).approximate).toBe(true);
  });
});

describe('applyDuration', () => {
  const at = (iso: string) => Date.parse(iso);
  const apply = (iso: string, duration: string) => {
    const result = applyDuration(at(iso), parse(duration).duration);
    return result.ok ? new Date(result.value).toISOString() : result.error;
  };

  it('adds exact elapsed time', () => {
    expect(apply('2026-03-14T09:00:00Z', 'PT1H30M')).toBe('2026-03-14T10:30:00.000Z');
    expect(apply('2026-03-14T09:00:00Z', 'P1W')).toBe('2026-03-21T09:00:00.000Z');
    expect(apply('2026-03-14T09:00:00Z', 'PT0.5S')).toBe('2026-03-14T09:00:00.500Z');
  });

  it('moves the calendar for years and months, clamping the day', () => {
    expect(apply('2026-01-31T10:00:00Z', 'P1M')).toBe('2026-02-28T10:00:00.000Z');
    expect(apply('2024-02-29T10:00:00Z', 'P1Y')).toBe('2025-02-28T10:00:00.000Z');
    expect(apply('2026-11-15T00:00:00Z', 'P3M')).toBe('2027-02-15T00:00:00.000Z');
  });

  it('subtracts a negative duration', () => {
    expect(apply('2026-03-14T09:00:00Z', '-P1DT1H')).toBe('2026-03-13T08:00:00.000Z');
    expect(apply('2026-03-31T00:00:00Z', '-P1M')).toBe('2026-02-28T00:00:00.000Z');
  });

  it('does not shift with daylight saving — a day is 24 hours in UTC', () => {
    expect(apply('2026-03-07T12:00:00Z', 'P1D')).toBe('2026-03-08T12:00:00.000Z');
  });

  it('refuses fractional years and months', () => {
    expect(apply('2026-03-14T00:00:00Z', 'P1.5Y')).toMatch(/fractional/i);
    expect(apply('2026-03-14T00:00:00Z', 'P0.5M')).toMatch(/fractional/i);
  });

  it('refuses results beyond the representable range', () => {
    expect(apply('2026-03-14T00:00:00Z', 'P999999999999D')).toMatch(/outside the range/i);
  });

  it('refuses an invalid start', () => {
    expect(applyDuration(Number.NaN, parse('P1D').duration).ok).toBe(false);
  });
});

describe('secondsToDuration', () => {
  it('splits seconds into days, hours, minutes and seconds', () => {
    const result = secondsToDuration(93_784);
    expect(result.ok && formatIsoDuration(result.value)).toBe('P1DT2H3M4S');
  });

  it('handles zero, fractions and negatives', () => {
    const zeroResult = secondsToDuration(0);
    expect(zeroResult.ok && formatIsoDuration(zeroResult.value)).toBe('PT0S');
    const fraction = secondsToDuration(90.1);
    expect(fraction.ok && formatIsoDuration(fraction.value)).toBe('PT1M30.1S');
    const negative = secondsToDuration(-3600);
    expect(negative.ok && formatIsoDuration(negative.value)).toBe('-PT1H');
  });

  it('rejects non-finite and absurd input', () => {
    expect(secondsToDuration(Number.NaN).ok).toBe(false);
    expect(secondsToDuration(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(secondsToDuration(1e13).ok).toBe(false);
  });
});

describe('durationFromFields', () => {
  const blank = { years: '', months: '', weeks: '', days: '', hours: '', minutes: '', seconds: '' };

  it('builds from filled-in fields and ignores blank ones', () => {
    const result = durationFromFields({ ...blank, days: '3', hours: '4' });
    expect(result.ok && formatIsoDuration(result.value.duration)).toBe('P3DT4H');
  });

  it('is PT0S when everything is blank', () => {
    const result = durationFromFields(blank);
    expect(result.ok && formatIsoDuration(result.value.duration)).toBe('PT0S');
  });

  it('carries the negative flag', () => {
    const result = durationFromFields({ ...blank, minutes: '5' }, true);
    expect(result.ok && formatIsoDuration(result.value.duration)).toBe('-PT5M');
  });

  it('rejects negative and non-numeric entries, naming the unit', () => {
    const negative = durationFromFields({ ...blank, hours: '-2' });
    expect(!negative.ok && negative.error).toMatch(/hours/);
    const junk = durationFromFields({ ...blank, days: 'abc' });
    expect(!junk.ok && junk.error).toMatch(/days/);
  });

  it('applies the same fraction rule as typed input', () => {
    const result = durationFromFields({ ...blank, days: '1.5', hours: '2' });
    expect(!result.ok && result.error).toMatch(/smallest unit/i);
  });
});
