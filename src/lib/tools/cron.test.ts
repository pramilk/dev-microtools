import { describe, it, expect } from 'vitest';
import { parseCronExpression, nextCronRuns, CRON_MACROS, CRON_PRESETS } from './cron';

const expectDescription = (expr: string, expected: string) => {
  const result = parseCronExpression(expr);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.description).toBe(expected);
};

describe('parseCronExpression', () => {
  describe('description text', () => {
    it('describes a fixed daily time', () => {
      expectDescription('0 9 * * *', 'At 09:00.');
    });

    it('describes every minute', () => {
      expectDescription('* * * * *', 'Every minute.');
    });

    it('describes a step interval', () => {
      expectDescription('*/15 * * * *', 'Every 15 minutes.');
    });

    it('describes a fixed minute with a wildcard hour', () => {
      expectDescription('0 * * * *', 'At minute 0, every hour.');
    });

    it('describes every minute during a restricted hour range', () => {
      expectDescription('* 9-17 * * *', 'Every minute, hours 9 through 17.');
    });

    it('describes a weekday restriction', () => {
      expectDescription('0 9 * * 1-5', 'At 09:00, Monday through Friday.');
    });

    it('describes a day-of-month restriction', () => {
      expectDescription('0 0 1 * *', 'At 00:00, day-of-month 1st.');
    });

    it('describes a day-of-month and month restriction together', () => {
      expectDescription('0 0 1 1 *', 'At 00:00, day-of-month 1st, in January.');
    });

    it('describes a list of days of the month with ordinals', () => {
      expectDescription('0 0 1,15 * *', 'At 00:00, day-of-month 1st and 15th.');
    });

    it('spells out the OR relationship when both day-of-month and day-of-week are restricted', () => {
      expectDescription('0 0 1 * 1', 'At 00:00, day-of-month 1st, or on Monday.');
    });

    it('accepts month and day-of-week names', () => {
      const named = parseCronExpression('0 9 * JAN MON');
      const numeric = parseCronExpression('0 9 * 1 1');
      expect(named.ok).toBe(true);
      expect(numeric.ok).toBe(true);
      if (named.ok && numeric.ok) expect(named.value.description).toBe(numeric.value.description);
    });

    it('describes a stepped range', () => {
      expectDescription('10-40/10 * * * *', 'Every 10 minutes from 10 through 40.');
    });
  });

  describe('macros', () => {
    it('expands every documented @-shortcut without error', () => {
      for (const macro of Object.keys(CRON_MACROS)) {
        expect(parseCronExpression(macro).ok).toBe(true);
      }
    });

    it('is case-insensitive for shortcuts', () => {
      expect(parseCronExpression('@DAILY').ok).toBe(true);
    });

    it('rejects @reboot with an explanation rather than a generic error', () => {
      const result = parseCronExpression('@reboot');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/startup/i);
    });

    it('rejects an unknown shortcut', () => {
      const result = parseCronExpression('@fortnightly');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/unknown shortcut/i);
    });

    it('every preset parses successfully', () => {
      for (const preset of CRON_PRESETS) {
        expect(parseCronExpression(preset.expression).ok).toBe(true);
      }
    });
  });

  describe('validation', () => {
    it('rejects an empty expression', () => {
      const result = parseCronExpression('');
      expect(result.ok).toBe(false);
    });

    it('rejects the wrong number of fields', () => {
      const result = parseCronExpression('0 9 * *');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/5 fields/);
    });

    it('rejects a 6-field seconds-based expression with a clear message', () => {
      const result = parseCronExpression('0 0 9 * * *');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/seconds column/i);
    });

    it('rejects an out-of-range value', () => {
      const result = parseCronExpression('60 9 * * *');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/out of range/i);
    });

    it('rejects a non-numeric value', () => {
      const result = parseCronExpression('abc 9 * * *');
      expect(result.ok).toBe(false);
    });

    it('rejects a backwards range instead of silently wrapping', () => {
      const result = parseCronExpression('0 22-2 * * *');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/backwards/i);
    });

    it('rejects an invalid step', () => {
      const result = parseCronExpression('*/0 * * * *');
      expect(result.ok).toBe(false);
    });

    it('rejects a malformed range', () => {
      const result = parseCronExpression('1-2-3 * * * *');
      expect(result.ok).toBe(false);
    });
  });
});

describe('nextCronRuns', () => {
  it('returns the next N daily runs at a fixed time', () => {
    const parsed = parseCronExpression('30 9 * * *');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const from = new Date(2026, 0, 1, 0, 0, 0); // 2026-01-01 00:00 local
    const runs = nextCronRuns(parsed.value, 3, from);

    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual(new Date(2026, 0, 1, 9, 30, 0));
    expect(runs[1]).toEqual(new Date(2026, 0, 2, 9, 30, 0));
    expect(runs[2]).toEqual(new Date(2026, 0, 3, 9, 30, 0));
  });

  it('skips ahead across a month boundary for a fixed day-of-month', () => {
    const parsed = parseCronExpression('0 0 1 * *');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const from = new Date(2026, 0, 15, 0, 0, 0); // mid-January
    const runs = nextCronRuns(parsed.value, 2, from);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(new Date(2026, 1, 1, 0, 0, 0)); // Feb 1
    expect(runs[1]).toEqual(new Date(2026, 2, 1, 0, 0, 0)); // Mar 1
  });

  it('honours the day-of-month OR day-of-week rule when both are restricted', () => {
    const parsed = parseCronExpression('0 0 1 * 1'); // 1st of month OR every Monday
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const from = new Date(2026, 0, 1, 0, 30, 0); // just after Jan 1 fired
    const runs = nextCronRuns(parsed.value, 1, from);

    expect(runs).toHaveLength(1);
    // The next Monday after Jan 1, 2026 (a Thursday) is Jan 5.
    expect(runs[0]).toEqual(new Date(2026, 0, 5, 0, 0, 0));
  });

  it('returns an empty array (not a hang) for an impossible date within the search window', () => {
    const parsed = parseCronExpression('0 0 30 2 *'); // February 30th never exists
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const runs = nextCronRuns(parsed.value, 1, new Date(2026, 0, 1), 4);
    expect(runs).toHaveLength(0);
  });

  it('respects a weekday-only restriction, skipping the weekend', () => {
    const parsed = parseCronExpression('0 9 * * 1-5');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // 2026-01-02 is a Friday.
    const from = new Date(2026, 0, 2, 10, 0, 0);
    const runs = nextCronRuns(parsed.value, 1, from);

    expect(runs).toHaveLength(1);
    // Next weekday 09:00 after Friday 10:00 is Monday 2026-01-05.
    expect(runs[0]).toEqual(new Date(2026, 0, 5, 9, 0, 0));
  });
});
