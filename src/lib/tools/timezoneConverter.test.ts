import { describe, it, expect } from 'vitest';
import { convertBetweenZones, planMeeting, isoWithOffset } from './timezoneConverter';
import { wallTimeStatus } from './timeZone';

const wall = (year: number, month: number, day: number, hour: number, minute = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
  second: 0,
});

describe('convertBetweenZones', () => {
  it('converts one wall time into several zones', () => {
    const result = convertBetweenZones(wall(2026, 3, 14, 9), 'America/New_York', [
      'Europe/London',
      'Asia/Tokyo',
      'Asia/Kolkata',
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.iso).toBe('2026-03-14T13:00:00.000Z');
    const [london, tokyo, kolkata] = result.value.targets;
    expect(london!.wall.hour).toBe(13);
    expect(london!.offsetLabel).toBe('UTC');
    expect(tokyo!.wall.hour).toBe(22);
    expect(kolkata!.wall).toMatchObject({ hour: 18, minute: 30 });
    expect(kolkata!.offsetLabel).toBe('UTC+5:30');
  });

  it('reports a day shift when the target is on another calendar day', () => {
    const result = convertBetweenZones(wall(2026, 3, 14, 9), 'America/New_York', ['Australia/Sydney']);
    expect(result.ok && result.value.targets[0]!.dayShift).toBe(1);
    const backwards = convertBetweenZones(wall(2026, 3, 14, 1), 'Asia/Tokyo', ['America/Los_Angeles']);
    expect(backwards.ok && backwards.value.targets[0]!.dayShift).toBe(-1);
  });

  it('rejects a time that daylight saving skips', () => {
    const result = convertBetweenZones(wall(2026, 3, 8, 2, 30), 'America/New_York', ['UTC']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not exist/i);
  });

  it('notes — but accepts — a time that happens twice', () => {
    const result = convertBetweenZones(wall(2026, 11, 1, 1, 30), 'America/New_York', ['UTC']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iso).toBe('2026-11-01T05:30:00.000Z');
    expect(result.value.notes[0]).toMatch(/twice/i);
  });

  it('rejects unknown zones, naming the offender', () => {
    const badSource = convertBetweenZones(wall(2026, 1, 1, 0), 'Nowhere/Land', ['UTC']);
    expect(!badSource.ok && badSource.error).toMatch(/Nowhere\/Land/);
    const badTarget = convertBetweenZones(wall(2026, 1, 1, 0), 'UTC', ['UTC', 'Atlantis/Core']);
    expect(!badTarget.ok && badTarget.error).toMatch(/Atlantis\/Core/);
  });

  it('works with no target zones', () => {
    const result = convertBetweenZones(wall(2026, 1, 1, 0), 'UTC', []);
    expect(result.ok && result.value.targets).toEqual([]);
  });
});

describe('isoWithOffset', () => {
  it('writes Z for UTC and a signed offset otherwise', () => {
    expect(isoWithOffset(wall(2026, 3, 14, 13), 0)).toBe('2026-03-14T13:00:00Z');
    expect(isoWithOffset(wall(2026, 3, 14, 18, 30), 330)).toBe('2026-03-14T18:30:00+05:30');
    expect(isoWithOffset(wall(2026, 1, 5, 4), -300)).toBe('2026-01-05T04:00:00-05:00');
  });
});

describe('wallTimeStatus', () => {
  it('distinguishes gap, ambiguous and ordinary times', () => {
    expect(wallTimeStatus(wall(2026, 3, 8, 2, 30), 'America/New_York')).toBe('gap');
    expect(wallTimeStatus(wall(2026, 11, 1, 1, 30), 'America/New_York')).toBe('ambiguous');
    expect(wallTimeStatus(wall(2026, 6, 1, 12), 'America/New_York')).toBe('ok');
    expect(wallTimeStatus(wall(2026, 3, 8, 2, 30), 'Asia/Tokyo')).toBe('ok');
  });
});

describe('planMeeting', () => {
  it('finds the overlap of two zones working 9-17', () => {
    // January: New York is UTC-5, London UTC+0. Overlap is 14:00-17:00 UTC = 9:00-12:00 in New York.
    const plan = planMeeting({ year: 2026, month: 1, day: 15 }, 'America/New_York', ['Europe/London']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.value.rows.map((row) => row.zone)).toEqual(['America/New_York', 'Europe/London']);
    expect(plan.value.rows[0]!.cells).toHaveLength(24);
    expect(plan.value.commonWindows).toEqual([{ from: 9, to: 12 }]);
    expect(plan.value.rows[0]!.cells[9]).toMatchObject({ hour: 9, working: true, dayShift: 0 });
    expect(plan.value.rows[1]!.cells[9]).toMatchObject({ hour: 14, working: true });
  });

  it('reports no window when working days do not overlap', () => {
    // New York 9-17 is 14:00-22:00 UTC; Tokyo 9-17 is 00:00-08:00 UTC. No shared hour.
    const plan = planMeeting({ year: 2026, month: 1, day: 15 }, 'America/New_York', ['Asia/Tokyo']);
    expect(plan.ok && plan.value.commonWindows).toEqual([]);
  });

  it('finds an overlap that spans midnight in one zone (Los Angeles 4pm = Tokyo 9am next day)', () => {
    const plan = planMeeting({ year: 2026, month: 1, day: 15 }, 'America/Los_Angeles', ['Asia/Tokyo']);
    expect(plan.ok && plan.value.commonWindows).toEqual([{ from: 16, to: 17 }]);
  });

  it('does not duplicate the anchor zone if it is also listed', () => {
    const plan = planMeeting({ year: 2026, month: 1, day: 15 }, 'UTC', ['UTC', 'Europe/London']);
    expect(plan.ok && plan.value.rows).toHaveLength(2);
  });

  it('marks cells that fall on the next or previous calendar day', () => {
    const plan = planMeeting({ year: 2026, month: 1, day: 15 }, 'UTC', ['Pacific/Auckland']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.rows[1]!.cells.some((cell) => cell.dayShift === 1)).toBe(true);
  });

  it('honours custom working hours and rejects nonsense ones', () => {
    const wide = planMeeting({ year: 2026, month: 1, day: 15 }, 'UTC', ['UTC'], { workStart: 0, workEnd: 24 });
    expect(wide.ok && wide.value.commonWindows).toEqual([{ from: 0, to: 24 }]);

    for (const [start, end] of [[17, 9], [9, 9], [-1, 5], [9, 25], [9.5, 17]] as const) {
      expect(planMeeting({ year: 2026, month: 1, day: 15 }, 'UTC', [], { workStart: start, workEnd: end }).ok).toBe(false);
    }
  });

  it('rejects an unknown zone', () => {
    const plan = planMeeting({ year: 2026, month: 1, day: 15 }, 'UTC', ['Nowhere/Land']);
    expect(!plan.ok && plan.error).toMatch(/Nowhere\/Land/);
  });
});
