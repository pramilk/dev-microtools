import { type ParsedCron } from './cron';
import { fromDayNumber, dayOfWeek, toDayNumber } from './dateMath';
import { instantForWallTime, wallTimeAt } from './timeZone';

/**
 * A dialect-neutral cron schedule plus the machinery to list its upcoming runs in any
 * IANA time zone. Each dialect's parser (5-field Unix in `cron.ts`, Quartz and AWS
 * EventBridge in `cronDialects.ts`) produces one of these; this module knows nothing
 * about their syntax, only about *when* a schedule fires.
 */
export interface CronSchedule {
  seconds: ReadonlySet<number>;
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  /** 1-12 */
  months: ReadonlySet<number>;
  /** Null means any year. */
  years: ReadonlySet<number> | null;
  /** Whether a calendar day matches. `weekday` is 0 (Sunday) to 6 (Saturday). */
  matchesDay: (year: number, month: number, day: number, weekday: number) => boolean;
}

/** Adapts a parsed 5-field Unix cron, whose day-of-month and day-of-week combine with OR when both are set. */
export function scheduleFromUnix(parsed: ParsedCron): CronSchedule {
  const domRestricted = !parsed.dayOfMonth.isWildcard;
  const dowRestricted = !parsed.dayOfWeek.isWildcard;
  return {
    seconds: new Set([0]),
    minutes: parsed.minute.values,
    hours: parsed.hour.values,
    months: parsed.month.values,
    years: null,
    matchesDay: (_year, _month, day, weekday) => {
      const domOk = parsed.dayOfMonth.values.has(day);
      const dowOk = parsed.dayOfWeek.values.has(weekday);
      if (domRestricted && dowRestricted) return domOk || dowOk;
      if (domRestricted) return domOk;
      if (dowRestricted) return dowOk;
      return true;
    },
  };
}

export interface NextRunOptions {
  /** How far ahead to search before giving up. Eight years reaches the next 29 February from any date. */
  maxYearsAhead?: number;
}

const sortedValues = (set: ReadonlySet<number>): number[] => [...set].sort((a, b) => a - b);

/**
 * The next `count` times the schedule fires after `from`, as instants, evaluated against the
 * wall clock of `timeZone`. Walks day by day and only enumerates times of day on days that
 * match, so even a once-a-year schedule resolves in a few thousand cheap iterations.
 *
 * Daylight saving: a wall time skipped by a spring-forward does not fire that day, and a
 * wall time repeated by a fall-back fires once, at its first occurrence.
 */
export function nextScheduleRuns(
  schedule: CronSchedule,
  count: number,
  from: Date,
  timeZone: string,
  options: NextRunOptions = {}
): Date[] {
  const results: Date[] = [];
  if (count <= 0) return results;

  const hours = sortedValues(schedule.hours);
  const minutes = sortedValues(schedule.minutes);
  const seconds = sortedValues(schedule.seconds);
  if (hours.length === 0 || minutes.length === 0 || seconds.length === 0) return results;

  const fromMs = from.getTime();
  const startWall = wallTimeAt(fromMs, timeZone);
  const startDay = toDayNumber(startWall);
  const lastDay = startDay + Math.ceil((options.maxYearsAhead ?? 8) * 366);
  const startKey = (startWall.hour * 60 + startWall.minute) * 60 + startWall.second;

  for (let day = startDay; day <= lastDay && results.length < count; day += 1) {
    const { year, month, day: dayOfMonth } = fromDayNumber(day);
    if (schedule.years && !schedule.years.has(year)) continue;
    if (!schedule.months.has(month)) continue;
    if (!schedule.matchesDay(year, month, dayOfMonth, dayOfWeek({ year, month, day: dayOfMonth }))) continue;

    for (const hour of hours) {
      for (const minute of minutes) {
        for (const second of seconds) {
          // On the first day, skip times already in the past without the cost of resolving them.
          if (day === startDay && (hour * 60 + minute) * 60 + second <= startKey) continue;
          const instant = instantForWallTime({ year, month, day: dayOfMonth, hour, minute, second }, timeZone);
          if (instant === null || instant <= fromMs) continue;
          results.push(new Date(instant));
          if (results.length >= count) return results;
        }
      }
    }
  }
  return results;
}
