import { describe, it, expect } from 'vitest';
import { explainCron, CRON_PRESETS_BY_DIALECT, CRON_DIALECTS, type CronDialect } from './cronDialects';
import { nextScheduleRuns } from './cronSchedule';

const describeIt = (expression: string, dialect: CronDialect): string => {
  const result = explainCron(expression, dialect);
  if (!result.ok) throw new Error(`${expression}: ${result.error}`);
  return result.value.description;
};

const runs = (expression: string, dialect: CronDialect, count: number, from: string, zone = 'UTC'): string[] => {
  const result = explainCron(expression, dialect);
  if (!result.ok) throw new Error(`${expression}: ${result.error}`);
  if (!result.value.schedule) throw new Error('no schedule');
  return nextScheduleRuns(result.value.schedule, count, new Date(from), zone).map((date) => date.toISOString());
};

const errorFor = (expression: string, dialect: CronDialect): string => {
  const result = explainCron(expression, dialect);
  if (result.ok) throw new Error(`${expression} unexpectedly parsed: ${result.value.description}`);
  return result.error;
};

describe('Quartz — descriptions', () => {
  const cases: [string, string][] = [
    ['0 0 12 * * ?', 'At 12:00.'],
    ['0 0/5 14 * * ?', 'Every 5 minutes, during hour 14.'],
    ['0 15 10 ? * MON-FRI', 'At 10:15, on Monday through Friday.'],
    ['0 * * * * ?', 'Every minute.'],
    ['*/10 * * * * ?', 'Every 10 seconds.'],
    ['0/30 * * * * ?', 'Every 30 seconds.'],
    ['30 15 10 * * ?', 'At 10:15:30.'],
    ['0 0 0 L * ?', 'At 00:00, on the last day of the month.'],
    ['0 0 12 L-3 * ?', 'At 12:00, on the date 3 days before the last day of the month.'],
    ['0 0 12 LW * ?', 'At 12:00, on the last weekday of the month.'],
    ['0 0 9 15W * ?', 'At 09:00, on the weekday nearest the 15th of the month.'],
    ['0 0 12 ? * 6L', 'At 12:00, on the last Friday of the month.'],
    ['0 0 9 ? * 2#3', 'At 09:00, on the 3rd Monday of the month.'],
    ['0 0 12 1,15 * ?', 'At 12:00, on the 1st and 15th of the month.'],
    ['0 0 12 ? JAN,MAR *', 'At 12:00, in January and March.'],
    ['0 30 9 ? * MON 2026', 'At 09:30, on Monday, in 2026.'],
    ['0 0 12 ? * MON 2026-2030', 'At 12:00, on Monday, in 2026 through 2030.'],
    ['0 0/15 8-17 ? * MON-FRI', 'Every 15 minutes, during hours 8 through 17, on Monday through Friday.'],
    ['0 0 12 ? * L', 'At 12:00, on Saturday.'],
  ];
  it.each(cases)('%s → %s', (expression, expected) => {
    expect(describeIt(expression, 'quartz')).toBe(expected);
  });

  it('accepts lower-case names', () => {
    expect(describeIt('0 0 12 ? jan mon-fri', 'quartz')).toBe('At 12:00, on Monday through Friday, in January.');
  });

  it('accepts wrap-around ranges', () => {
    const result = explainCron('0 0 22-2 * * ?', 'quartz');
    expect(result.ok && [...result.value.schedule!.hours].sort((a, b) => a - b)).toEqual([0, 1, 2, 22, 23]);
  });
});

