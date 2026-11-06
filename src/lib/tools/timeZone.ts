import { type ToolResult, ok, err } from './result';

/**
 * Time-zone arithmetic built on `Intl` alone — no date library. Shared by the Timezone
 * Converter and by the cron next-run calculator, which both need to answer "what is the
 * wall-clock time in zone X at instant T" and the inverse, "what instant is wall-clock
 * time W in zone X" (the hard direction: DST gaps and overlaps make it ambiguous).
 */

export interface WallTime {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // hourCycle h23 avoids the "24:00" midnight some engines emit with hour12: false.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** True when `timeZone` is an IANA name this browser can resolve. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of an instant in a zone. Throws RangeError for an unknown zone. */
export function wallTimeAt(instantMs: number, timeZone: string): WallTime {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instantMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

const wallAsUtcMs = (w: WallTime): number =>
  Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/** Offset from UTC, in minutes, that a zone observes at an instant (+330 for India). */
export function offsetMinutesAt(instantMs: number, timeZone: string): number {
  // Floor to the second: the formatter drops milliseconds, so keeping them would skew the diff.
  const whole = Math.floor(instantMs / 1000) * 1000;
  return Math.round((wallAsUtcMs(wallTimeAt(whole, timeZone)) - whole) / 60_000);
}

/**
 * The instant at which a zone's wall clock reads `wall`.
 *
 * Returns `null` when that wall time does not exist (it falls in a spring-forward gap).
 * When it occurs twice (a fall-back overlap) the earlier instant is returned, which is
 * what a scheduler or a calendar would pick.
 */
export function instantForWallTime(wall: WallTime, timeZone: string): number | null {
  const valid = validInstants(wall, timeZone);
  return valid.length === 0 ? null : Math.min(...valid);
}

/** Every instant at which the zone's wall clock reads `wall` — none, one, or two. */
function validInstants(wall: WallTime, timeZone: string): number[] {
  const guess = wallAsUtcMs(wall);
  const DAY = 86_400_000;
  // A zone's offset can only differ across a DST edge, so probing a day either side finds
  // every offset that could apply to this wall time.
  const candidateOffsets = new Set([
    offsetMinutesAt(guess - DAY, timeZone),
    offsetMinutesAt(guess + DAY, timeZone),
  ]);

  const valid: number[] = [];
  for (const offset of candidateOffsets) {
    const candidate = guess - offset * 60_000;
    if (offsetMinutesAt(candidate, timeZone) === offset) valid.push(candidate);
  }
  return valid;
}

/**
 * Whether a wall time exists in a zone: `gap` (skipped by spring-forward), `ambiguous`
 * (repeated by fall-back) or `ok`. Lets a UI say so instead of silently picking one.
 */
export function wallTimeStatus(wall: WallTime, timeZone: string): 'ok' | 'gap' | 'ambiguous' {
  const count = validInstants(wall, timeZone).length;
  return count === 0 ? 'gap' : count > 1 ? 'ambiguous' : 'ok';
}

/** "UTC+5:30", "UTC-8", "UTC" */
export function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}`;
}

/** The zone's short display name at an instant, e.g. "EST", "GMT+1" — whatever Intl offers. */
export function zoneAbbreviation(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(
    new Date(instantMs)
  );
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/** The browser's own zone, falling back to UTC where it cannot be determined. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

interface IntlWithSupportedValues {
  supportedValuesOf?: (key: string) => string[];
}

/** Every IANA zone this browser knows, or a short curated list on engines without the API. */
export function allTimeZones(fallback: readonly string[]): string[] {
  const supported = (Intl as unknown as IntlWithSupportedValues).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      const zones = supported.call(Intl, 'timeZone');
      if (zones.length > 0) return zones.includes('UTC') ? zones : ['UTC', ...zones];
    } catch {
      // Fall through to the curated list below.
    }
  }
  return [...fallback];
}

/**
 * Parses the value of an `<input type="datetime-local">` ("2026-03-14T09:30" or with
 * seconds) into a wall time. Deliberately strict: a loose parse would let `Date` guess.
 */
export function parseLocalDateTime(input: string): ToolResult<WallTime> {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!match) {
    return err('Enter a date and time like 2026-03-14 09:30.');
  }
  const [, y, mo, d, h, mi, s] = match;
  const wall: WallTime = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s ?? 0),
  };
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
  if (
    check.getUTCFullYear() !== wall.year ||
    check.getUTCMonth() !== wall.month - 1 ||
    check.getUTCDate() !== wall.day ||
    wall.hour > 23 ||
    wall.minute > 59 ||
    wall.second > 59
  ) {
    return err('That date or time does not exist — check the day against the month (e.g. 30 February).');
  }
  return ok(wall);
}

/** Formats a wall time as the "YYYY-MM-DDTHH:mm" string a datetime-local input uses. */
export function formatLocalDateTime(wall: WallTime): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${p(wall.year, 4)}-${p(wall.month)}-${p(wall.day)}T${p(wall.hour)}:${p(wall.minute)}`;
}
