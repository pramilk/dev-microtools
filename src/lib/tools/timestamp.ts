import { type ToolResult, ok, err } from './result';

export type TimestampUnit = 'seconds' | 'milliseconds';

export interface TimestampBreakdown {
  seconds: number;
  milliseconds: number;
  iso: string;
  utc: string;
  local: string;
  relative: string;
  dayOfWeek: string;
  timeZone: string;
}

/**
 * Heuristic used when the unit is set to auto-detect. Ten digits is a second-precision
 * timestamp until the year 2286; thirteen digits is milliseconds. This is the same
 * assumption every epoch converter makes and it is right for essentially all real input.
 */
export const guessUnit = (value: number): TimestampUnit =>
  Math.abs(value) >= 1e12 ? 'milliseconds' : 'seconds';

const RELATIVE_STEPS: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [2620800, 86400, 'day'],
  [31449600, 2620800, 'month'],
  [Number.POSITIVE_INFINITY, 31449600, 'year'],
];

/** Human-readable offset from `now`, e.g. "3 days ago". */
export function describeRelative(date: Date, now: Date = new Date()): string {
  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);

  if (magnitude < 1) return 'just now';

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (magnitude < limit) {
      return formatter.format(Math.round(deltaSeconds / divisor), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds / 31449600), 'year');
}

const describe = (date: Date, now: Date): TimestampBreakdown => ({
  seconds: Math.floor(date.getTime() / 1000),
  milliseconds: date.getTime(),
  iso: date.toISOString(),
  utc: date.toUTCString(),
  local: new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date),
  relative: describeRelative(date, now),
  dayOfWeek: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/** Converts a numeric epoch value into every representation the tool shows. */
export function fromEpoch(
  input: string,
  unit: TimestampUnit | 'auto' = 'auto',
  now: Date = new Date()
): ToolResult<TimestampBreakdown> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a Unix timestamp.');

  if (!/^-?\d+$/.test(trimmed)) {
    return err('A Unix timestamp is a whole number of seconds or milliseconds.');
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return err('That number is too large to be a valid timestamp.');
  }

  const resolved = unit === 'auto' ? guessUnit(value) : unit;
  const millis = resolved === 'seconds' ? value * 1000 : value;

  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return err('That timestamp is outside the range of dates JavaScript can represent.');
  }

  return ok(describe(date, now));
}

/** Parses a date string (ISO 8601 and other formats Date accepts) into epoch values. */
export function fromDateString(
  input: string,
  now: Date = new Date()
): ToolResult<TimestampBreakdown> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a date.');

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return err('Could not read that as a date. ISO 8601 works best, for example 2026-03-14T09:26:53Z.');
  }

  return ok(describe(date, now));
}

/** Current time, for the "now" readout the page shows on load. */
export const nowBreakdown = (now: Date = new Date()): TimestampBreakdown => describe(now, now);