describe('Quartz — errors', () => {
  const cases: [string, RegExp][] = [
    ['', /enter a cron expression/i],
    ['* * * * *', /needs 6 fields.*got 5.*Unix/i],
    ['0 0 12 * * * * *', /got 8/],
    ['0 0 12 * * *', /can't take both/i],
    ['0 0 12 1 * MON', /can't take both/i],
    ['0 0 12 ? * ?', /only one of day-of-month and day-of-week/i],
    ['0 0 12 ? * 0', /1 \(Sunday\) to 7 \(Saturday\)/],
    ['0 0 12 ? * 8', /day-of-week.*out of range/],
    ['0 0 25 * * ?', /hour.*out of range/],
    ['60 0 12 * * ?', /second.*out of range/],
    ['0 0 12 ? 13 *', /month.*out of range/],
    ['0 0 12 32 * ?', /day-of-month.*out of range/],
    ['? 0 12 * * ?', /"\?" is only allowed in the day-of-month and day-of-week/],
    ['0 0 12 ? * 1,,2', /empty item/],
    ['0 0 12 ? * MON#6', /1 to 5/],
    ['0 0 12 L-40 * ?', /out of range/],
    ['0 0 12 0W * ?', /out of range/],
    ['0 0/0 12 * * ?', /valid step/],
    ['0 0/x 12 * * ?', /valid step/],
    ['0 0 12 ? * MON 1900', /year.*out of range/],
    ['0 0 12 ? * MON 2100', /year.*out of range/],
    ['0 0 1-2-3 * * ?', /not a valid range/],
    ['0 0 1//2 * * ?', /more than one "\/"/],
    ['0 0 abc * * ?', /out of range/],
  ];
  it.each(cases)('rejects %j', (expression, message) => {
    expect(errorFor(expression, 'quartz')).toMatch(message);
  });
});

describe('AWS EventBridge', () => {
  const cases: [string, string][] = [
    ['0 12 * * ? *', 'At 12:00.'],
    ['cron(0 12 * * ? *)', 'At 12:00.'],
    ['CRON( 0 12 * * ? * )', 'At 12:00.'],
    ['0/15 * * * ? *', 'Every 15 minutes.'],
    ['15 10 ? * MON-FRI *', 'At 10:15, on Monday through Friday.'],
    ['0 8 ? * 2#1 *', 'At 08:00, on the 1st Monday of the month.'],
    ['0 0 L * ? *', 'At 00:00, on the last day of the month.'],
    ['0 18 ? * MON-FRI 2026-2027', 'At 18:00, on Monday through Friday, in 2026 through 2027.'],
  ];
  it.each(cases)('%s → %s', (expression, expected) => {
    expect(describeIt(expression, 'aws')).toBe(expected);
  });

  it('notes that EventBridge cron runs in UTC', () => {
    const result = explainCron('0 12 * * ? *', 'aws');
    expect(result.ok && result.value.note).toMatch(/UTC/);
  });

  it('describes rate expressions without a schedule', () => {
    for (const [expression, expected] of [
      ['rate(5 minutes)', 'Every 5 minutes.'],
      ['rate(1 hour)', 'Every hour.'],
      ['RATE( 2 days )', 'Every 2 days.'],
    ] as const) {
      const result = explainCron(expression, 'aws');
      expect(result.ok && result.value.description).toBe(expected);
      expect(result.ok && result.value.schedule).toBeNull();
    }
  });

  it('rejects malformed rate expressions', () => {
    expect(errorFor('rate(1 minutes)', 'aws')).toMatch(/singular/);
    expect(errorFor('rate(5 minute)', 'aws')).toMatch(/plural/);
    expect(errorFor('rate(0 minutes)', 'aws')).toMatch(/at least 1/);
    expect(errorFor('rate(5 weeks)', 'aws')).toMatch(/6 fields/);
  });

  it('requires exactly 6 fields, with a year', () => {
    expect(errorFor('0 12 * * ?', 'aws')).toMatch(/exactly 6 fields.*year is required/i);
    expect(errorFor('0 0 12 * * ? *', 'aws')).toMatch(/exactly 6 fields.*got 7/i);
  });

  it('applies the day-of-month / day-of-week rule', () => {
    expect(errorFor('0 12 * * * *', 'aws')).toMatch(/can't take both/i);
    expect(errorFor('0 12 ? * ? *', 'aws')).toMatch(/only one/i);
  });

  it('allows years up to 2199 but not Quartz-style 2099+ cutoffs', () => {
    expect(explainCron('0 12 * * ? 2150', 'aws').ok).toBe(true);
    expect(explainCron('0 12 * * ? 2200', 'aws').ok).toBe(false);
  });
});

describe('Unix dialect', () => {
  it('delegates to the 5-field parser', () => {
    expect(describeIt('*/5 * * * *', 'unix')).toBe('Every 5 minutes.');
  });

  it('points a Quartz-shaped expression at the syntax selector', () => {
    expect(errorFor('0 0 12 * * ?', 'unix')).toMatch(/switch the syntax/i);
    expect(errorFor('0 0 12 * * ? *', 'unix')).toMatch(/switch the syntax/i);
  });

  it('does not add the hint to unrelated errors', () => {
    expect(errorFor('61 * * * *', 'unix')).not.toMatch(/switch the syntax/i);
    expect(errorFor('@reboot', 'unix')).not.toMatch(/switch the syntax/i);
  });

  it('rejects empty input', () => {
    expect(errorFor('   ', 'unix')).toMatch(/enter a cron expression/i);
  });
});

describe('next runs — Quartz specials', () => {
  it('lists daily runs', () => {
    expect(runs('0 0 12 * * ?', 'quartz', 3, '2026-03-14T00:00:00Z')).toEqual([
      '2026-03-14T12:00:00.000Z',
      '2026-03-15T12:00:00.000Z',
      '2026-03-16T12:00:00.000Z',
    ]);
  });

  it('finds the last day of each month, including February in a leap year', () => {
    expect(runs('0 0 0 L * ?', 'quartz', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-31T00:00:00.000Z',
      '2026-04-30T00:00:00.000Z',
      '2026-05-31T00:00:00.000Z',
    ]);
    expect(runs('0 0 0 L 2 ?', 'quartz', 2, '2027-03-01T00:00:00Z')).toEqual([
      '2028-02-29T00:00:00.000Z',
      '2029-02-28T00:00:00.000Z',
    ]);
  });

  it('finds the nth day before month end', () => {
    expect(runs('0 0 12 L-3 * ?', 'quartz', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-28T12:00:00.000Z',
      '2026-04-27T12:00:00.000Z',
      '2026-05-28T12:00:00.000Z',
    ]);
  });

  it('finds the last weekday of the month', () => {
    // 31 May 2026 is a Sunday, so the last weekday is Friday the 29th.
    expect(runs('0 0 12 LW * ?', 'quartz', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-31T12:00:00.000Z',
      '2026-04-30T12:00:00.000Z',
      '2026-05-29T12:00:00.000Z',
    ]);
  });

  it('finds the weekday nearest a day, without leaving the month', () => {
    // 15 Mar 2026 is a Sunday -> Monday 16th; 15 Apr is a Wednesday; 15 May is a Friday.
    expect(runs('0 0 9 15W * ?', 'quartz', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-16T09:00:00.000Z',
      '2026-04-15T09:00:00.000Z',
      '2026-05-15T09:00:00.000Z',
    ]);
    // 1 Aug 2026 is a Saturday: the nearest weekday inside August is Monday the 3rd, not 31 July.
    expect(runs('0 0 9 1W 8 ?', 'quartz', 1, '2026-07-01T00:00:00Z')).toEqual(['2026-08-03T09:00:00.000Z']);
    // 31 May 2026 is a Sunday: nearest weekday inside May is Friday the 29th, not 1 June.
    expect(runs('0 0 9 31W 5 ?', 'quartz', 1, '2026-05-01T00:00:00Z')).toEqual(['2026-05-29T09:00:00.000Z']);
  });

  it('skips nW in months that are too short', () => {
    expect(runs('0 0 9 31W * ?', 'quartz', 2, '2026-04-01T00:00:00Z')).toEqual([
      '2026-05-29T09:00:00.000Z',
      '2026-07-31T09:00:00.000Z',
    ]);
  });

  it('finds the last given weekday of the month', () => {
    expect(runs('0 0 12 ? * 6L', 'quartz', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-27T12:00:00.000Z',
      '2026-04-24T12:00:00.000Z',
      '2026-05-29T12:00:00.000Z',
    ]);
  });

  it('finds the nth weekday of the month', () => {
    expect(runs('0 0 9 ? * 2#3', 'quartz', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-16T09:00:00.000Z',
      '2026-04-20T09:00:00.000Z',
      '2026-05-18T09:00:00.000Z',
    ]);
  });

  it('only returns a fifth occurrence in months that have one', () => {
    // Fifth Friday: 2026 has them in January (30th), May (29th), and virtually nowhere in between.
    expect(runs('0 0 9 ? * 6#5', 'quartz', 2, '2026-01-01T00:00:00Z')).toEqual([
      '2026-01-30T09:00:00.000Z',
      '2026-05-29T09:00:00.000Z',
    ]);
  });

  it('numbers weekdays from Sunday = 1', () => {
    // 1 = Sunday: the next Sunday after Sat 14 Mar 2026 is the 15th.
    expect(runs('0 0 8 ? * 1', 'quartz', 1, '2026-03-14T00:00:00Z')).toEqual(['2026-03-15T08:00:00.000Z']);
    expect(runs('0 0 8 ? * SUN', 'quartz', 1, '2026-03-14T00:00:00Z')).toEqual(['2026-03-15T08:00:00.000Z']);
  });

  it('respects the year field and stops when it runs out', () => {
    expect(runs('0 30 9 ? * MON 2026', 'quartz', 3, '2026-12-20T00:00:00Z')).toEqual([
      '2026-12-21T09:30:00.000Z',
      '2026-12-28T09:30:00.000Z',
    ]);
    expect(runs('0 0 12 * * ? 2020', 'quartz', 3, '2026-01-01T00:00:00Z')).toEqual([]);
  });

  it('handles wrapped hour ranges across midnight', () => {
    expect(runs('0 0 22-1 * * ?', 'quartz', 4, '2026-03-14T20:00:00Z')).toEqual([
      '2026-03-14T22:00:00.000Z',
      '2026-03-14T23:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
      '2026-03-15T01:00:00.000Z',
    ]);
  });
});

describe('next runs — seconds', () => {
  it('steps through seconds, strictly after the start moment', () => {
    expect(runs('*/20 * * * * ?', 'quartz', 3, '2026-03-14T00:00:00Z')).toEqual([
      '2026-03-14T00:00:20.000Z',
      '2026-03-14T00:00:40.000Z',
      '2026-03-14T00:01:00.000Z',
    ]);
  });

  it('is quick even for a schedule that fires every second', () => {
    const started = performance.now();
    const list = runs('* * * * * ?', 'quartz', 10, '2026-03-14T23:59:55Z');
    expect(list).toHaveLength(10);
    expect(list[4]).toBe('2026-03-15T00:00:00.000Z');
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('next runs — time zones', () => {
  it('evaluates the schedule on the wall clock of the chosen zone', () => {
    expect(runs('0 0 9 * * ?', 'quartz', 2, '2026-01-15T00:00:00Z', 'Asia/Kolkata')).toEqual([
      '2026-01-15T03:30:00.000Z',
      '2026-01-16T03:30:00.000Z',
    ]);
  });

  it('follows the daylight-saving change', () => {
    // New York leaves EST (UTC-5) for EDT (UTC-4) overnight on 8 March 2026.
    expect(runs('0 0 12 * * ?', 'quartz', 3, '2026-03-07T00:00:00Z', 'America/New_York')).toEqual([
      '2026-03-07T17:00:00.000Z',
      '2026-03-08T16:00:00.000Z',
      '2026-03-09T16:00:00.000Z',
    ]);
  });

  it('does not fire at a wall time that spring-forward skips', () => {
    expect(runs('0 30 2 * * ?', 'quartz', 3, '2026-03-07T00:00:00Z', 'America/New_York')).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z',
      '2026-03-10T06:30:00.000Z',
    ]);
  });

  it('fires once when fall-back repeats a wall time', () => {
    const list = runs('0 30 1 * * ?', 'quartz', 3, '2026-10-31T00:00:00Z', 'America/New_York');
    expect(list).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T05:30:00.000Z', // the first 01:30, still EDT
      '2026-11-02T06:30:00.000Z',
    ]);
  });

  it('starts from the right local day when UTC and the zone are on different dates', () => {
    // 23:30 UTC on 14 March is already 08:30 on the 15th in Tokyo.
    expect(runs('0 0 9 * * ?', 'quartz', 1, '2026-03-14T23:30:00Z', 'Asia/Tokyo')).toEqual(['2026-03-15T00:00:00.000Z']);
  });
});

describe('next runs — Unix 5-field', () => {
  it('lists weekday mornings', () => {
    expect(runs('0 9 * * 1-5', 'unix', 3, '2026-03-13T10:00:00Z')).toEqual([
      '2026-03-16T09:00:00.000Z',
      '2026-03-17T09:00:00.000Z',
      '2026-03-18T09:00:00.000Z',
    ]);
  });

  it('ORs day-of-month and day-of-week when both are set', () => {
    // The 13th of the month, or any Friday.
    expect(runs('0 0 13 * 5', 'unix', 3, '2026-03-01T00:00:00Z')).toEqual([
      '2026-03-06T00:00:00.000Z',
      '2026-03-13T00:00:00.000Z',
      '2026-03-20T00:00:00.000Z',
    ]);
  });

  it('treats 0 and 7 as Sunday', () => {
    expect(runs('0 0 * * 7', 'unix', 1, '2026-03-14T00:00:00Z')).toEqual(['2026-03-15T00:00:00.000Z']);
  });

  it('respects the chosen zone', () => {
    expect(runs('0 9 * * *', 'unix', 1, '2026-03-14T00:00:00Z', 'America/Los_Angeles')).toEqual(['2026-03-14T16:00:00.000Z']);
  });

  it('finds 29 February and gives up on impossible dates', () => {
    expect(runs('0 0 29 2 *', 'unix', 1, '2026-03-01T00:00:00Z')).toEqual(['2028-02-29T00:00:00.000Z']);
    expect(runs('0 0 30 2 *', 'unix', 3, '2026-03-01T00:00:00Z')).toEqual([]);
  });
});

describe('nextScheduleRuns — edge cases', () => {
  it('returns nothing for a count of zero or less', () => {
    const result = explainCron('0 0 12 * * ?', 'quartz');
    if (!result.ok || !result.value.schedule) throw new Error('expected a schedule');
    expect(nextScheduleRuns(result.value.schedule, 0, new Date('2026-03-14T00:00:00Z'), 'UTC')).toEqual([]);
    expect(nextScheduleRuns(result.value.schedule, -2, new Date('2026-03-14T00:00:00Z'), 'UTC')).toEqual([]);
  });

  it('handles the start of a run exactly on a firing time (strictly after)', () => {
    expect(runs('0 0 12 * * ?', 'quartz', 1, '2026-03-14T12:00:00Z')).toEqual(['2026-03-15T12:00:00.000Z']);
  });
});

describe('presets', () => {
  it('every preset parses in its own dialect', () => {
    for (const { id } of CRON_DIALECTS) {
      for (const preset of CRON_PRESETS_BY_DIALECT[id]) {
        const result = explainCron(preset.expression, id);
        expect(result.ok, `${id}: ${preset.label} (${preset.expression})`).toBe(true);
      }
    }
  });

  it('every non-rate preset yields upcoming runs', () => {
    for (const { id } of CRON_DIALECTS) {
      for (const preset of CRON_PRESETS_BY_DIALECT[id]) {
        const result = explainCron(preset.expression, id);
        if (!result.ok || !result.value.schedule) continue;
        const list = nextScheduleRuns(result.value.schedule, 2, new Date('2026-03-14T00:00:00Z'), 'UTC');
        expect(list.length, `${id}: ${preset.label}`).toBeGreaterThan(0);
      }
    }
  });
});
